import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { configuration } from './config.mjs';
import { DkgClient } from './dkg.mjs';
import { GitHubClient } from './github.mjs';
import { Journal } from './journal.mjs';
import { ReviewSource, assessSnapshot } from './reviews.mjs';
import { syncReviews } from './sync.mjs';

const equalToken = (left, right) => timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
const json = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
};
async function body(request) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error(), { httpStatus: 415 });
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 65536) throw Object.assign(new Error(), { httpStatus: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error(), { httpStatus: 400 }); }
}
export function createService(config, { dkg, journal, source } = {}) {
  const owned = !journal;
  journal ||= new Journal(config.file);
  dkg ||= new DkgClient({ url: config.dkgUrl, token: config.dkgToken });
  source ||= new ReviewSource(new GitHubClient({ token: config.githubToken, journal }));
  let busy = false;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/') {
        const page = await readFile(new URL('../public/index.html', import.meta.url));
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'" });
        return response.end(page);
      }
      if (request.method === 'GET' && url.pathname === '/app.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        return response.end(await readFile(new URL('../public/app.js', import.meta.url)));
      }
      if (request.method === 'GET' && url.pathname === '/style.css') {
        response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        return response.end(await readFile(new URL('../public/style.css', import.meta.url)));
      }
      if (request.method === 'GET' && url.pathname === '/api/health') {
        await dkg.projectGraph(config.repositories[0]);
        return json(response, 200, { status: 'ready', version: '0.1.1', integration: 'dkg-review-ledger', dkg: 'authenticated-agent' });
      }
      const token = (request.headers.authorization || '').replace(/^Bearer /, '');
      const authorized = config.serviceToken && equalToken(token, config.serviceToken);
      const publicGet = config.publicRead && request.method === 'GET';
      if (!authorized && !publicGet) return json(response, 401, { error: 'AUTH_REQUIRED' });
      if (request.method === 'GET' && url.pathname === '/api/projects') return json(response, 200, { repositories: config.repositories, writeEnabled: Boolean(authorized) });
      const input = request.method === 'GET' ? Object.fromEntries(url.searchParams) : await body(request);
      const requestedRepository = input.repository || config.repositories[0];
      const repository = typeof requestedRepository === 'string'
        ? config.repositories.find(item => item.toLowerCase() === requestedRepository.toLowerCase()) : undefined;
      if (!repository) return json(response, 400, { error: 'REPOSITORY_NOT_CONFIGURED' });
      const pull = input.pull === undefined ? undefined : Number(input.pull);
      if (pull !== undefined && (!Number.isSafeInteger(pull) || pull < 1)) return json(response, 400, { error: 'INVALID_PULL' });
      const graph = await dkg.projectGraph(repository);
      const view = input.view || 'working-memory';
      if (request.method === 'GET' && ['/api/search', '/api/history', '/api/review-state'].includes(url.pathname)) {
        if (url.pathname !== '/api/search' && pull === undefined) return json(response, 400, { error: 'PULL_REQUIRED' });
        const rows = await dkg.listSnapshots(graph, { query: input.q || '',
          source: pull === undefined ? undefined : 'https://github.com/' + repository + '/pull/' + pull,
          limit: url.pathname === '/api/review-state' ? 1 : Number(input.limit || 20), view });
        if (url.pathname !== '/api/review-state') return json(response, 200, { repository, memoryLayer: view, snapshots: rows });
        if (!rows.length && !input.name) return json(response, 404, { error: 'NO_CAPTURED_SNAPSHOT' });
        const captured = await dkg.loadSnapshot(graph, input.name || rows[0].name, view);
        if (captured.snapshot.repository.toLowerCase() !== repository.toLowerCase() || Number(captured.snapshot.id) !== pull) return json(response, 400, { error: 'SNAPSHOT_SCOPE_MISMATCH' });
        return json(response, 200, { name: captured.name, digest: captured.digest, observedAt: captured.observedAt,
          memoryLayer: view, evidence: assessSnapshot(captured.snapshot) });
      }
      if (request.method === 'POST' && ['/api/sync', '/api/share'].includes(url.pathname)) {
        if (!authorized) return json(response, 403, { error: 'OPERATOR_AUTH_REQUIRED' });
        if (busy) return json(response, 409, { error: 'OPERATION_IN_PROGRESS' });
        busy = true;
        try {
          if (url.pathname === '/api/sync') return json(response, 200, await syncReviews({ repository, pull, graph, source, dkg, journal }));
          const saved = journal.asset(input.name || '');
          if (!saved || saved.repository !== repository) return json(response, 400, { error: 'EXACT_SNAPSHOT_REQUIRED' });
          const asset = JSON.parse(saved.payload);
          if (input.expectedDigest !== asset.digest) return json(response, 409, { error: 'SNAPSHOT_DIGEST_REQUIRED' });
          journal.mark(asset.name, 'share-pending');
          const receipt = await dkg.share(asset);
          journal.mark(asset.name, 'swm-verified', receipt);
          return json(response, 200, { name: asset.name, digest: asset.digest, receipt });
        } finally { busy = false; }
      }
      return json(response, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      return json(response, error.httpStatus || (error.status >= 400 && error.status < 600 ? error.status : 502), {
        error: error.code || (error.constructor.name === 'BusyError' ? 'SYNC_BUSY' : 'INTEGRATION_REQUEST_FAILED'),
      });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on('close', () => { if (owned) journal.close(); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = configuration();
    const server = createService(config);
    server.listen(config.port, config.host, () => process.stdout.write('DKG Review Ledger service is listening.\n'));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
