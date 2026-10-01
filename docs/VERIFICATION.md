# Verification

The standalone integration was checked using Node.js 22.23.1 and the unmodified, separately installed DKG v10.0.20 node. The local node uses Oxigraph, an isolated mock chain, authentication with scoped agent tokens and Curator acknowledgement. This checks the real WM/SWM HTTP lifecycle; it does not claim public-network gossip or blockchain publication.

The twelve unit/HTTP tests passed, with no failures or skipped tests. The local-node integration test also passed without a skip: lossless Working Memory write/read, unchanged-source replay, two changed-head revisions, older-review correspondence, sealed Curator SHARE, Shared Memory readback and idempotent repeat SHARE.

The tested DKG adapter SHA-256 is `fd7b697103966b24828cf056cf726eb5338ae56a5dffd022624b5098fd1485f4`. The tested integration-test SHA-256 is `9c4fc61d3e351cc93db719cfe6705e3ddfeacaa0bfc27b9c34e8e6b2b59964cc`. GitHub fixtures in the automated integration test are synthetic and explicitly labelled as test data. The live demo uses separately captured public GitHub records.

To repeat the test with an independently running authenticated node:

```sh
DKG_API_URL=http://localhost:9200 DKG_AUTH_TOKEN="$DKG_AUTH_TOKEN" npm run test:integration
```

The release workflow also installs the exact separate DKG node and invokes `scripts/test-with-local-node.mjs` against a fresh isolated node home. It runs the same integration test before publishing a container. The runner creates only ephemeral test credentials; none are included in the package or logs. Release provenance binds the container digest to the exact source commit and workflow.
