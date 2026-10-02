import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../src/github.mjs';
import { ReviewSource, assessSnapshot } from '../src/reviews.mjs';
import { HEAD_A, BASE } from './fixture.mjs';

test('complete source capture binds reviews, file excerpts and paginated checks to a stable head', async () => {
  const calls = [];
  const client = new GitHubClient({ fetchImpl: async url => {
    const path = new URL(url).pathname;
    calls.push(path);
    let result;
    if (path === '/repos/acme/demo') result = { private: false };
    else if (path.endsWith('/pulls/1')) result = { id: 1, number: 1, html_url: 'https://github.com/acme/demo/pull/1',
      title: 'Commit evidence', body: 'original', head: { sha: HEAD_A }, base: { sha: BASE }, changed_files: 1,
      updated_at: '2026-10-01T00:00:00Z', labels: [], user: { login: 'builder' } };
    else if (path.endsWith('/reviews')) result = [{ id: 2, html_url: 'https://github.com/acme/demo/pull/1#pullrequestreview-2',
      user: { login: 'reviewer' }, body: 'Approved this revision', state: 'APPROVED', commit_id: HEAD_A }];
    else if (path.endsWith('/files')) result = [{ filename: 'image.bin', sha: BASE, status: 'added', additions: 0, deletions: 0, changes: 0 }];
    else if (path.endsWith('/check-runs')) result = { check_runs: [{ id: 3, name: 'ci', head_sha: HEAD_A, status: 'completed', conclusion: 'success', output: {} }] };
    else result = [];
    return new Response(JSON.stringify(result));
  } });
  const output = [];
  for await (const value of new ReviewSource(client).snapshots('acme/demo', { pull: 1 })) output.push(value);
  assert.equal(output.length, 1);
  assert.equal(output[0].files[0].patchProvided, false);
  assert.equal(output[0].checks[0].commitSha, HEAD_A);
  assert.deepEqual(assessSnapshot(output[0]).filesWithoutPatch, ['image.bin']);
  assert.equal(calls.filter(path => path.endsWith('/pulls/1')).length, 2);
});
test('missing files cause refusal instead of a falsely complete evidence snapshot', async () => {
  const github = {
    async get() { return { body: { head: { sha: HEAD_A }, base: { sha: BASE }, changed_files: 3001, updated_at: 'same' } }; },
    async *pages() { yield []; },
  };
  await assert.rejects(new ReviewSource(github).capture('acme/demo', 1), /complete changed-file/);
});

test('GitHub canonical repository casing preserves public pull and review source links', async () => {
  const github = {
    async get() { return { body: { html_url: 'https://github.com/Acme/Demo/pull/1', head: { sha: HEAD_A }, base: { sha: BASE }, changed_files: 0, updated_at: 'same' } }; },
    async *pages(path) { yield path.includes('/reviews?') ? [{ id: 2, html_url: 'https://github.com/Acme/Demo/pull/1#pullrequestreview-2', commit_id: HEAD_A }] : []; },
  };
  const captured = await new ReviewSource(github).capture('acme/demo', 1);
  assert.equal(captured.url, 'https://github.com/Acme/Demo/pull/1');
  assert.equal(captured.reviews[0].url, 'https://github.com/Acme/Demo/pull/1#pullrequestreview-2');
});
