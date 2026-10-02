# Verification

The standalone integration was checked using Node.js 22.23.1 and the unmodified, separately installed DKG v10.0.20 node. The local node uses Oxigraph, an isolated mock chain, authentication with scoped agent tokens and Curator acknowledgement. This checks the real WM/SWM HTTP lifecycle; it does not claim public-network gossip or blockchain publication.

The seventeen unit/HTTP tests passed, with no failures or skipped tests. Two local-node integration tests also passed without a skip against a fresh isolated node home: lossless Working Memory write/read, unchanged-source replay, two changed-head revisions, case-insensitive GitHub repository correspondence, older-review correspondence, sealed Curator SHARE, Shared Memory readback and idempotent repeat SHARE; and Shared Memory reuse by a separately registered agent through the standard CLI.

The tested DKG adapter SHA-256 is `ef535a728ba99caf4b35223cf3db397a72f442f7f511bdf9c10dd76c8940a56c`. The tested integration-test SHA-256 is `1c6c47be207ad5e0b81ef09d37ea9bb19b166b560a948506fa41862015dd020a`. GitHub fixtures in the automated integration tests are synthetic and explicitly labelled as test data. The live demo uses separately captured public GitHub records.

For the second integration test, the reader keeps its own scoped credential. Its default project contains none of the writer's snapshots. Supplying the writer's agent address with `--view shared-working-memory --shared-owner` selects the shared project; history and review-state return the exact original content digest, observation time and captured head. Unit tests check that the selector is restricted to Shared Memory reads and that malformed owner addresses are refused before a request.

The same CLI was also checked against two separately captured public records, [OriginTrail/dkg #2933](https://github.com/OriginTrail/dkg/pull/2933) and [#2941](https://github.com/OriginTrail/dkg/pull/2941). A distinct reader retrieved both original Shared Memory records with matching digests and observation times. Both automated fixtures and these public-data readbacks used registered identities on one local node with a mock chain.

The v0.1.1 deployment preserved five existing public GitHub snapshots through a consistent-read export and public-API restoration. Complete content digests, observation times and selected WM/SWM states matched before and after a node/application restart. Eighteen public page/API routes passed after switching the existing demo URL; anonymous writes returned 401. The replacement uses separate node/application service users, a persistent node store, an application-scoped credential and a dedicated case network. Source code is read-only to the runtime users. Existing snapshots and source deployment records were retained when the former service was retired. The registration helper verifies and reuses an existing credential, and readiness verifies the configured agent against the node.

To repeat the test with an independently running authenticated node:

```sh
DKG_API_URL=http://localhost:9200 DKG_AGENT_FILE="$WRITER_AGENT_FILE" \
  DKG_OBSERVER_AGENT_FILE="$READER_AGENT_FILE" npm run test:integration
```

The release workflow also installs the exact separate DKG node and invokes `scripts/test-with-local-node.mjs` against a fresh isolated node home. It runs both integration tests before publishing a container. The runner creates ephemeral writer and reader credentials; none are included in the package or logs. When another node already uses the default test port, set `DKG_TEST_API_PORT` to an unused unprivileged port. Release provenance binds the container digest to the exact source commit and workflow.
