import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DkgClient } from '../src/dkg.mjs';

const { values } = parseArgs({ options: { output: { type: 'string' }, name: { type: 'string', default: 'DKG Review Ledger' } } });
if (!values.output) throw new Error('Provide --output for a private agent credential file.');
const output = path.resolve(values.output);
const url = process.env.DKG_API_URL || 'http://localhost:9200';
let existing;
try { existing = JSON.parse(await fs.readFile(output, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing) {
  const identity = await new DkgClient({ url, token: existing.authToken }).request('GET', '/api/agent/identity');
  if (identity.agentAddress?.toLowerCase() !== existing.agentAddress?.toLowerCase()) throw new Error('Saved agent identity differs; reconcile the credential file.');
  console.log('Existing agent credential verified.');
} else {
  const pending = output + '.registration-pending';
  try { await fs.access(pending); throw new Error('Registration outcome is uncertain; reconcile the saved intent with the node before retrying.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!process.env.DKG_NODE_TOKEN_FILE) throw new Error('Set DKG_NODE_TOKEN_FILE to the private node-operator auth.token file for initial registration.');
  const nodeToken = (await fs.readFile(process.env.DKG_NODE_TOKEN_FILE, 'utf8')).split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
  if (!nodeToken) throw new Error('The node-operator token file is empty.');
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await fs.writeFile(pending, JSON.stringify({ agentName: values.name, startedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
  const agent = await new DkgClient({ url, token: nodeToken }).request('POST', '/api/agent/register', { name: values.name, framework: 'generic-HTTP' });
  if (!agent.authToken || !/^0x[a-fA-F0-9]{40}$/.test(agent.agentAddress || '') || agent.mode !== 'custodial') throw new Error('The node did not return complete custodial agent credentials.');
  // Persist a successful registration before making another network request.
  const credential = { agentAddress: agent.agentAddress, authToken: agent.authToken, mode: agent.mode };
  await fs.writeFile(output, JSON.stringify(credential) + '\n', { mode: 0o600, flag: 'wx' });
  const identity = await new DkgClient({ url, token: agent.authToken }).request('GET', '/api/agent/identity');
  if (identity.agentAddress?.toLowerCase() !== agent.agentAddress.toLowerCase()) throw new Error('Registered agent identity did not match.');
  await fs.unlink(pending);
  console.log('Agent credential saved and verified. Credentials were not printed.');
}
