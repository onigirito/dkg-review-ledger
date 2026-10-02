import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DkgClient } from '../src/dkg.mjs';
import { Journal } from '../src/journal.mjs';
import { syncReviews } from '../src/sync.mjs';
import { assessSnapshot } from '../src/reviews.mjs';
import { run as runCli } from '../src/cli.mjs';
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

const reader = process.env.DKG_OBSERVER_AGENT_FILE ? JSON.parse(readFileSync(process.env.DKG_OBSERVER_AGENT_FILE, 'utf8')) : null;
test('a distinct agent reads the writer project through the standard Shared Memory CLI', { skip: !token || !reader }, async () => {
  const dkg = new DkgClient({ url: process.env.DKG_API_URL || 'http://localhost:9200', token });
  const writer = await dkg.request('GET', '/api/agent/identity');
  assert.notEqual(reader.agentAddress.toLowerCase(), writer.agentAddress.toLowerCase());
  const repository = 'fixtures/two-agent-' + randomUUID();
  const graph = await dkg.projectGraph(repository);
  const journal = new Journal(':memory:');
  const captured = { ...snapshot(), repository, url: 'https://github.com/' + repository + '/pull/1' };
  try {
    const written = await syncReviews({ repository, graph, journal, dkg, source: sourceFor([captured]) });
    const asset = JSON.parse(journal.asset(written.assets[0].name).payload);
    await dkg.share(asset);
    const env = { ...process.env, REPOSITORIES: repository, DKG_AGENT_FILE: process.env.DKG_OBSERVER_AGENT_FILE,
      DKG_AUTH_TOKEN: reader.authToken, JOURNAL_PATH: ':memory:' };
    const common = ['--repo', repository, '--pull', '1', '--view', 'shared-working-memory'];
    assert.deepEqual(await runCli(['history', ...common], env), []);
    const history = await runCli(['history', ...common, '--shared-owner', writer.agentAddress], env);
    assert.ok(history.some(row => row.name === asset.name && row.digest === asset.digest));
    const read = await runCli(['review-state', ...common, '--shared-owner', writer.agentAddress], env);
    assert.equal(read.name, asset.name); assert.equal(read.digest, asset.digest);
    assert.equal(read.observedAt, asset.observedAt); assert.equal(read.evidence.headSha, captured.headSha);
    assert.equal(read.memoryLayer, 'shared-working-memory');
  } finally { journal.close(); }
});
