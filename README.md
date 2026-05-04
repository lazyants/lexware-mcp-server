# lexware-mcp-server

[![Tests](https://github.com/lazyants/lexware-mcp-server/actions/workflows/test.yml/badge.svg)](https://github.com/lazyants/lexware-mcp-server/actions/workflows/test.yml)

MCP server for the [Lexware Office API](https://developers.lexware.io/docs/). Manage invoices, contacts, articles, vouchers, and more through the Model Context Protocol.

> **Unofficial — community project.** Not affiliated with, endorsed by, or supported by Lexware GmbH or Haufe Group. "Lexware" and "Lexware Office" are trademarks of their respective owners; used here only to identify the API this client targets (nominative fair use).

**66 tools** across 20 resource domains, with 6 entry points so you can pick the right server for your MCP client's tool limit.

## Installation

```bash
npm install -g @lazyants/lexware-mcp-server
```

Or run directly:

```bash
npx @lazyants/lexware-mcp-server
```

## Configuration

Set your Lexware Office API token:

```bash
export LEXWARE_API_TOKEN=your-token-here
```

Get a token from the [Lexware Office API settings](https://app.lexware.de/addons/public-api).

## Entry Points

| Command | Domains | Tools |
|---|---|---|
| `lexware-mcp-server` | All 20 domains | 66 |
| `lexware-mcp-sales` | Invoices, Credit Notes, Quotations, Order Confirmations, Delivery Notes, Down Payment Invoices, Dunnings, Voucherlist | 35 |
| `lexware-mcp-contacts` | Contacts, Articles | 10 |
| `lexware-mcp-bookkeeping` | Vouchers, Voucherlist, Payments | 7 |
| `lexware-mcp-reference` | Countries, Payment Conditions, Posting Categories, Profile, Print Layouts | 5 |
| `lexware-mcp-system` | Event Subscriptions, Files, Recurring Templates | 10 |

Use split servers to reduce context size — pick only the splits you need.

## Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "lexware": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"],
      "env": {
        "LEXWARE_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

Or use split servers (pick the splits you need):

```json
{
  "mcpServers": {
    "lexware-sales": {
      "command": "npx",
      "args": ["-y", "-p", "@lazyants/lexware-mcp-server", "lexware-mcp-sales"],
      "env": { "LEXWARE_API_TOKEN": "your-token-here" }
    },
    "lexware-contacts": {
      "command": "npx",
      "args": ["-y", "-p", "@lazyants/lexware-mcp-server", "lexware-mcp-contacts"],
      "env": { "LEXWARE_API_TOKEN": "your-token-here" }
    }
  }
}
```

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lexware": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"],
      "env": {
        "LEXWARE_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

## Tools

### Invoices (6 tools) — sales

`lexware_create_invoice`, `lexware_get_invoice`, `lexware_download_invoice_file`, `lexware_finalize_invoice`, `lexware_pursue_invoice`, `lexware_deeplink_invoice`

### Credit Notes (5 tools) — sales

`lexware_create_credit_note`, `lexware_get_credit_note`, `lexware_download_credit_note_file`, `lexware_pursue_credit_note`, `lexware_deeplink_credit_note`

### Quotations (5 tools) — sales

`lexware_create_quotation`, `lexware_get_quotation`, `lexware_download_quotation_file`, `lexware_pursue_quotation`, `lexware_deeplink_quotation`

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

### Required repository secret

`NPM_TOKEN` must be a **granular access token** issued from the npm org dashboard (https://www.npmjs.com/settings/lazyants/tokens) with read-and-write permission on `@lazyants/lexware-mcp-server`. Classic legacy automation tokens silently fail with `--provenance` since npm's 2024 enforcement.

## Disclaimer

This is an **unofficial, independent community project**. It is not affiliated with, endorsed by, sponsored by, or supported by Lexware GmbH, Haufe Group, or any of their affiliates. For official Lexware support, contact Lexware directly — issues with this MCP server should be reported here, not to Lexware.

"Lexware" and "Lexware Office" are trademarks of their respective owners and are used in this project's name and documentation under nominative fair use, solely to identify the third-party API this client connects to.

Create, update, and delete operations modify real business data in your Lexware account. The authors provide this software "as-is" and accept no responsibility for unintended changes, data loss, or any other damages arising from its use. Test against a sandbox or non-critical account before running write operations against production data.

## License

MIT — see [LICENSE](LICENSE) for details.
