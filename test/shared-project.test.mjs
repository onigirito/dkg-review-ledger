import test from 'node:test';
import assert from 'node:assert/strict';
import { DkgClient } from '../src/dkg.mjs';
import { run } from '../src/cli.mjs';
const owner = '0x' + 'b'.repeat(40);
const env = { REPOSITORIES: 'fixtures/demo', DKG_AUTH_TOKEN: 'synthetic-scoped-token',
  DKG_API_URL: 'http://127.0.0.1:1', JOURNAL_PATH: ':memory:' };

test('shared project selection cannot redirect sync or SHARE writes', async () => {
  for (const command of ['sync', 'share']) {
    await assert.rejects(run([command, '--view', 'shared-working-memory', '--shared-owner', owner], env), /only for Shared Memory/);
  }
});
test('shared project selection cannot read another owner Working Memory', async () => {
  await assert.rejects(run(['history', '--pull', '1', '--shared-owner', owner], env), /only for Shared Memory/);
});
test('shared project selection rejects malformed owners before sending a request', async () => {
  let requests = 0;
  const client = new DkgClient({ url: 'http://127.0.0.1:1', token: 'synthetic-scoped-token',
    fetchImpl() { requests++; throw new Error('Unexpected request'); } });
  for (const invalid of ['../project', owner + '/graph', '', '0xshort']) {
    await assert.rejects(client.sharedProjectGraph('fixtures/demo', invalid), /DKG agent address/);
  }
  assert.equal(requests, 0);
});
