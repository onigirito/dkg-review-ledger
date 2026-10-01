import { canonical } from './rdf.mjs';

export const validRepository = repository => typeof repository === 'string'
  && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  && !repository.split('/').some(part => part === '.' || part === '..');
const unwrap = response => response.body?.value ?? response.body;
const sha = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{40,64}$/.test(value)) throw new Error('GitHub did not return a valid commit identity.');
  return value;
};
const text = value => typeof value === 'string' ? value : '';
const publicLink = (url, repository, fallback) => {
  try {
    const parsed = new URL(url);
    if (parsed.origin === 'https://github.com' && parsed.pathname.startsWith('/' + repository + '/')) return parsed.href;
  } catch { /* use the canonical API resource */ }
  return fallback;
};
export class SnapshotMovedError extends Error {}

export class ReviewSource {
  constructor(github) { this.github = github; }
  async list(path, select) {
    const items = [];
    for await (const page of this.github.pages(path, select)) items.push(...page);
    return items;
  }
  async *snapshots(repository, { pull } = {}) {
    if (!validRepository(repository)) throw new Error('Invalid repository.');
    if (pull !== undefined && (!Number.isSafeInteger(pull) || pull < 1)) throw new Error('Invalid pull-request number.');
    const prefix = 'repos/' + repository;
    const metadata = unwrap(await this.github.get(prefix, { fresh: true }));
    if (metadata.private !== false) throw new Error('Only explicitly public repositories are ingested.');
    if (pull !== undefined) { yield await this.capture(repository, pull); return; }
    for await (const page of this.github.pages(prefix + '/pulls?state=all&sort=updated&direction=asc&per_page=100')) {
      for (const item of page) yield await this.capture(repository, item.number);
    }
  }
  async capture(repository, number) {
    const prefix = 'repos/' + repository;
    const path = prefix + '/pulls/' + number;
    const initial = unwrap(await this.github.get(path, { fresh: true }));
    const headSha = sha(initial.head?.sha);
    const baseSha = sha(initial.base?.sha);
    const [reviews, comments, reviewComments, files, checks] = await Promise.all([
      this.list(path + '/reviews?per_page=100'),
      this.list(prefix + '/issues/' + number + '/comments?per_page=100'),
      this.list(path + '/comments?per_page=100'),
      this.list(path + '/files?per_page=100'),
      this.list(prefix + '/commits/' + headSha + '/check-runs?filter=all&per_page=100', body => body.check_runs),
    ]);
    const final = unwrap(await this.github.get(path, { fresh: true }));
    if (final.head?.sha !== headSha || final.base?.sha !== baseSha || final.updated_at !== initial.updated_at) {
      throw new SnapshotMovedError('Pull request moved during capture; no mixed-commit snapshot was stored. Run sync again.');
    }
    if (!Number.isInteger(initial.changed_files) || initial.changed_files !== files.length) {
      throw new Error('GitHub did not return the complete changed-file listing; snapshot was not stored.');
    }
    const api = 'https://api.github.com/' + path;
    const item = (row, kind, fallback) => ({
      id: String(row.id), kind, url: publicLink(row.html_url, repository, fallback),
      author: text(row.user?.login), body: text(row.body),
      updatedAt: text(row.updated_at || row.submitted_at || row.created_at),
    });
    const snapshot = {
      repository, kind: 'review-snapshot', id: String(number),
      url: publicLink(initial.html_url, repository, api),
      title: text(initial.title), body: text(initial.body),
      author: text(initial.user?.login), state: text(initial.state),
      updatedAt: text(initial.updated_at), headSha, baseSha,
      merged: initial.merged === true,
      labels: (initial.labels || []).map(label => text(label.name)).sort(),
      reviews: reviews.map(row => ({ ...item(row, 'review', api + '/reviews/' + row.id),
        commitSha: text(row.commit_id), reviewState: text(row.state),
      })).sort((a, b) => a.id.localeCompare(b.id)),
      comments: comments.map(row => item(row, 'discussion-comment', 'https://api.github.com/' + prefix + '/issues/comments/' + row.id))
        .sort((a, b) => a.id.localeCompare(b.id)),
      reviewComments: reviewComments.map(row => ({ ...item(row, 'review-comment', api + '/comments/' + row.id),
        commitSha: text(row.commit_id), originalCommitSha: text(row.original_commit_id),
        path: text(row.path), line: row.line ?? null,
      })).sort((a, b) => a.id.localeCompare(b.id)),
      files: files.map(row => ({
        path: text(row.filename), previousPath: text(row.previous_filename),
        blobSha: text(row.sha), status: text(row.status), additions: row.additions,
        deletions: row.deletions, changes: row.changes,
        patch: text(row.patch), patchProvided: typeof row.patch === 'string',
        // GitHub may omit/truncate patches. File lists are complete; patches are source-provided excerpts.
        url: 'https://github.com/' + repository + '/pull/' + number + '/files',
      })).sort((a, b) => a.path.localeCompare(b.path)),
      checks: checks.map(row => ({
        id: String(row.id), name: text(row.name),
        url: publicLink(row.html_url, repository, 'https://api.github.com/' + prefix + '/check-runs/' + row.id),
        commitSha: text(row.head_sha), status: text(row.status), conclusion: text(row.conclusion),
        startedAt: text(row.started_at), completedAt: text(row.completed_at),
        output: { title: text(row.output?.title), summary: text(row.output?.summary), text: text(row.output?.text) },
      })).sort((a, b) => a.id.localeCompare(b.id)),
    };
    if (Buffer.byteLength(canonical(snapshot)) > 8 * 1024 * 1024) throw new Error('Snapshot exceeds the 8 MiB bound; capture a smaller pull request.');
    return snapshot;
  }
}

export function assessSnapshot(snapshot) {
  return {
    repository: snapshot.repository, pull: Number(snapshot.id), source: snapshot.url,
    title: snapshot.title, headSha: snapshot.headSha, baseSha: snapshot.baseSha,
    sourceUpdatedAt: snapshot.updatedAt, merged: snapshot.merged,
    interpretation: 'Source-reported evidence at capture time; commit correspondence is not a merge approval or an independent verification of check results.',
    reviews: snapshot.reviews.map(({ id, url, author, commitSha, reviewState }) => ({
      id, url, author, commitSha, reviewState, appliesToCapturedHead: commitSha === snapshot.headSha,
    })),
    checks: snapshot.checks.map(({ id, url, name, commitSha, status, conclusion }) => ({
      id, url, name, commitSha, status, conclusion, appliesToCapturedHead: commitSha === snapshot.headSha,
    })),
    fileCount: snapshot.files.length,
    filesWithoutPatch: snapshot.files.filter(file => !file.patchProvided).map(file => file.path),
    reviewComments: snapshot.reviewComments.map(({ id, url, commitSha, path }) => ({
      id, url, commitSha, path, appliesToCapturedHead: commitSha === snapshot.headSha,
    })),
  };
}
