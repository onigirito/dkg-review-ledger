# Security and authority

## Credential and egress boundaries

- GitHub REST requests go to `api.github.com`. A GitHub token is optional and should be limited to reading the configured public repositories. The integration never writes to GitHub.
- DKG requests go only to the operator-configured `DKG_API_URL` origin. The default is the local node. Remote nodes must use HTTPS; credential-bearing URLs, query parameters in the base URL and redirects are refused.
- `DKG_AUTH_TOKEN`, optional `GITHUB_TOKEN` and `SERVICE_AUTH_TOKEN` come from the environment. No token is written into the journal, returned to the browser or included in public receipts. Each credential is used only for its own service.
- The service accepts only the bounded `REPOSITORIES` allowlist and refuses repositories that GitHub marks private. It does not fetch links embedded in a review, patch, comment or check output.

## Declared DKG operations

Mutations:

1. `POST /api/context-graph/create`: create a local, unregistered project Context Graph (`register:false`).
2. `POST /api/knowledge-assets`: create a content-addressed WM Knowledge Asset with `finalize:false`, `alsoShareSwm:false`, `alsoPublishVm:false`.
3. `POST /api/knowledge-assets/{name}/wm/write`: append missing expected quads when reconciling a known partial draft, preserving its lifecycle.
4. `POST /api/knowledge-assets/{name}/swm/share`: explicit **SHARE**, a **Curator-authority** operation, with `awaitCuratorAck:true`. It is never performed by sync. The service requires the exact selected snapshot and digest; the node remains responsible for authorization and sealing.

Reads use `GET /api/knowledge-assets/{name}`, `GET /api/knowledge-assets/{name}/wm/quads` and `POST /api/query`. Queries are constructed by the integration, contain escaped literals and accept only WM/SWM views. Arbitrary user SPARQL is not exposed. Although query uses POST, it performs no state mutation.

There is no PUBLISH, VM mutation, staking, wallet funding, on-chain registration, endorsement or voting operation. A successful content comparison is not described as consensus verification.

## Source content and recovery

All source text is untrusted data. It is retained verbatim in a canonical snapshot with its source URL and digest. No model is invoked on that content, no remote module is imported, and no dynamic code is evaluated. The browser uses `textContent` and a restrictive content-security policy. Historical snapshots remain independent of current branch state.

Pagination is capped at 100 pages per list, snapshots at 8 MiB and control requests at 64 KiB. A missing changed-file listing or a moved PR fails capture. GitHub may supply truncated patch excerpts; the integration never claims they are full diffs. Stored content is read back after writes. An ambiguous result is reconciled against the same identity before further mutation. Unexpected extra quads cause a refusal and remain intact.

The SQLite journal provides repository leases and incomplete-run records. Only one controller should own a journal/Context Graph pair; an expired lease is refused before another write. Keep the journal volume across service restarts. The public read demo has no anonymous control endpoints.

## Dependencies and disclosure

The application has no third-party runtime npm dependencies and no install lifecycle scripts. The DKG node is a separately installed, operator-managed dependency. Published container releases will include a pinned digest and build provenance. Node/base-image advisories and the separate DKG node's dependency advisories are reviewed independently of the zero-dependency application audit.

Report a vulnerability privately to contact@shadowharness.com. Include the affected version and a bounded reproduction. Do not place credentials in public issues.
