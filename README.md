# lexware-mcp-server

[![Listed on AgentHub: lexware](https://myagenthub.cn/badge/io.github.lazyants/lexware?lang=en)](https://myagenthub.cn/en/p/io.github.lazyants/lexware)
[![Tests](https://github.com/lazyants/lexware-mcp-server/actions/workflows/test.yml/badge.svg)](https://github.com/lazyants/lexware-mcp-server/actions/workflows/test.yml)

MCP server for the [Lexware Office API](https://developers.lexware.io/docs/). Manage invoices, contacts, articles, vouchers, and more through the Model Context Protocol.

**Unofficial community project** — not affiliated with Lexware GmbH or Haufe Group. See the [Disclaimer](#disclaimer).

## Requirements

- Node.js 20 or newer.
- A Lexware Office API token from the [Lexware Office API settings](https://app.lexware.de/addons/public-api).

## Quick start

### 1. Store the token in the OS keyring

The server reads the token from the OS keyring first (service `lexware-mcp`, account `api-token`)
and falls back to the `LEXWARE_API_TOKEN` environment variable. The keyring is recommended: your MCP
config then holds no credentials.

The commands below prompt for the token, so it never lands in your shell history or the process
list.

macOS:

```bash
security add-generic-password -s "lexware-mcp" -a "api-token" -w
```

Linux (needs a Secret Service / `libsecret`):

```bash
secret-tool store --label="Lexware Office API" service lexware-mcp username api-token
```

For Windows, headless machines, and the environment-variable fallback, see the
[configuration guide](https://github.com/lazyants/lexware-mcp-server/blob/main/docs/configuration.md).

### 2. Add the server to your MCP client

```json
{
  "mcpServers": {
    "lexware": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"]
    }
  }
}
```

Put this in your client's MCP configuration, for example `claude_desktop_config.json` for Claude
Desktop. In Claude Code, run:

```bash
claude mcp add --scope user lexware -- npx -y @lazyants/lexware-mcp-server
```

`npx` downloads and runs the package; no separate install is needed. Restart the client, and the
Lexware tools appear in its tool list.

## Entry points

The package provides a full server and smaller split servers that each cover one area. Use a split
server to reduce context size or to stay under your MCP client's tool limit.

| Command | Covers |
|---|---|
| `lexware-mcp-server` | Everything below |
| `lexware-mcp-sales` | Invoices, Credit Notes, Quotations, Order Confirmations, Delivery Notes, Down Payment Invoices, Dunnings, Voucherlist |
| `lexware-mcp-contacts` | Contacts, Articles |
| `lexware-mcp-bookkeeping` | Vouchers, Voucherlist, Payments |
| `lexware-mcp-reference` | Countries, Payment Conditions, Posting Categories, Profile, Print Layouts |
| `lexware-mcp-system` | Event Subscriptions, Files, Recurring Templates |

Run a split server with `npx -y -p @lazyants/lexware-mcp-server lexware-mcp-sales`. The
[configuration guide](https://github.com/lazyants/lexware-mcp-server/blob/main/docs/configuration.md#split-servers)
has client examples for split servers and for several Lexware accounts.

## What the tools do

Tool names follow `lexware_<action>_<resource>`, for example `lexware_create_invoice` or
`lexware_list_voucherlist`. They create and read sales vouchers such as invoices and quotations,
manage contacts and articles, record bookkeeping vouchers, search across voucher types, upload and
download files, and manage webhook subscriptions. Your MCP client's tool list, with each tool's
description and input schema, is the authoritative inventory.

Every entry point also serves a read-only MCP resource, `reference://lexware/api`, with API
conventions, text formatting rules, and webhook guidance.

The [usage guide](https://github.com/lazyants/lexware-mcp-server/blob/main/docs/usage.md) explains
the API caveats: finalizing at creation, voucher search filters, voucher updates, file uploads and
downloads, and webhooks.

## Security

- **Use the OS keyring** and **never commit your API token** to version control.
- **Tools that create, update, delete, upload, or pursue** (create a follow-up document) **change
  real business data** in your Lexware account.
- This server has **no read-only mode**. Two things limit it today: the permissions of your Lexware
  API key, enforced by Lexware, and the approval prompts of your MCP client. Tool annotations such
  as `readOnlyHint` are hints for the client, not checks.
- For a conservative setup — a key with read-only permissions, approval for changes, and what split
  servers do and do not limit — see
  [Limit what the server can change](https://github.com/lazyants/lexware-mcp-server/blob/main/docs/configuration.md#limit-what-the-server-can-change).
- Requests that hit the rate limit (HTTP 429) are retried automatically with exponential backoff.

To report a vulnerability, see [SECURITY.md](https://github.com/lazyants/lexware-mcp-server/blob/main/SECURITY.md).

## Documentation

- [Configuration](https://github.com/lazyants/lexware-mcp-server/blob/main/docs/configuration.md) —
  keyring setup for macOS, Windows, and Linux; environment variables; Claude Code and Claude Desktop;
  split servers and multiple accounts; limiting what the server can change.
- [Usage notes](https://github.com/lazyants/lexware-mcp-server/blob/main/docs/usage.md) — API
  behavior and caveats.
- [Releasing](https://github.com/lazyants/lexware-mcp-server/blob/main/docs/releasing.md) —
  maintainer release procedure.
- [Changelog](https://github.com/lazyants/lexware-mcp-server/blob/main/CHANGELOG.md)

## Releasing

Maintainers: follow the [release guide](https://github.com/lazyants/lexware-mcp-server/blob/main/docs/releasing.md).
Never create a release with a bare `gh release create`; the guide's guarded tag sequence explains
why and prevents republishing an old version.

## Disclaimer

This is an **unofficial, independent community project**. It is not affiliated with, endorsed by, sponsored by, or supported by Lexware GmbH, Haufe Group, or any of their affiliates. For official Lexware support, contact Lexware directly — issues with this MCP server should be reported here, not to Lexware.

"Lexware" and "Lexware Office" are trademarks of their respective owners and are used in this project's name and documentation under nominative fair use, solely to identify the third-party API this client connects to.

Create, update, and delete operations modify real business data in your Lexware account. The authors provide this software "as-is" and accept no responsibility for unintended changes, data loss, or any other damages arising from its use. Test against a sandbox or non-critical account before running write operations against production data.

## License

[FSL-1.1-MIT](LICENSE) — see [LICENSE](LICENSE) for the full terms.
