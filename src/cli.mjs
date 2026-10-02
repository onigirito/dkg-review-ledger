#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { configuration } from './config.mjs';
import { GitHubClient } from './github.mjs';
import { ReviewSource, assessSnapshot } from './reviews.mjs';
import { DkgClient } from './dkg.mjs';
import { Journal } from './journal.mjs';
import { syncReviews } from './sync.mjs';

export async function run(argv = process.argv.slice(2), env = process.env) {
  const command = argv.shift();
  const { values } = parseArgs({ args: argv, strict: true, options: {
    repo: { type: 'string' }, pull: { type: 'string' }, query: { type: 'string', default: '' },
    name: { type: 'string' }, limit: { type: 'string', default: '20' },
    view: { type: 'string', default: 'working-memory' },
    'shared-owner': { type: 'string' },
  } });
  const config = configuration(env);
  const requestedRepository = values.repo || config.repositories[0];
  const repository = config.repositories.find(item => item.toLowerCase() === requestedRepository.toLowerCase());
  if (!repository) throw new Error('Repository is outside REPOSITORIES.');
  const pull = values.pull === undefined ? undefined : Number(values.pull);
  if (pull !== undefined && (!Number.isSafeInteger(pull) || pull < 1)) throw new Error('Invalid pull-request number.');
  if (values['shared-owner'] !== undefined && (!['search', 'history', 'review-state'].includes(command) || values.view !== 'shared-working-memory')) {
    throw new Error('--shared-owner is available only for Shared Memory search, history and review-state reads.');
  }
  const journal = new Journal(config.file);
  const dkg = new DkgClient({ url: config.dkgUrl, token: config.dkgToken });
  try {
    const graph = values['shared-owner'] !== undefined
      ? await dkg.sharedProjectGraph(repository, values['shared-owner']) : await dkg.projectGraph(repository);
    if (command === 'sync') return await syncReviews({ repository, pull, graph, journal, dkg,
      source: new ReviewSource(new GitHubClient({ token: config.githubToken, journal })) });
    if (command === 'search' || command === 'history' || command === 'review-state') {
      if (command !== 'search' && pull === undefined) throw new Error('--pull is required.');
      const rows = await dkg.listSnapshots(graph, {
        source: pull === undefined ? undefined : 'https://github.com/' + repository + '/pull/' + pull,
        query: values.query, limit: command === 'review-state' ? 1 : Number(values.limit), view: values.view,
      });
      if (command !== 'review-state') return rows;
      if (!rows.length) throw new Error('No captured snapshot for this pull request.');
      const snapshot = await dkg.loadSnapshot(graph, rows[0].name, values.view);
      return { ...snapshot, snapshot: undefined, evidence: assessSnapshot(snapshot.snapshot), memoryLayer: values.view };
    }
    if (command === 'share') {
      const saved = journal.asset(values.name || '');
      if (!saved || saved.repository !== repository) throw new Error('An exact locally recorded snapshot --name is required.');
      const asset = JSON.parse(saved.payload);
      journal.mark(asset.name, 'share-pending');
      const receipt = await dkg.share(asset);
      journal.mark(asset.name, 'swm-verified', receipt);
      return { name: asset.name, digest: asset.digest, receipt };
    }
    throw new Error('Commands: sync, search, history, review-state, share. Credentials are read from the environment.');
  } finally { journal.close(); }
}
if (import.meta.url === new URL(process.argv[1], 'file:').href || process.argv[1]?.endsWith('cli.mjs')) {
  run().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch(error => {
    process.stderr.write(error.message + '\n'); process.exitCode = 1;
  });
}
