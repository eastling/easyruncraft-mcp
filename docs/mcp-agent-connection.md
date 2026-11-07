# MCP OAuth, CLI and plugin distribution

Implemented in the shared main checkout on 2026-11-05. The user explicitly authorized local browser authorization, refresh/revocation and real-file acceptance. The local flow passed 23 recorded checks, including a downloaded PDF rotated 90 degrees with the original unchanged, refresh rotation, rejection paths, disconnect/reconnect, legacy token compatibility and idempotent billing. Evidence: `operations/mcp-oauth-cli-2026-11-05/summary.json`. The same implementation was subsequently deployed and exercised in production as recorded below; it is not a public directory approval.

## Production acceptance — November 5, 2026

Released `bd5d8effcd0cf467d71b6b82af91a0957ad9bc7b` through [Actions run 42033559311](https://github.com/eastling/easyruncraft/actions/runs/42033559311). Both image validation and Dokploy deployment succeeded. The production OAuth metadata, challenge, setup copy and versioned CLI download are live; the public download matched its published SHA-256.

The CLI and Codex Skill were installed on the user’s actual computer from the production tarball. The user completed browser authorization without copying a token. The installed CLI uploaded a synthetic PDF, rotated page 1 by 90 degrees, waited for success and downloaded the independently inspected PDF. The original remained unrotated. Production refresh rotated credentials successfully, and retrying the same request returned the same completed job. The task quote was 1 credit; the account wallet was not separately read. One initial capability request had a transient network failure and succeeded on retry.

The working production connection remains installed and authorized. Production disconnect was not exercised because it would remove that connection; its rejection/reconnect behavior passed locally. No real-card checkout was performed. Evidence and sample PDFs are in `operations/mcp-oauth-production-2026-11-05/`. Native plugin-host import, public directory submission, Windows and a fresh Google-account login remain separate checks.

## User paths

- Local Codex / Claude Code: the website serves a versioned CLI npm tarball. `npx --yes --package https://easyruncraft.com/downloads/easyruncraft-cli-0.1.2.tgz easyruncraft setup --client codex --url https://easyruncraft.com` installs the self-contained CLI and a managed Skill, opens browser authorization, and saves the credentials. Use `--client claude`, `both`, or `none` as needed. Node.js 22+ is required. A new chat may be needed for the Skill to load. The local MCP page supplies the loopback equivalent. Release the updated broker and versioned download together before advertising the new CLI on production.
- Native MCP: add `https://easyruncraft.com/mcp` as Streamable HTTP and authorize with OAuth. Terminal Codex uses `codex mcp add easyruncraft --url https://easyruncraft.com/mcp` followed by `codex mcp login easyruncraft`. This does not require the CLI Skill.
- Manual token: retain the existing 30-day dedicated credentials for scripts and older clients. This is an advanced fallback, not the default onboarding.
- Plugin: `plugins/easyruncraft/` packages the remote endpoint, OAuth declaration, branding and an MCP-specific Skill. It does not rely on a local CLI and does not contain credentials. This source is not an installed, approved or published directory listing.

The CLI is a local MCP client with file-transfer helpers. It does not run the native editors locally, replace the browser editor, install a second AI model or ask for an AI provider key. Processing and billing continue on the existing server.

## Authorization implementation

The dependency set pins Better Auth, MCP, OAuth Provider and CIMD at 1.7.17. Account sessions, email/Google login and the shared wallet remain in place. The additive `0010_mcp_oauth.sql` migration creates provider tables and signing-key storage; it does not rewrite users, sessions, existing tokens or balances.

- Protected resource: `/mcp`, metadata at `/.well-known/oauth-protected-resource/mcp` and its root alias.
- Issuer: `/api/auth`; metadata at `/.well-known/oauth-authorization-server/api/auth`.
- Authorization, exchange and registration: `/api/auth/oauth2/authorize`, `/token`, `/register`.
- Sign-in and consent: `/mcp/connect`. The consent request is signed by the provider and verified before its client identity is displayed. The existing service-hosted Google button and popup fallback remain.
- Scope `mcp:tools`: all existing file tools under the user's account, including successful-task credit charges. No website session or payment/account-management access. `offline_access` permits rotating refresh credentials. Access tokens last five minutes; refresh credentials have a 30-day lifetime governed by the provider.
- S256 PKCE, state, redirect validation, resource-bound audience and issuer checks are required. CIMD uses the bundled DNS-pinned HTTPS transport with private-address and redirect restrictions. DCR supports older MCP clients, has a process-wide registration budget and a 10,000-client ceiling. Ordinary account users cannot manage OAuth clients through provider CRUD APIs.
- The broker accepts dedicated tokens and OAuth bearer access tokens. OAuth JWTs must have `typ=at+jwt`, the correct issuer/audience, `mcp:tools`, and the current consent ID. Website session credentials and other token audiences are rejected. The bearer-only broker does not advertise DPoP support.
- Disconnect removes consent, refresh/access records and outstanding authorization codes for that user/client. JWTs are tied to the deleted consent ID, so reconnecting cannot revive them. File/job ownership is still enforced by the existing broker. Already-running tasks can finish; issued signed file links retain their independent expiry.

## CLI behavior and recovery

The build bundles the pinned MCP SDK and dependency license notices into an npm tarball without runtime npm dependencies or installation hooks. `setup` copies the compiled CLI into the user's `.local/share/easyruncraft/cli/`, installs a marked Skill in `.agents/skills/` or `.claude/skills/`, and does not alter shell startup files or existing MCP entries. It refuses to overwrite an unrelated Skill. Setup remembers the selected `--url`; subsequent commands use that origin unless explicitly overridden. Acceptance used `--client none` and `EASYRUNCRAFT_CONFIG_DIR` to avoid changing the user's global Skills or credentials.

OAuth credentials are isolated by service origin and stored in a restricted-permission file (0600) under a restricted directory (0700). This is file storage, not an OS keychain. Windows users need a private profile ACL. A per-account process lock serializes refresh and prevents concurrent CLI commands from replaying rotating credentials. The browser callback listens only on an ephemeral loopback port and checks state and issuer. The CLI displays the authorization URL when launching a browser is unavailable.

`run` gets a quote and enforces `--max-credits` (default 1), saves a request journal before submission, waits and downloads files without overwriting existing paths. Use `job JOB_ID` after interruption. If the initial response is lost, retry the exact saved arguments with the same request_id; a new request ID can create another charge. Temporary inputs and outputs expire after two hours without file activity. File-specific calls renew the idle deadline. The CLI immediately downloads completed outputs and records their IDs, local paths and content hashes. `restore FILE_ID` can re-upload the exact saved edited version for free after `FILE_UNAVAILABLE`; missing or changed local copies require the agent to identify the latest edited file, never silently use the original. Ordinary chat and discovery do not renew file retention. The `call` command is the lower-level MCP interface; agents must quote paid operations before using it.

## Build and release

- `pnpm check`: Astro and server TypeScript diagnostics.
- `pnpm build:server`: compile the Node API.
- `pnpm build:agents`: bundle CLI, generate third-party notices, npm tarball and SHA-256 file.
- `pnpm build`: builds the agent artifacts before Astro; the web Docker build includes the required packages and scripts.
- The existing GitHub Actions / Dokploy release pipeline remains the only production image/deployment path. The three services must be released together for initial OAuth support. Do not advertise the new installation command against the old deployed API.
- API startup applies the additive migration. Back up the account volume before rollout and retain the prior image combination. Rollback can use the old images without dropping the new provider tables.
- No new provider secret is required. Keep `BETTER_AUTH_SECRET` and the account volume stable; they protect existing sessions and provider signing material.

Do not treat compilation, a built tarball, or `/mcp-health` as OAuth/file-task acceptance. Those local acceptance paths now passed using preview sign-in and one local credit, with no real payment or email. Production Google sign-in for this revision, HTTPS CIMD, native Codex/plugin installation and Windows remain unverified. The local preview continues on port 4350 from the shared checkout.

## Public distribution status

`distribution/server.json` is a remote-server Registry descriptor under the intended domain namespace `com.easyruncraft/mcp`. It needs domain ownership authentication with the official publisher before publication. Registry metadata does not host code or automatically install the server in every client.

`@easyruncraft/cli` is an optional npm publication target, not an existing advertised npm package. The website tarball avoids assuming ownership of that npm scope. Publishing to npm requires the verified publisher's account, scope rights and chosen source-license terms; the source currently makes no open-source license grant for the CLI itself. Bundled third-party licenses remain included.

The plugin archive at `.release/artifacts/easyruncraft-plugin-0.1.0.zip` is an OpenAI-targeted source package, not public-submission-ready. Its root manifest passes the published Agent Plugins schema. The published base MCP schema currently rejects server-level `extensions`, while OpenAI's documented OAuth format requires `extensions.com.openai.auth`; that documented extension is retained. Transport fields validate without the extension, but actual OpenAI host import/connection must still be verified. Do not claim strict cross-host portability from this package check.

Outstanding directory materials are the selected verified publisher identity, country targeting, platform review cases and fixtures, a recorded demo URL, secure reviewer access, and portal attestations. These must not be fabricated or put into public credentials files. The four listing page URLs must be checked after the new release is live, especially updated OAuth privacy wording.

Sources consulted: [Better Auth MCP](https://better-auth.com/docs/plugins/mcp), [CIMD](https://better-auth.com/docs/plugins/cimd), [OpenAI plugin packages](https://developers.openai.com/plugins/build/plugins), [MCP Registry](https://modelcontextprotocol.io/registry/about).
