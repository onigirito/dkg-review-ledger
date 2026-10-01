import { NS, literal, tripleKey, normalizedTerm, hash, canonical } from './rdf.mjs';

export class DkgError extends Error {
  constructor(status, code = 'DKG_REQUEST_FAILED') { super(`DKG API returned HTTP ${status} (${code})`); this.status = status; this.code = code; }
}
export class IntegrityError extends Error {}
export class DkgClient {
  constructor({ url, token, fetchImpl = fetch }) {
    this.base = new URL(url);
    this.token = token;
    this.fetch = fetchImpl;
    if (this.base.protocol !== 'https:' && !(this.base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(this.base.hostname))) throw new Error('Remote DKG credentials require HTTPS.');
    if (this.base.username || this.base.password || this.base.search || this.base.hash) throw new Error('DKG base URL must not contain credentials or query parameters.');
  }
  async request(method, path, body) {
    const url = new URL(path, this.base);
    if (url.origin !== this.base.origin) throw new Error('DKG request left the configured origin.');
    const response = await this.fetch(url, {
      method, redirect: 'manual', headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || response.status === 207) throw new DkgError(response.status, /^[A-Z0-9_]{1,80}$/.test(result.code || '') ? result.code : 'DKG_REQUEST_FAILED');
    return result;
  }
  async ensureGraph(id, repository) {
    try {
      return await this.request('POST', '/api/context-graph/create', { id, name: 'GitHub ' + repository, description: 'Source-linked engineering knowledge', register: false, publishPolicy: 0 });
    } catch (error) { if (error.status !== 409) throw error; }
  }
  async projectGraph(repository) {
    const identity = await this.request('GET', '/api/agent/identity');
    if (!/^0x[a-fA-F0-9]{40}$/.test(identity.agentAddress || '')) throw new Error('A DKG agent-scoped token with a custodial owner identity is required for project creation and SHARE.');
    return identity.agentAddress.toLowerCase() + '/review-ledger-' + hash(repository.toLowerCase()).slice(0, 24);
  }
  async read(asset) {
    const prefix = '/api/knowledge-assets/' + encodeURIComponent(asset.name);
    const query = '?contextGraphId=' + encodeURIComponent(asset.contextGraphId);
    return await this.request('GET', prefix + '/wm/quads' + query);
  }
  verify(asset, result) {
    if (!Array.isArray(result.quads)) throw new IntegrityError('DKG did not return readable Working Memory quads.');
    const keys = new Set(result.quads.map(tripleKey));
    const expected = new Set(asset.quads.map(tripleKey));
    if (keys.size !== expected.size || ![...expected].every(key => keys.has(key))) throw new IntegrityError('DKG content does not match the prepared source snapshot.');
    return { name: asset.name, contextGraphId: asset.contextGraphId, digest: asset.digest, revision: asset.revision, triples: result.quads.length, status: 'wm-verified' };
  }
  async ensureAsset(asset) {
    let existing;
    try { return this.verify(asset, await this.read(asset)); }
    catch (error) {
      if (error.status !== 404 && !(error instanceof IntegrityError)) throw error;
      if (error instanceof IntegrityError) {
        existing = await this.read(asset);
        const expected = new Set(asset.quads.map(tripleKey));
        if (existing.quads.some(quad => !expected.has(tripleKey(quad)))) throw new IntegrityError('Unexpected existing content; it was preserved for reconciliation.');
      }
    }
    try {
      const prefix = '/api/knowledge-assets/' + encodeURIComponent(asset.name);
      let created = false;
      try { await this.request('GET', prefix + '?contextGraphId=' + encodeURIComponent(asset.contextGraphId)); created = true; }
      catch (error) { if (error.status !== 404) throw error; }
      if (created) {
        const descriptor = await this.request('GET', prefix + '?contextGraphId=' + encodeURIComponent(asset.contextGraphId));
        if (['swm-shared', 'vm-confirmed'].includes(descriptor.status)) {
          const stored = await this.loadSnapshot(asset.contextGraphId, asset.name, 'shared-working-memory');
          if (stored.digest !== asset.digest) throw new IntegrityError('Existing Shared Memory snapshot has a different digest.');
          return { name: asset.name, contextGraphId: asset.contextGraphId, digest: asset.digest, revision: asset.revision, status: 'swm-verified' };
        }
        const present = new Set((existing?.quads || []).map(tripleKey));
        const missing = asset.quads.filter(quad => !present.has(tripleKey(quad)));
        await this.request('POST', prefix + '/wm/write', { contextGraphId: asset.contextGraphId, quads: missing });
      } else {
        await this.request('POST', '/api/knowledge-assets', {
          contextGraphId: asset.contextGraphId, name: asset.name, quads: asset.quads,
          finalize: false, alsoShareSwm: false, alsoPublishVm: false,
        });
      }
    } catch (error) {
      // A timeout is not a failed write. Read the same identity before any retry.
      try { return this.verify(asset, await this.read(asset)); } catch { throw error; }
    }
    return this.verify(asset, await this.read(asset));
  }
  async share(asset) {
    const path = '/api/knowledge-assets/' + encodeURIComponent(asset.name);
    const getDescriptor = () => this.request('GET', path + '?contextGraphId=' + encodeURIComponent(asset.contextGraphId));
    let descriptor = await getDescriptor();
    let response;
    if (['swm-shared', 'vm-confirmed'].includes(descriptor.status)) response = { swmShared: true, sealed: true, reused: true };
    else {
      this.verify(asset, await this.read(asset));
      try { response = await this.request('POST', path + '/swm/share', { contextGraphId: asset.contextGraphId, awaitCuratorAck: true }); }
      catch (error) {
        descriptor = await getDescriptor();
        if (!['swm-shared', 'vm-confirmed'].includes(descriptor.status)) throw error;
        response = { swmShared: true, sealed: true, reconciled: true };
      }
    }
    if (response.swmShared !== true || response.sealed !== true) throw new IntegrityError('Curator-authorized sharing was not confirmed.');
    descriptor = await getDescriptor();
    if (!['swm-shared', 'vm-confirmed'].includes(descriptor.status)) throw new IntegrityError('Shared Memory lifecycle state was not verified.');
    const stored = await this.loadSnapshot(asset.contextGraphId, asset.name, 'shared-working-memory');
    if (stored.digest !== asset.digest) throw new IntegrityError('Shared Memory snapshot digest did not match.');
    return { ...response, descriptor };
  }
  async query(contextGraphId, sparql, view = 'working-memory') {
    if (!['working-memory', 'shared-working-memory'].includes(view)) throw new Error('Invalid memory view.');
    const response = await this.request('POST', '/api/query', { contextGraphId, view, sparql });
    const result = response.result ?? response;
    if (!Array.isArray(result.bindings)) throw new IntegrityError('DKG query did not return bindings.');
    const value = cell => {
      if (cell && typeof cell === 'object' && 'value' in cell) return cell.value;
      if (typeof cell !== 'string') return cell;
      const normalized = normalizedTerm(cell);
      return normalized.startsWith('literal:') ? normalized.slice(8) : normalized;
    };
    return result.bindings.map(row => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, value(cell)])));
  }
  async listSnapshots(contextGraphId, { source, query = '', limit = 20, view = 'working-memory' } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || query.length > 200) throw new Error('Invalid bounded search.');
    const filter = source ? `FILTER(STR(?source) = ${literal(source)})` : '';
    const sparql = `SELECT DISTINCT ?revision ?source ?title ?digest ?updated ?observed ?name ?head WHERE {
      ?revision <${NS.prov}wasDerivedFrom> ?source ; <${NS.gm}kind> "review-snapshot" ;
        <${NS.schema}headline> ?title ; <${NS.gm}contentDigest> ?digest ; <${NS.schema}dateModified> ?updated ;
        <${NS.gm}observedAt> ?observed ; <${NS.gm}knowledgeAssetName> ?name ; <${NS.gm}headSha> ?head ; <${NS.gm}contentChunk> ?chunk .
      ?chunk <${NS.schema}text> ?text . ${filter}
      FILTER(CONTAINS(LCASE(STR(?title)), LCASE(${literal(query)})) || CONTAINS(LCASE(STR(?text)), LCASE(${literal(query)})))
    } ORDER BY DESC(?observed) LIMIT ${limit}`;
    return this.query(contextGraphId, sparql, view);
  }
  async loadSnapshot(contextGraphId, name, view = 'working-memory') {
    if (!/^github-[a-f0-9]{40}$/.test(name)) throw new Error('Invalid snapshot identity.');
    const rows = await this.query(contextGraphId, `SELECT ?revision ?digest ?observed ?text ?position WHERE {
      ?revision <${NS.gm}knowledgeAssetName> ${literal(name)} ; <${NS.gm}contentDigest> ?digest ;
        <${NS.gm}observedAt> ?observed ; <${NS.gm}contentChunk> ?chunk .
      ?chunk <${NS.schema}position> ?position ; <${NS.schema}text> ?text .
    }`, view);
    if (!rows.length) throw new DkgError(404, 'SNAPSHOT_NOT_FOUND');
    rows.sort((a, b) => Number(a.position) - Number(b.position));
    if (rows.some((row, index) => Number(row.position) !== index || row.digest !== rows[0].digest)) throw new IntegrityError('Snapshot chunks are incomplete or ambiguous.');
    let snapshot;
    try { snapshot = JSON.parse(rows.map(row => row.text).join('')); }
    catch { throw new IntegrityError('Snapshot JSON is incomplete.'); }
    if (hash(canonical(snapshot)) !== rows[0].digest) throw new IntegrityError('Snapshot digest did not match the stored content.');
    return { name, contextGraphId, revision: rows[0].revision, digest: rows[0].digest, observedAt: rows[0].observed, snapshot };
  }
  async search(contextGraphId, query = '', limit = 20, view = 'working-memory') {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || query.length > 200 || !['working-memory', 'shared-working-memory'].includes(view)) throw new Error('Invalid bounded search.');
    const sparql = `SELECT DISTINCT ?revision ?source ?kind ?title ?digest ?updated ?name WHERE {
      ?revision <${NS.prov}wasDerivedFrom> ?source ; <${NS.gm}kind> ?kind ; <${NS.schema}headline> ?title ;
        <${NS.gm}contentDigest> ?digest ; <${NS.schema}dateModified> ?updated ; <${NS.gm}knowledgeAssetName> ?name ; <${NS.gm}contentChunk> ?chunk .
      ?chunk <${NS.schema}text> ?text .
      FILTER(CONTAINS(LCASE(STR(?title)),LCASE(${literal(query)})) || CONTAINS(LCASE(STR(?text)),LCASE(${literal(query)})))
    } ORDER BY DESC(?updated) LIMIT ${limit}`;
    const response = await this.request('POST', '/api/query', { contextGraphId, view, sparql });
    const result = response.result ?? response;
    if (!Array.isArray(result.bindings)) throw new IntegrityError('DKG search did not return bindings.');
    const value = cell => cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell;
    return result.bindings.map(row => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, value(cell)])));
  }
}
