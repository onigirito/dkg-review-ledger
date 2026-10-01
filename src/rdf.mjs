import { createHash } from 'node:crypto';

export const NS = {
  gm: 'urn:dkg-review-ledger:',
  schema: 'https://schema.org/',
  prov: 'http://www.w3.org/ns/prov#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
};
export const hash = text => createHash('sha256').update(text).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const literal = value => JSON.stringify(String(value));
export function normalizedTerm(value) {
  const quoted = /^("(?:[^"\\]|\\.)*")(?:\^\^.*|@[a-zA-Z-]+)?$/s.exec(value);
  if (quoted) {
    try { return 'literal:' + JSON.parse(quoted[1]); } catch { /* not a literal */ }
  }
  return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
}
export const tripleKey = quad => canonical([quad.subject, quad.predicate, quad.object].map(normalizedTerm));
export function chunks(text, size = 4096) {
  const points = Array.from(text);
  const result = [];
  for (let index = 0; index < points.length; index += size) result.push(points.slice(index, index + size).join(''));
  return result.length ? result : [''];
}
export function artifactToAsset(artifact, contextGraphId, observedAt = new Date().toISOString()) {
  const digest = hash(canonical(artifact));
  const name = 'github-' + hash(contextGraphId + ':' + artifact.url + ':' + digest).slice(0, 40);
  const revision = artifact.url + '#dkg-revision-' + digest;
  const quads = [];
  const add = (subject, predicate, object) => quads.push({ subject, predicate, object });
  add(revision, NS.rdf + 'type', NS.schema + 'CreativeWork');
  add(revision, NS.prov + 'wasDerivedFrom', artifact.url);
  add(revision, NS.gm + 'repository', 'https://github.com/' + artifact.repository);
  add(revision, NS.gm + 'kind', literal(artifact.kind));
  add(revision, NS.gm + 'contentDigest', literal(digest));
  add(revision, NS.gm + 'knowledgeAssetName', literal(name));
  add(revision, NS.gm + 'sourceTrust', literal('untrusted-source-content'));
  add(revision, NS.gm + 'observedAt', literal(observedAt));
  if (artifact.headSha) add(revision, NS.gm + 'headSha', literal(artifact.headSha));
  if (artifact.baseSha) add(revision, NS.gm + 'baseSha', literal(artifact.baseSha));
  add(revision, NS.schema + 'headline', literal(artifact.title || artifact.kind));
  add(revision, NS.schema + 'dateModified', literal(artifact.updatedAt));
  add(revision, NS.schema + 'creativeWorkStatus', literal(artifact.state || 'source-reported'));
  if (artifact.author) add(revision, NS.schema + 'author', 'https://github.com/' + artifact.author);
  if (artifact.parent) add(revision, NS.schema + 'isPartOf', artifact.parent);
  for (const label of artifact.labels || []) add(revision, NS.schema + 'keywords', literal(label));
  // Store a lossless source snapshot; hashing, retrieval and replay all use this exact canonical value.
  chunks(canonical(artifact)).forEach((body, index) => {
    const chunk = revision + '-chunk-' + String(index).padStart(5, '0');
    add(revision, NS.gm + 'contentChunk', chunk);
    add(chunk, NS.schema + 'position', literal(index));
    add(chunk, NS.schema + 'text', literal(body));
  });
  for (const evidence of [...(artifact.reviews || []), ...(artifact.reviewComments || []), ...(artifact.checks || [])]) {
    const subject = revision + '/evidence/' + encodeURIComponent(evidence.kind || 'check') + '/' + encodeURIComponent(evidence.id);
    add(revision, NS.gm + 'evidence', subject);
    add(subject, NS.prov + 'wasDerivedFrom', evidence.url);
    if (evidence.commitSha) add(subject, NS.gm + 'commitSha', literal(evidence.commitSha));
    if (evidence.reviewState) add(subject, NS.gm + 'reviewState', literal(evidence.reviewState));
    if (evidence.conclusion) add(subject, NS.gm + 'checkConclusion', literal(evidence.conclusion));
  }
  return { name, revision, digest, contextGraphId, artifact, observedAt, quads };
}
