import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../src/github.mjs';
import { ReviewSource, SnapshotMovedError, assessSnapshot } from '../src/reviews.mjs';
import { Journal, BusyError } from '../src/journal.mjs';
import { artifactToAsset, canonical, hash, chunks } from '../src/rdf.mjs';
import { DkgClient, IntegrityError } from '../src/dkg.mjs';
import { syncReviews } from '../src/sync.mjs';
import { snapshot, HEAD_A, HEAD_B, BASE, sourceFor } from './fixture.mjs';

test('changed code preserves the original review and distinguishes its commit from current CI', () => {
  assert.equal(assessSnapshot(snapshot()).reviews[0].appliesToCapturedHead, true);
  const changed = assessSnapshot(snapshot(HEAD_B));
  assert.equal(changed.reviews[0].appliesToCapturedHead, false);
  assert.equal(changed.checks[0].appliesToCapturedHead, true);
  assert.equal(changed.reviews[0].reviewState, 'APPROVED');
});
test('lossless Unicode chunks and content identities support stable replay and changed revisions', () => {
  const original = snapshot(); original.body = '😀漢字"\n'.repeat(5000);
  assert.equal(chunks(original.body).join(''), original.body);
  const first = artifactToAsset(original, 'graph', '2026-10-01T00:00:00Z');
  assert.equal(first.digest, hash(canonical(original)));
  assert.equal(first.name, artifactToAsset(original, 'graph', '2026-10-02T00:00:00Z').name);
  assert.notEqual(first.name, artifactToAsset(snapshot(HEAD_B), 'graph').name);
});
test('ETag replay retains cached pagination and rejects a cross-origin next link before credentials leave', async () => {
  const journal = new Journal(':memory:');
  const calls = [];
  const client = new GitHubClient({ journal, token: 'fixture-token', fetchImpl: async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    if (options.headers['If-None-Match']) return new Response(null, { status: 304 });
    const next = String(url).includes('page=2') ? '' : '<https://api.github.com/items?page=2>; rel="next"';
    return new Response(JSON.stringify([{ id: calls.length }]), { headers: { ETag: 'fixture', Link: next } });
  } });
  const collect = async () => { const rows = []; for await (const page of client.pages('items')) rows.push(...page); return rows; };
  assert.equal((await collect()).length, 2);
  assert.equal((await collect()).length, 2);
  assert.equal(calls.length, 4);
  journal.saveCache('https://api.github.com/escape', 'etag', { value: [], link: '<https://untrusted.example/items>; rel="next"' });
  await assert.rejects(async () => { for await (const page of client.pages('escape')) void page; }, /origin/);
  assert.equal(calls.length, 5);
  journal.close();
});
test('a capture with a moved head is rejected before it reaches Working Memory', async () => {
  let reads = 0;
  const github = {
    async get() { return { body: { number: 1, head: { sha: ++reads === 1 ? HEAD_A : HEAD_B }, base: { sha: BASE }, updated_at: 'same', changed_files: 0 } }; },
    async *pages() { yield []; },
  };
  await assert.rejects(new ReviewSource(github).capture('acme/demo', 1), SnapshotMovedError);
});
test('private repositories are refused before any pull-request or check data is fetched', async () => {
  let calls = 0;
  const source = new ReviewSource({ async get() { calls++; return { body: { private: true } }; } });
  await assert.rejects(async () => { for await (const item of source.snapshots('acme/private')) void item; }, /public/);
  assert.equal(calls, 1);
});
test('replay reuses the stored observation and reports partial failure without a completed run', async () => {
  const journal = new Journal(':memory:');
  const receipts = [];
  const dkg = { async ensureGraph() {}, async ensureAsset(asset) { receipts.push(asset); return { name: asset.name, digest: asset.digest }; } };
  const run = () => syncReviews({ repository: 'acme/demo', graph: 'graph', source: sourceFor([snapshot()]), dkg, journal });
  assert.equal((await run()).reused, 0);
  assert.equal((await run()).reused, 1);
  assert.equal(receipts[0].observedAt, receipts[1].observedAt);
  const broken = { async *snapshots() { yield snapshot(HEAD_B); throw new Error('upstream failed'); } };
  await assert.rejects(syncReviews({ repository: 'acme/demo', graph: 'graph', source: broken, dkg, journal }), /upstream/);
  assert.equal(journal.db.prepare('SELECT outcome FROM runs ORDER BY id DESC LIMIT 1').get().outcome, 'incomplete');
  assert.equal(journal.assets('acme/demo').length, 2);
  journal.acquire('lock', 'first');
  assert.throws(() => journal.acquire('lock', 'second'), BusyError);
  journal.close();
});
test('an ambiguous create response is reconciled by reading the same identity before another write', async () => {
  const asset = artifactToAsset(snapshot(), 'graph');
  let stored = false, writes = 0;
  const dkg = new DkgClient({ url: 'http://localhost:19200', token: 'fixture-token', fetchImpl: async (url, options) => {
    if (options.method === 'POST') { writes++; stored = true; throw new Error('connection ended after commit'); }
    if (String(url).includes('/wm/quads')) return new Response(JSON.stringify({ quads: stored ? asset.quads : [] }));
    return new Response('{}', { status: 404 });
  } });
  assert.equal((await dkg.ensureAsset(asset)).digest, asset.digest);
  assert.equal((await dkg.ensureAsset(asset)).digest, asset.digest);
  assert.equal(writes, 1);
});
test('unexpected stored content is preserved and causes no repair write', async () => {
  const asset = artifactToAsset(snapshot(), 'graph');
  let writes = 0;
  const dkg = new DkgClient({ url: 'http://localhost:19200', token: 'fixture-token', fetchImpl: async (url, options) => {
    if (options.method === 'POST') writes++;
    return new Response(JSON.stringify({ quads: [...asset.quads, { subject: 'urn:extra', predicate: 'urn:unknown', object: '"other"' }] }));
  } });
  await assert.rejects(dkg.ensureAsset(asset), IntegrityError);
  assert.equal(writes, 0);
});
test('node-side Curator rejection is not converted into a successful share', async () => {
  const asset = artifactToAsset(snapshot(), 'graph');
  const dkg = new DkgClient({ url: 'http://localhost:19200', token: 'fixture-token', fetchImpl: async (url, options) => {
    if (options.method === 'POST') return new Response(JSON.stringify({ code: 'CURATOR_REQUIRED' }), { status: 403 });
    return new Response(JSON.stringify(String(url).includes('/wm/quads') ? { quads: asset.quads } : { status: 'wm-draft' }));
  } });
  await assert.rejects(dkg.share(asset), error => error.status === 403);
});
