import { randomUUID } from 'node:crypto';
import { artifactToAsset, canonical } from './rdf.mjs';

export async function syncReviews({ repository, pull, graph, source, dkg, journal }) {
  graph ||= await dkg.projectGraph(repository);
  const owner = randomUUID();
  const lock = graph + ':' + repository;
  journal.acquire(lock, owner);
  const run = journal.startRun(repository);
  const results = [];
  try {
    await dkg.ensureGraph(graph, repository);
    for await (const snapshot of source.snapshots(repository, { pull })) {
      journal.renew(lock, owner);
      const prepared = artifactToAsset(snapshot, graph);
      const previous = journal.asset(prepared.name);
      const asset = previous ? JSON.parse(previous.payload) : prepared;
      if (canonical(asset.artifact) !== canonical(snapshot) || asset.contextGraphId !== graph) throw new Error('Snapshot identity collision.');
      journal.prepare(asset);
      journal.assertOwner(lock, owner);
      const receipt = await dkg.ensureAsset(asset);
      journal.mark(asset.name, receipt.status || 'wm-verified', receipt);
      results.push({ ...receipt, source: snapshot.url, observedAt: asset.observedAt, reused: Boolean(previous) });
    }
    const summary = { repository, graph, complete: true, snapshots: results.length, reused: results.filter(item => item.reused).length, assets: results };
    journal.finishRun(run, 'complete', summary);
    return summary;
  } catch (error) {
    journal.finishRun(run, 'incomplete', { confirmedSnapshots: results.length, code: error.constructor.name });
    throw error;
  } finally { journal.release(lock, owner); }
}
