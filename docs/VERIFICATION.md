# Verification

The standalone integration was checked using Node.js 22.23.1 and the unmodified, separately installed DKG v10.0.20 node. The local node uses Oxigraph, an isolated mock chain, authentication with scoped agent tokens and Curator acknowledgement. This checks the real WM/SWM HTTP lifecycle; it does not claim public-network gossip or blockchain publication.

The fourteen unit/HTTP tests passed, with no failures or skipped tests. The local-node integration test also passed without a skip in an isolated Linux network namespace: lossless Working Memory write/read, unchanged-source replay, two changed-head revisions, case-insensitive GitHub repository correspondence, older-review correspondence, sealed Curator SHARE, Shared Memory readback and idempotent repeat SHARE.

The tested DKG adapter SHA-256 is `cd347021b65a4889d73473d7b2ddd1f72868172b58feb8a2b786b8a3ec2832a8`. The tested integration-test SHA-256 is `2a22ff3679a3b4b7727cdb200461e46837f3b8919a632511fb2fa5be3b232bf1`. GitHub fixtures in the automated integration test are synthetic and explicitly labelled as test data. The live demo uses separately captured public GitHub records.

The v0.1.1 deployment preserved five existing public GitHub snapshots through a consistent-read export and public-API restoration. Complete content digests, observation times and selected WM/SWM states matched before and after a node/application restart. Eighteen public page/API routes passed after switching the existing demo URL; anonymous writes returned 401. The replacement uses separate node/application service users, a persistent node store, an application-scoped credential and a dedicated case network. Source code is read-only to the runtime users. Existing snapshots and source deployment records were retained when the former service was retired. The registration helper verifies and reuses an existing credential, and readiness verifies the configured agent against the node.

To repeat the test with an independently running authenticated node:

```sh
DKG_API_URL=http://localhost:9200 DKG_AUTH_TOKEN="$DKG_AUTH_TOKEN" npm run test:integration
```

The release workflow also installs the exact separate DKG node and invokes `scripts/test-with-local-node.mjs` against a fresh isolated node home. It runs the same integration test before publishing a container. The runner creates only ephemeral test credentials; none are included in the package or logs. Release provenance binds the container digest to the exact source commit and workflow.
