import path from 'node:path';
import { readFileSync } from 'node:fs';
import { validRepository } from './reviews.mjs';
export function configuration(env = process.env) {
  const repositories = (env.REPOSITORIES || '').split(',').map(item => item.trim()).filter(Boolean);
  if (!repositories.length || repositories.length > 20 || repositories.some(repository => !validRepository(repository))) throw new Error('Set REPOSITORIES to a bounded list of public owner/repo names.');
  const agent = env.DKG_AGENT_FILE ? JSON.parse(readFileSync(env.DKG_AGENT_FILE, 'utf8')) : undefined;
  const dkgToken = env.DKG_AUTH_TOKEN || agent?.authToken;
  if (!dkgToken) throw new Error('Set DKG_AGENT_FILE to a registered agent credential file, or provide an agent-scoped DKG_AUTH_TOKEN.');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid service port.');
  return {
    repositories, dkgUrl: env.DKG_API_URL || 'http://localhost:9200', dkgToken,
    githubToken: env.GITHUB_TOKEN || '', file: env.JOURNAL_PATH || path.resolve('.runtime/reviews.sqlite'),
    serviceToken: env.SERVICE_AUTH_TOKEN || '', publicRead: env.PUBLIC_READ === 'true',
    host: env.BIND_HOST || 'localhost', port,
  };
}
