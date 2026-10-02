# DKG Review Ledger — design brief

## Problem and target user

An autonomous engineering agent needs to know which evidence still describes the code it is considering. A review may approve one commit while the pull-request branch has advanced. A CI check may be queued, complete, superseded or associated with a different commit. Re-reading a discussion without these identities can turn an old observation into a current conclusion.

This integration serves engineering and research agents that work across sessions, revisit earlier implementation choices, or share an evidence packet with another agent. It connects a project's GitHub workflow to DKG memory with reproducible snapshots and explicit commit correspondence. The distinct capability is an atomic, commit-aware review evidence packet, rather than generic issue ingestion or semantic summarization. It can coexist with other GitHub ingestion integrations.

## Project and memory model

Each configured public repository maps to a deterministic Context Graph. A pull-request snapshot is a Knowledge Asset; authored reviews, check runs, file excerpts and comments are source entities within that asset. RDF records their canonical sources with PROV `wasDerivedFrom`, their commit identities, the source update time, the first observation time and a SHA-256 digest of the canonical source snapshot.

The default layer is **Working Memory**: private draft observations held on the operator's node. Source text is labelled `untrusted-source-content`; quoted GitHub content never becomes an instruction to this service. An agent selects a specific snapshot and may **SHARE** it into **Shared Memory**. The DKG node seals the asset and owns the Curator authority decision. Sync never automatically shares or publishes.

There is no binary "verified/unverified" UI. Source-reported evidence, local content readback, the sealed Shared Memory state and future on-chain verification are separate facts. The service's internal `wm-verified` journal label means exact content readback only; it does not represent the v10 Verifiable Memory layer.

The integration exercises Context Graph, Knowledge Asset, Entity and Curator primitives exclusively through the node's authenticated public HTTP API. It does not import internal SDK packages, patch the node or embed itself in the daemon. A local journal coordinates capture/replay, but source content and agent queries live in DKG memory.

## Capture, integrity and replay

1. Verify that GitHub declares the repository public.
2. Read the PR head/base identities and source update time.
3. Retrieve its reviews, discussion comments, review comments, complete changed-file listing and check runs for that exact head. Pagination and response size are bounded; absent patches are recorded rather than invented.
4. Re-read the PR identity. If it moved, store no mixed-head packet.
5. Hash canonical source data and prepare an immutable, deterministically named Knowledge Asset. Repeated identical captures reuse the original observation and identity.
6. Write a WM draft, read it back and compare the complete triple set. An unknown write result is reconciled by reading the same name; unexpected existing content is preserved for inspection.

The journal contains capture outcomes, a repository lease and confirmed identities. A partial run is explicitly incomplete. A failed or timed-out SHARE is reconciled with the lifecycle descriptor and Shared Memory content, not assumed successful. Queries reconstruct the lossless source JSON from ordered RDF chunks and verify the digest before presenting evidence.

## Agent and team workflow

The entry point is an agent: `sync`, `review-state`, `history` and `search` commands, or the authenticated HTTP equivalents. Sensible defaults capture into WM and query WM. A read-only live endpoint lets reviewers inspect source identities and commit correspondence. It offers no consensus, voting or endorsement buttons. Agent-mediated selection of a snapshot calls the explicit SHARE API with the exact digest.

A second agent uses its own scoped node credential and the CLI's `--shared-owner` with the writer's address to select that repository's Shared Memory project. This selection is explicit because each agent's default project belongs to its own identity. It applies only to Shared Memory reads; the writer retains its existing sync and Curator SHARE path.

An agent comparing a new implementation with an earlier review can retrieve two snapshots, identify which review commits still correspond to the captured head, and carry the exact source packet into a team Context Graph. This supports the LLM-Wiki/autoresearch direction by making engineering evidence reusable and traceable across long-running agent work. It does not infer consensus, code correctness or client acceptance from a CI result.

## Promotion path and context-oracle readiness

The snapshot's digest, ordered chunks, named Knowledge Asset, source references and explicit head/base commits are stable inputs for later Curator-controlled **PUBLISH** into **Verifiable Memory**. No rewrite of the source model is required: a future publishing adapter can resolve the asset's canonical UAL and append chain anchoring, self-attestation, endorsement and consensus-verification evidence without changing the captured packet.

A context oracle should consume the captured head, snapshot digest, source timing and the DKG trust state together. It must preserve the distinction between a GitHub check reporting success, an author's attestation and independent verification. Shared Memory is an upstream team evidence substrate, not a terminal guarantee. This release intentionally implements no chain publication or oracle settlement; those are future stages with their own authority and verification gates.

## Security and operation

Only configured public projects are captured. GitHub is read-only. Credentials stay in the process environment; requests do not follow redirects and pagination is constrained to the configured API origin. Remote DKG credentials require HTTPS. Public-demo mode exposes read routes only; state changes require a separate service credential. Authored text is rendered as text, never executed or injected as HTML. Detailed declarations and support are in SECURITY.md and MAINTENANCE.md.
