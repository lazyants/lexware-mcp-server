# lexware-mcp-server

[![Tests](https://github.com/lazyants/lexware-mcp-server/actions/workflows/test.yml/badge.svg)](https://github.com/lazyants/lexware-mcp-server/actions/workflows/test.yml)

MCP server for the [Lexware Office API](https://developers.lexware.io/docs/). Manage invoices, contacts, articles, vouchers, and more through the Model Context Protocol.

> **Unofficial — community project.** Not affiliated with, endorsed by, or supported by Lexware GmbH or Haufe Group. "Lexware" and "Lexware Office" are trademarks of their respective owners; used here only to identify the API this client targets (nominative fair use).

**67 tools** across 20 resource domains, with 6 entry points so you can pick the right server for your MCP client's tool limit.

## Installation

```bash
npm install -g @lazyants/lexware-mcp-server
```

Or run directly:

```bash
npx @lazyants/lexware-mcp-server
```

## Configuration

The API token is resolved in this order:

1. **OS keyring** (recommended — token never written to disk in plain text)
2. **Environment variable** `LEXWARE_API_TOKEN`

### Store the token in the OS keyring

Get your token from the [Lexware Office API settings](https://app.lexware.de/addons/public-api), then store it with the native credential manager for your OS.

> [!IMPORTANT]
> The commands below read the token from an interactive prompt rather than
> taking it as an argument, so it never lands in your shell history or the
> process list. Avoid pasting the token directly onto the command line.

#### macOS

Omitting the value after `-w` makes `security` prompt for the token (with confirmation):

```bash
security add-generic-password -s "lexware-mcp" -a "api-token" -w
```

#### Windows (PowerShell)

`cmdkey` cannot prompt, so read the token into a variable via a hidden prompt and clear it afterwards:

```powershell
$secure = Read-Host -AsSecureString "Lexware API token"
$token = [System.Net.NetworkCredential]::new('', $secure).Password
cmdkey /generic:lexware-mcp /user:api-token /pass:$token
Remove-Variable secure, token
```

#### Linux

```bash
secret-tool store --label="Lexware Office API" service lexware-mcp username api-token
# (prompts for the token value)
```

Once stored, MCP config files need no credentials at all — the server reads the token from the keyring at startup.

### Use an environment variable instead

If you prefer not to use the keyring, set `LEXWARE_API_TOKEN` in your shell or MCP client config:

```bash
export LEXWARE_API_TOKEN=your-token-here
```

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `LEXWARE_API_TOKEN` | — | API token; used when the keyring has no entry for the configured service |
| `LEXWARE_KEYRING_SERVICE` | `lexware-mcp` | Keyring service name. Override when connecting to multiple Lexware accounts simultaneously — run one server instance per account, each with its own service name |

## Entry Points

| Command | Domains | Tools |
| --- | --- | --- |
| `lexware-mcp-server` | All 20 domains | 64 |
| `lexware-mcp-sales` | Invoices, Credit Notes, Quotations, Order Confirmations, Delivery Notes, Down Payment Invoices, Dunnings, Voucherlist | 33 |
| `lexware-mcp-contacts` | Contacts, Articles | 10 |
| `lexware-mcp-bookkeeping` | Vouchers, Voucherlist, Payments | 7 |
| `lexware-mcp-reference` | Countries, Payment Conditions, Posting Categories, Profile, Print Layouts | 5 |
| `lexware-mcp-system` | Event Subscriptions, Files, Recurring Templates | 10 |

Use split servers to reduce context size — pick only the splits you need.

## Claude Code

Add to `~/.claude/settings.json`. If you stored the token in the OS keyring under the default service name `lexware-mcp` (recommended), no `env` key is needed:

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

If you prefer the environment variable approach:

```json
{
  "mcpServers": {
    "lexware": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"],
      "env": { "LEXWARE_API_TOKEN": "your-token-here" }
    }
  }
}
```

### Split servers

Use split servers to reduce context size — pick only the entry points you need. The `-p @lazyants/lexware-mcp-server` flag tells `npx` which package to source the command from; the final argument (e.g. `lexware-mcp-sales`) is the specific entry-point binary defined in that package (see [Entry Points](#entry-points)):

```json
{
  "mcpServers": {
    "lexware-sales": {
      "command": "npx",
      "args": ["-y", "-p", "@lazyants/lexware-mcp-server", "lexware-mcp-sales"]
    },
    "lexware-contacts": {
      "command": "npx",
      "args": ["-y", "-p", "@lazyants/lexware-mcp-server", "lexware-mcp-contacts"]
    }
  }
}
```

Multi-account example (two Lexware companies, tokens stored under separate keyring service names):

```json
{
  "mcpServers": {
    "lexware-company-a": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"],
      "env": { "LEXWARE_KEYRING_SERVICE": "lexware-company-a" }
    },
    "lexware-company-b": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"],
      "env": { "LEXWARE_KEYRING_SERVICE": "lexware-company-b" }
    }
  }
}
```

## Claude Desktop

Add to `claude_desktop_config.json`. With the OS keyring (recommended — assumes the token is stored under the default service name `lexware-mcp`):

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

With an environment variable instead:

```json
{
  "mcpServers": {
    "lexware": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"],
      "env": { "LEXWARE_API_TOKEN": "your-token-here" }
    }
  }
}
```

## Tools

### Invoices (5 tools) — sales

`lexware_create_invoice` (supports `finalize=true` at creation), `lexware_get_invoice`, `lexware_download_invoice_file`, `lexware_pursue_invoice`, `lexware_deeplink_invoice`

### Credit Notes (5 tools) — sales

`lexware_create_credit_note`, `lexware_get_credit_note`, `lexware_download_credit_note_file`, `lexware_pursue_credit_note`, `lexware_deeplink_credit_note`

### Quotations (4 tools) — sales

`lexware_create_quotation`, `lexware_get_quotation`, `lexware_download_quotation_file`, `lexware_deeplink_quotation`

### Order Confirmations (5 tools) — sales

`lexware_create_order_confirmation`, `lexware_get_order_confirmation`, `lexware_download_order_confirmation_file`, `lexware_pursue_order_confirmation`, `lexware_deeplink_order_confirmation`

### Delivery Notes (5 tools) — sales

`lexware_create_delivery_note`, `lexware_get_delivery_note`, `lexware_download_delivery_note_file`, `lexware_pursue_delivery_note`, `lexware_deeplink_delivery_note`

### Down Payment Invoices (3 tools) — sales

`lexware_get_down_payment_invoice`, `lexware_download_down_payment_invoice_file`, `lexware_deeplink_down_payment_invoice`

### Dunnings (5 tools) — sales

`lexware_create_dunning`, `lexware_get_dunning`, `lexware_download_dunning_file`, `lexware_pursue_dunning`, `lexware_deeplink_dunning`

### Voucherlist (1 tool) — sales, bookkeeping

`lexware_list_voucherlist`

### Contacts (5 tools) — contacts

`lexware_list_contacts`, `lexware_get_contact`, `lexware_create_contact`, `lexware_update_contact`, `lexware_deeplink_contact`

### Articles (5 tools) — contacts

`lexware_list_articles`, `lexware_get_article`, `lexware_create_article`, `lexware_update_article`, `lexware_delete_article`

### Vouchers (5 tools) — bookkeeping

`lexware_list_vouchers`, `lexware_get_voucher`, `lexware_create_voucher`, `lexware_update_voucher`, `lexware_upload_voucher_file`

### Payments (1 tool) — bookkeeping

`lexware_get_payments`

### Countries (1 tool) — reference

`lexware_list_countries`

### Payment Conditions (1 tool) — reference

`lexware_list_payment_conditions`

### Posting Categories (1 tool) — reference

`lexware_list_posting_categories`

### Profile (1 tool) — reference

`lexware_get_profile`

### Print Layouts (1 tool) — reference

`lexware_list_print_layouts`

### Event Subscriptions (5 tools) — system

`lexware_create_event_subscription`, `lexware_list_event_subscriptions`, `lexware_get_event_subscription`, `lexware_delete_event_subscription`, `lexware_verify_webhook_signature`

### Files (3 tools) — system

`lexware_upload_file`, `lexware_download_file`, `lexware_get_file_status`

### Recurring Templates (2 tools) — system

`lexware_list_recurring_templates`, `lexware_get_recurring_template`

## Security

- **Use the OS keyring** to keep your API token out of config files and shell history entirely (see [Configuration](#configuration))
- **Never commit your API token** to version control
- Use **read-only** access when you only need to list/get resources
- **Create, update, and delete tools modify real business data** — invoices, contacts, and accounting records in your Lexware account
- Rate limiting is handled automatically (exponential backoff on 429)

## Releasing

Releases ship via the GitHub Release event. Maintainer flow:

1. Bump the version in `package.json` and `server.json` (`npm run check-versions` enforces alignment between `package.json#/version` and `server.json#/packages[0].version`).
2. Update `CHANGELOG.md`.
3. Commit, then `gh release create vX.Y.Z --notes-from-tag` (or write release notes inline).
4. The `Publish to npm + MCP Registry` workflow runs automatically: it `npm publish`es with provenance, polls the registry until the tarball is available, then pushes the matching `server.json` to the MCP Registry via `mcp-publisher`.

The workflow skips `npm publish` cleanly if the version is already on npm (cutover guard for releases that were partially published manually).

### Publishing auth — npm Trusted Publishing (no token)

Publishing uses **npm Trusted Publishing** via OIDC — there is **no `NPM_TOKEN` secret**. The workflow's `id-token: write` permission is exchanged for a short-lived, one-shot publish token at publish time, using the trusted-publisher binding configured for `@lazyants/lexware-mcp-server` in the npm web UI. The only setup required is that trusted-publisher binding on npm; nothing needs to be stored in repository secrets.

## Disclaimer

This is an **unofficial, independent community project**. It is not affiliated with, endorsed by, sponsored by, or supported by Lexware GmbH, Haufe Group, or any of their affiliates. For official Lexware support, contact Lexware directly — issues with this MCP server should be reported here, not to Lexware.

"Lexware" and "Lexware Office" are trademarks of their respective owners and are used in this project's name and documentation under nominative fair use, solely to identify the third-party API this client connects to.

Create, update, and delete operations modify real business data in your Lexware account. The authors provide this software "as-is" and accept no responsibility for unintended changes, data loss, or any other damages arising from its use. Test against a sandbox or non-critical account before running write operations against production data.

## License

[FSL-1.1-MIT](LICENSE) — see [LICENSE](LICENSE) for the full terms.
