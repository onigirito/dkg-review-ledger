# DKG Review Ledger

Commit-aware pull-request review and CI evidence for autonomous engineering agents. Capture a complete changed-file listing, discussions, reviews and check runs from a public GitHub pull request into a lossless, content-addressed Knowledge Asset on a DKG v10 node. An agent can then ask which reviews and checks refer to the captured head, inspect previous snapshots, and explicitly SHARE a selected snapshot through the node's Curator.

The integration is a standalone Node.js service and CLI. It consumes the authenticated DKG HTTP API; it does not import DKG internals or run inside the daemon.

## Quick start

Requires Node.js 22.13+ and an independently running DKG v10.0.20+ node. Use a public repository you are entitled to process. Set credentials in your environment; do not place them in commands, commits or URLs.

```sh
export REPOSITORIES=owner/project
export DKG_API_URL=http://localhost:9200
# Initial registration uses the node-operator token file only for registration.
export DKG_NODE_TOKEN_FILE=/private/dkg-node/auth.token
node scripts/register-agent.mjs --output /private/review-ledger/agent.json
unset DKG_NODE_TOKEN_FILE
export DKG_AGENT_FILE=/private/review-ledger/agent.json
# Optional: a read-only GitHub token increases the API rate limit.
export GITHUB_TOKEN

node src/cli.mjs sync --repo owner/project --pull 42
node src/cli.mjs review-state --repo owner/project --pull 42
node src/cli.mjs history --repo owner/project --pull 42
node src/cli.mjs search --query "replay receipt"
```

The saved credential must belong to a registered custodial agent. The node-operator token is used only for initial registration; it cannot identify the application agent or create its scoped project graph. Registration verifies the returned identity without printing credentials. Keep the file outside the checkout with mode `0600`. An existing credential file is verified and reused; an uncertain registration is reconciled before retrying.

Review-state returns the captured head and base commits, source-reported review states, check conclusions, file count, missing source-provided patches, and `appliesToCapturedHead` for each review/check. A review on an older commit stays in the record and is identified as such. A successful check is GitHub-reported evidence, not an independent proof that the implementation is correct. Output retains canonical source links and a SHA-256 digest.

Running sync again with unchanged source data reuses the same Knowledge Asset and observation time, verifies its stored quads, and does not create another revision. Changed source content produces a new immutable snapshot. Capture checks the PR head, base and update time before and after gathering evidence; a moving PR is rejected rather than stored as a mixed-commit record. A failed traversal is recorded as incomplete in the local SQLite journal.

GitHub can omit or truncate diff patches. The integration requires the complete changed-file listing, retains only the patches GitHub supplied, and labels them as excerpts. It does not claim to contain a complete source-tree checkout. Large snapshots over 8 MiB and pagination beyond 100 pages fail explicitly.

## Agent HTTP surface

```sh
export SERVICE_AUTH_TOKEN # independent operator credential for this service
node src/server.mjs
```

The service binds to localhost by default. Agents send the service bearer token for all application API calls. `PUBLIC_READ=true` permits anonymous reads of the configured public projects for a demo; writes still require the operator credential. An unconfigured repository is refused. The underlying DKG and GitHub tokens are never returned to clients.

| Route | Purpose |
| --- | --- |
| `GET /api/projects` | Configured public projects |
| `GET /api/search?repository=owner/project&q=text` | Query captured snapshots from DKG |
| `GET /api/history?repository=owner/project&pull=42` | Snapshot history, newest observation first |
| `GET /api/review-state?repository=owner/project&pull=42` | Commit correspondence in the latest snapshot |
| `GET /api/review-state?...&name=github-...` | Inspect a specific historical snapshot |
| `POST /api/sync` | Capture `{"repository":"owner/project","pull":42}` |
| `POST /api/share` | SHARE exact `name` and `expectedDigest` after agent/operator selection |

Read routes accept `view=shared-working-memory` to inspect snapshots available in Shared Memory. This is separate from `working-memory`, the default. Sharing does not happen on sync. The browser demo is a read-only inspection surface; it does not offer endorsement or voting controls.

## Sharing and promotion

