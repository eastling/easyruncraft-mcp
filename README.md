# EasyRunCraft MCP

EasyRunCraft MCP is the Model Context Protocol broker for [EasyRunCraft](https://easyruncraft.com). Assistants use it to inspect and edit documents, spreadsheets, images, audio, video, and design files. Processing runs on EasyRunCraft native engines and spends the connected account’s EasyRunCraft credits.

| | |
| --- | --- |
| Product | https://easyruncraft.com |
| Setup | https://easyruncraft.com/mcp |
| Pricing | https://easyruncraft.com/pricing |
| Registry name | `com.easyruncraft/mcp` |
| Transport | Streamable HTTP |
| Endpoint | https://easyruncraft.com/mcp |
| Authorization | OAuth, scope `mcp:tools` (refresh uses `offline_access`) |

This repository contains the broker entry point `mcp/server.mjs`, the modules it imports, the public MCP guides in `docs/`, and the registry manifest `server.json`.

## Connect

Add the hosted endpoint to a client that supports MCP Streamable HTTP, then sign in in the browser:

```text
https://easyruncraft.com/mcp
```

EasyRunCraft discovers OAuth metadata from that resource, shows the account login and consent screen, and issues audience-bound access tokens for `mcp:tools`. The same endpoint accepts a dedicated bearer token created in the advanced section of https://easyruncraft.com/mcp.

Codex:

```sh
codex mcp add easyruncraft --url https://easyruncraft.com/mcp
codex mcp login easyruncraft
```

`mcp.json` in this repository is the remote server entry used by agent plugin hosts: Streamable HTTP at the URL above, with OAuth client identity metadata and the `mcp:tools` and `offline_access` scopes.

## Run the broker locally

The supported client endpoint is the hosted URL. This package can also start the same broker on your machine. Node.js 22 or newer is required. Account sign-in and credit billing stay on an EasyRunCraft account API. Native editor binaries are separate runtime releases and are supplied through `MCP_NATIVE_DIR`; they are not stored in this repository.

```sh
npm install
export PUBLIC_URL=http://127.0.0.1:4350
export ACCOUNT_API_URL=http://127.0.0.1:8795
export MCP_BILLING_SECRET="$(openssl rand -hex 32)"
npm start
```

`npm start` runs `node mcp/server.mjs`. In development the process listens on `127.0.0.1:8796`. `PUBLIC_URL` and `ACCOUNT_API_URL` must be loopback addresses. A call to `/mcp` proceeds after `ACCOUNT_API_URL` accepts the bearer token at `/api/mcp/authenticate`.

| Variable | Development default | Role |
| --- | --- | --- |
| `MCP_PORT` | `8796` | Listen port |
| `LISTEN_HOST` | `127.0.0.1` | Listen address |
| `PUBLIC_URL` | `http://127.0.0.1:4350` | Public origin used for OAuth resource metadata and signed file URLs |
| `ACCOUNT_API_URL` | `http://127.0.0.1:8795` | Account API for authentication and billing |
| `MCP_BILLING_SECRET` | unset | Shared secret for `/api/mcp/billing`; required before a task can reserve credits (at least 32 characters) |
| `MCP_DATA_DIR` | `.data/dev/mcp-files` | Private uploads, outputs, and file metadata |
| `MCP_NATIVE_DIR` | `.cache/native` | Installed native editor executables |
| `MCP_WORK_DIR` | `.cache/mcp-work` | Per-job work directories |
| `MCP_CONCURRENCY` | `2` | Running jobs, from 1 to 4 |
| `RUNTIME_STORE_DIR` | unset | Runtime release store used by the release endpoint |
| `RUNTIME_RELEASE_SECRET` | unset | Bearer secret for runtime release publication |
| `NODE_ENV` | unset | `production` selects the Linux production listener, HTTPS origin, and uid-isolated jobs |

`GET /mcp-health` reports whether each native engine is present. File-processing tools need those engines. The hosted service at https://easyruncraft.com/mcp already has them installed.

## Tools

`service_info`, `quote_task`, `create_upload`, `inspect_file`, `edit_spreadsheet`, `pdf_capabilities`, `query_pdf`, `edit_pdf`, `export_pdf`, `editor_capabilities`, `process_photo`, `process_word`, `process_deck`, `process_vector`, `process_fig`, `process_cad`, `process_design`, `process_light`, `process_sound`, `process_film`, `process_effect`, `get_job`, `cancel_job`, `delete_file`.

Upload with `create_upload`, PUT the bytes to the returned URL, then call the tool that matches the format. `quote_task` returns the price before a job is submitted. Poll `get_job` for the result. Successful file-processing requests cost 1 credit, including inspections, audio conversion, video export, and animation rendering. Uploads, quotes, capability checks, status polls, and downloads have no separate charge. Plan terms are on https://easyruncraft.com/pricing.

Temporary files expire after 2 hours without activity on that file. Processing, quotes, result retrieval, and downloads renew the idle deadline.

## Directory metadata

MCP Market, TrackMCP, and the official MCP Registry can read this repository directly.

- `server.json` and `distribution/server.json` follow the [MCP server schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json). The server name is `com.easyruncraft/mcp`. The description is within the registry’s 100-character limit. `remotes` lists one Streamable HTTP URL: `https://easyruncraft.com/mcp`.
- `package.json` sets `mcpName` to that same registry name, `homepage` to https://easyruncraft.com, and the git repository to https://github.com/eastling/easyruncraft-mcp.
- `mcp.json` declares the remote server for plugin hosts.

Submit the repository URL `https://github.com/eastling/easyruncraft-mcp` to [MCP Market](https://mcpmarket.com/submit) and [TrackMCP](https://trackmcp.com/submit-mcp). Both listings pull the README, the manifest, and the source from this public repository.

## Documentation

- [MCP broker](docs/mcp.md) — tools, files, billing, and execution
- [OAuth, CLI, and distribution](docs/mcp-agent-connection.md)
- [Command inventory](docs/mcp-command-inventory.md)
- [Native editor inventory](docs/editor-mcp-inventory.md)
- [PDF inventory](docs/pdf-mcp-inventory.md)

Some of those guides link to deployment pins that live with the EasyRunCraft product checkout. The broker source those guides describe is the `mcp/` tree in this repository.

## License

MIT. See [LICENSE](LICENSE). Native editor binaries are not part of this package; their own license notices stay with those runtime releases.
