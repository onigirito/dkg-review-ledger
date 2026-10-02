# Isolated service deployment

Run public service operation and third-party data processing in a dedicated case container. The container owns only its application's data and credentials. Development checkouts, other users' workspaces, host administration credentials and unrelated memory services stay outside its mounts and network authority.

The service uses the public DKG HTTP API on the case container's loopback interface. Run the unmodified node and the application as separate service users, with private data directories and distinct credentials. Only the read-only application port is forwarded through the site's reverse proxy. Do not expose the DKG operator API, SSH, a container manager socket or a host filesystem mount.

Use a separate network or equivalent firewall policy. Permit the outbound connections required for the configured public GitHub source and dependency installation. Deny access to unrelated private networks and instance metadata. Keep instance addresses, real container names, credentials and private deployment receipts in the operator's non-public ledger.

## Registration and service readiness

1. Start a pinned DKG node with authentication and a persistent store enabled.
2. Use `scripts/register-agent.mjs` with the private node-operator token file to register the application agent. Store the returned credential outside the checkout. Give the application only that scoped credential, not the operator token or node's key directory.
3. Configure `DKG_AGENT_FILE`, `REPOSITORIES`, `JOURNAL_PATH` and a separate `SERVICE_AUTH_TOKEN`. Keep public writes authenticated even when `PUBLIC_READ=true` enables the demo's public reads.
4. `/api/health` verifies the application's agent identity against the DKG node before reporting readiness. Also verify a real snapshot route and a full digest readback; a process merely listening does not establish stored-data availability.

## Preserve data and the public URL during migration

Prepare the replacement before changing the public route. Export existing snapshots from a consistent read transaction and record each content digest, observation time and selected Shared Memory state. Import them through the new node's public API, checking complete Working Memory readback and explicit Curator SHARE for previously shared snapshots. New case credentials and graph ownership may change asset names; source content and observation times remain verifiable by their original digests.

Verify the page, static assets, configured projects, history, review-state and Shared Memory routes in the replacement. Confirm anonymous writes and unrelated repository access are refused. Restart the node and application, then repeat digest and identity checks to verify persistence. Switch the existing public URL only after these checks pass, validate the same routes through that URL, then retire the former case service. Keep the export, verification receipts and previous routing configuration in the private operations ledger.