```sh
node src/cli.mjs share --repo owner/project --name github-EXACT_SNAPSHOT_NAME
node src/cli.mjs history --repo owner/project --pull 42 --view shared-working-memory
```

SHARE calls `POST /api/knowledge-assets/{name}/swm/share` with `awaitCuratorAck:true`. The node seals the complete Knowledge Asset and applies Curator authority. The client requires a sealed share response, checks the lifecycle descriptor and reads the snapshot back through Shared Memory before reporting success. A timed-out response is reconciled against the same identity; a refused or unconfirmed share stays incomplete. No PUBLISH, gas funding, staking, endorsement or voting operation is implemented.

Another agent can read the writer's shared project using its own scoped credential. The writer supplies its agent address with the shared project metadata:

```sh
# DKG_AGENT_FILE belongs to the reader; WRITER_AGENT_ADDRESS identifies the shared project.
node src/cli.mjs history --repo owner/project --pull 42 \
  --view shared-working-memory --shared-owner "$WRITER_AGENT_ADDRESS"
node src/cli.mjs review-state --repo owner/project --pull 42 \
  --view shared-working-memory --shared-owner "$WRITER_AGENT_ADDRESS"
```

`--shared-owner` selects the writer's repository-specific project for Shared Memory search, history and review-state. The reader remains authenticated under its own identity, and the node controls access. Sync and SHARE always use the writer's own project and credential. The option cannot select another agent's Working Memory or redirect writes.

See [DESIGN.md](DESIGN.md) for the Verifiable Memory and context-oracle promotion path, [SECURITY.md](SECURITY.md) for authority and egress, and [MAINTENANCE.md](MAINTENANCE.md) for support.

## Container and live demo

Published releases use the equivalent verifiable container registry at `ghcr.io/onigirito/dkg-review-ledger`, with a version tag, an immutable image digest, an SBOM and signed GitHub source provenance. The separate DKG node remains operator-managed. No DKG internals or credentials are bundled in the image.

On Linux, with a local DKG node and credentials already set in your environment:

```sh
docker run --rm --network container:dkg-case-node \
  -e BIND_HOST=127.0.0.1 -e PORT=8080 \
  -e REPOSITORIES -e DKG_API_URL -e SERVICE_AUTH_TOKEN \
  -e DKG_AGENT_FILE=/run/secrets/dkg-agent.json \
  --mount type=bind,src="$DKG_AGENT_FILE",dst=/run/secrets/dkg-agent.json,readonly \
  --mount type=volume,src=review-ledger-data,dst=/data \
  ghcr.io/onigirito/dkg-review-ledger:v0.1.2
```

`dkg-case-node` is a dedicated, operator-managed DKG container with its application port reachable by the reverse proxy. Set `PORT` to that port. The application shares only that case's network namespace and receives its own read-only agent credential file. Persist both the journal volume and the separate node's store across restarts. See [deployment](docs/DEPLOYMENT.md) for isolation and a verified cutover, and [verification](docs/VERIFICATION.md) for the tested node baseline. Signed releases can be checked with `gh attestation verify oci://ghcr.io/onigirito/dkg-review-ledger@sha256:EXACT_RELEASE_DIGEST --repo onigirito/dkg-review-ledger`.

The [live read-only demo](https://shadowharness.com/demos/dkg-review-ledger/) queries captured public GitHub review records from a real DKG v10 node. Automated local-node tests use separate, labelled synthetic fixtures. Operators capture and SHARE through the authenticated agent API; the demo offers inspection of immutable snapshots and commit correspondence.

## Tests

```sh
npm test
# Start a separate, authenticated local DKG v10 node first:
npm run test:integration
```

Unit/HTTP tests exercise cache pagination, credential boundaries, moving-head refusal, incomplete captures, binary-file patch omission, snapshot replay, lossless Unicode, ambiguous write reconciliation, concurrent sync rejection, Curator refusal and anonymous write refusal. The integration test makes real HTTP calls to an unmodified DKG node: WM write/read, replay, two revisions, old-review correspondence, sealed SHARE and SWM readback. Its GitHub evidence is explicitly synthetic test data. If no DKG token is set, that test is skipped; a skipped test does not establish node compatibility.

Apache-2.0. Maintained by the ShadowHarness project, contact: contact@shadowharness.com.
