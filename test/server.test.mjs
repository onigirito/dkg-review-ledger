import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/server.mjs';
import { Journal } from '../src/journal.mjs';
import { sourceFor } from './fixture.mjs';

test('public demo reads only allowlisted projects and refuses anonymous state changes', async () => {
  const journal = new Journal(':memory:');
  const server = createService({ repositories: ['acme/demo'], serviceToken: 'fixture-control', publicRead: true }, {
    journal, source: sourceFor([]), dkg: { async projectGraph() { return 'graph'; }, async listSnapshots() { return []; } },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/api/projects')).status, 200);
    assert.equal((await fetch(base + '/api/search?repository=other/private')).status, 400);
    const post = headers => fetch(base + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ Authorization: 'Bearer wrong' })).status, 401);
    const page = await fetch(base + '/');
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    const app = await (await fetch(base + '/app.js')).text();
    assert.equal(app.includes('innerHTML'), false);
  } finally { await new Promise(resolve => server.close(resolve)); journal.close(); }
});
