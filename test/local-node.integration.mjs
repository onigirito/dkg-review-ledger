import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DkgClient } from '../src/dkg.mjs';
import { Journal } from '../src/journal.mjs';
import { syncReviews } from '../src/sync.mjs';
import { assessSnapshot } from '../src/reviews.mjs';
import { snapshot, HEAD_B, sourceFor } from './fixture.mjs';

const token = process.env.DKG_AUTH_TOKEN || (process.env.DKG_AGENT_FILE ? JSON.parse(readFileSync(process.env.DKG_AGENT_FILE, 'utf8')).authToken : '') || (process.env.DKG_AUTH_TOKEN_FILE ? readFileSync(process.env.DKG_AUTH_TOKEN_FILE, 'utf8').split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#')) : '');
test('actual DKG v10 HTTP API: lossless WM, replay, changed-head history, Curator SHARE and SWM readback', { skip: !token }, async () => {
  const dkg = new DkgClient({ url: process.env.DKG_API_URL || 'http://localhost:9200', token });
  const journal = new Journal(':memory:');
  const graph = await dkg.projectGraph('acme/demo') + '-' + randomUUID();
  const run = source => syncReviews({ repository: 'acme/demo', graph, journal, dkg, source });
  try {
    const first = await run(sourceFor([snapshot()]));
    assert.equal(first.snapshots, 1);
    assert.equal((await run(sourceFor([snapshot()]))).reused, 1);
    const changed = await run(sourceFor([snapshot(HEAD_B)]));
    assert.notEqual(first.assets[0].name, changed.assets[0].name);
    const history = await dkg.listSnapshots(graph);
    assert.equal(history.length, 2);
    assert.equal((await dkg.listSnapshots(graph, { source: 'https://github.com/ACME/DEMO/pull/1' })).length, 2);
    const read = await dkg.loadSnapshot(graph, changed.assets[0].name);
    assert.equal(assessSnapshot(read.snapshot).reviews[0].appliesToCapturedHead, false);
    assert.equal(assessSnapshot(read.snapshot).checks[0].appliesToCapturedHead, true);
    assert.deepEqual(read.snapshot, snapshot(HEAD_B));
    const asset = JSON.parse(journal.asset(changed.assets[0].name).payload);
    const shared = await dkg.share(asset);
    assert.equal(shared.swmShared, true);
    assert.equal(shared.sealed, true);
    assert.equal((await dkg.loadSnapshot(graph, asset.name, 'shared-working-memory')).digest, asset.digest);
    assert.equal((await dkg.share(asset)).reused, true);
    assert.equal((await run(sourceFor([snapshot(HEAD_B)]))).reused, 1);
  } finally { journal.close(); }
});
