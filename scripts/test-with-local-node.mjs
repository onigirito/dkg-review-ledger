import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const cli = process.argv[2];
if (!cli) throw new Error('Pass the installed DKG v10.0.20 CLI entrypoint.');
const port = Number(process.env.DKG_TEST_API_PORT || 19200);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('DKG_TEST_API_PORT must be an unused unprivileged TCP port.');
const url = 'http://127.0.0.1:' + port;
const home = await mkdtemp(path.join(tmpdir(), 'dkg-review-ledger-test-'));
await mkdir(home, { recursive: true });
await writeFile(path.join(home, 'config.json'), JSON.stringify({
  name: 'review-ledger-integration-test', nodeRole: 'edge', listenPort: 0,
  apiHost: '127.0.0.1', apiPort: port, auth: { enabled: true },
  relay: 'none', bootstrapPeers: [], store: { backend: 'oxigraph' },
  chain: { type: 'mock', chainId: 'mock:31337' }, swmAwaitCuratorAck: true,
  autoUpdate: { enabled: false }, telemetry: { enabled: false },
}), { mode: 0o600 });
const env = { ...process.env, DKG_HOME: home };
const node = spawn(process.execPath, [path.resolve(cli), 'start', '--foreground'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
let diagnostics = '';
node.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-12000); });
const terminated = once(node, 'exit');
try {
  let token;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (node.exitCode !== null) throw new Error('The unmodified DKG node exited before readiness.');
    try {
      token = (await readFile(path.join(home, 'auth.token'), 'utf8')).split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith('#'));
      const response = await fetch(url + '/api/agent/identity', {
        headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(1000),
      });
      if (response.ok) break;
      token = undefined;
    } catch { token = undefined; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!token) throw new Error('The local DKG node did not become ready.');
  const registration = await fetch(url + '/api/agent/register', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'DKG Review Ledger test', framework: 'generic-HTTP' }),
  });
  if (!registration.ok) throw new Error('Test agent registration returned HTTP ' + registration.status);
  const agent = await registration.json();
  if (!agent.authToken || !agent.agentAddress) throw new Error('Test agent registration was incomplete.');
  const agentFile = path.join(home, 'test-agent.json');
  await writeFile(agentFile, JSON.stringify(agent), { mode: 0o600 });
  const readerRegistration = await fetch(url + '/api/agent/register', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'DKG Review Ledger independent reader test', framework: 'generic-HTTP' }),
  });
  if (!readerRegistration.ok) throw new Error('Independent test reader registration returned HTTP ' + readerRegistration.status);
  const reader = await readerRegistration.json();
  if (!reader.authToken || !reader.agentAddress || reader.agentAddress.toLowerCase() === agent.agentAddress.toLowerCase()) throw new Error('The two test agents must have distinct identities.');
  const readerFile = path.join(home, 'reader-agent.json');
  await writeFile(readerFile, JSON.stringify(reader), { mode: 0o600 });
  const tests = spawn(process.execPath, ['--test', 'test/local-node.integration.mjs'], {
    env: { ...process.env, DKG_API_URL: url, DKG_AGENT_FILE: agentFile,
      DKG_OBSERVER_AGENT_FILE: readerFile }, stdio: 'inherit',
  });
  const [code] = await once(tests, 'exit');
  if (code !== 0) throw new Error('Local DKG integration tests failed.');
} catch (error) {
  // Never print credentials, generated keys or the private node log.
  throw new Error(error.message + (diagnostics.includes('InventoryV1OpenError') ? ' (node storage initialization)' : ''));
} finally {
  if (node.exitCode === null) node.kill('SIGTERM');
  await Promise.race([terminated, new Promise((_, reject) => setTimeout(() => reject(new Error('DKG node shutdown timed out.')), 15000))]);
}
