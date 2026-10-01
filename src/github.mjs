const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export class GitHubClient {
  constructor({ token = '', journal, fetchImpl = fetch, baseUrl = 'https://api.github.com/', maxPages = 100 }) {
    this.token = token;
    this.journal = journal;
    this.fetch = fetchImpl;
    this.base = new URL(baseUrl);
    this.maxPages = maxPages;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('Invalid pagination bound.');
    if (!['https:', 'http:'].includes(this.base.protocol)) throw new Error('Unsupported GitHub API protocol.');
    if (this.base.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(this.base.hostname)) throw new Error('GitHub credentials require HTTPS.');
    if (this.base.username || this.base.password || this.base.search || this.base.hash) throw new Error('Invalid GitHub API base URL.');
  }
  url(path) {
    const url = new URL(path, this.base);
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname)) throw new Error('GitHub pagination left the configured API origin.');
    return url.href;
  }
  async get(path, { fresh = false } = {}) {
    const url = this.url(path);
    const cached = this.journal?.cache(url);
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dkg-github-memory/0.1.0' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    if (!fresh && cached?.etag) headers['If-None-Match'] = cached.etag;
    const response = await this.fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (response.status === 304 && cached) return { body: JSON.parse(cached.body), next: cached.next ?? null, link: response.headers.get('link') };
    if (!response.ok) {
      const reset = response.headers.get('x-ratelimit-reset');
      const error = new Error(`GitHub API returned HTTP ${response.status}` + (reset ? `; retry after ${reset}` : ''));
      error.status = response.status;
      throw error;
    }
    const body = await response.json();
    const link = response.headers.get('link');
    this.journal?.saveCache(url, response.headers.get('etag'), { value: body, link });
    return { body, link };
  }
  async *pages(path, select = value => value) {
    let url = this.url(path);
    let count = 0;
    while (url) {
      if (++count > this.maxPages) throw new Error('GitHub pagination limit reached; sync remains incomplete.');
      const response = await this.get(url);
      // Cache envelopes preserve Link on a 304; old cache entries are never treated as complete pages.
      const body = select(response.body?.value !== undefined ? response.body.value : response.body);
      const link = response.body?.value !== undefined ? response.body.link : response.link;
      if (!Array.isArray(body)) throw new Error('Expected a GitHub list response.');
      yield body;
      const next = /<([^>]+)>;\s*rel="next"/.exec(link || '')?.[1];
      url = next ? this.url(next) : null;
    }
  }
  async *artifacts(repository) {
    if (!REPOSITORY.test(repository) || repository.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid repository.');
    const prefix = 'repos/' + repository;
    const metadataResult = await this.get(prefix);
    const metadata = metadataResult.body?.value ?? metadataResult.body;
    if (metadata.private !== false) throw new Error('Only explicitly public repositories are ingested.');
    const make = (row, kind, parent = null, title = '') => {
      const url = new URL(row.html_url);
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/' + repository + '/')) throw new Error('GitHub artifact URL is outside the configured repository.');
      return {
        repository, kind, id: String(row.id), url: url.href, parent,
        title: row.title || title || kind, body: row.body || '',
        state: row.state || '', author: row.user?.login || '',
        updatedAt: row.updated_at || row.submitted_at || row.created_at || '',
        labels: (row.labels || []).map(label => typeof label === 'string' ? label : label.name).sort(),
      };
    };
    for await (const page of this.pages(prefix + '/issues?state=all&sort=updated&direction=asc&per_page=100')) {
      for (const issue of page) {
        yield make(issue, issue.pull_request ? 'pull-request' : 'issue');
        const parent = issue.html_url;
        for await (const comments of this.pages(prefix + '/issues/' + issue.number + '/comments?per_page=100')) {
          for (const comment of comments) yield make(comment, 'issue-comment', parent, issue.title);
        }
        if (issue.pull_request) {
          for await (const reviews of this.pages(prefix + '/pulls/' + issue.number + '/reviews?per_page=100')) {
            for (const review of reviews) yield make(review, 'review', parent, issue.title);
          }
          for await (const comments of this.pages(prefix + '/pulls/' + issue.number + '/comments?per_page=100')) {
            for (const comment of comments) yield make(comment, 'review-comment', parent, issue.title);
          }
        }
      }
    }
  }
}
