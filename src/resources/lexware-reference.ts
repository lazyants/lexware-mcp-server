import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

// Stable identifiers for the read-only API-reference Resource. Exported so tests
// can assert the exact registered URI/name without duplicating string literals.
export const REFERENCE_URI = 'reference://lexware/api';
export const REFERENCE_NAME = 'lexware-api-reference';
export const REFERENCE_MIME_TYPE = 'text/markdown';

// PACKAGE-SAFE: the reference markdown is embedded as a compiled TS string constant,
// NOT read from disk at runtime. `package.json#files` ships only `dist`/`README`/
// `LICENSE`/`logo.png`, so a `readFileSync` of a fleet-root .md would break for every
// npm/npx consumer. Built from an ARRAY of plain single-quoted lines joined by '\n'
// (NOT a template literal) because the markdown contains backtick code fences and
// `${...}`-like text that would corrupt a template literal.
export const REFERENCE_MD = [
  '# Lexware Office MCP — API Reference',
  '',
  'Read-only quick reference for the Lexware Office REST API surface exposed by this',
  'MCP server. 67 tools across the domains below. Tool naming: `lexware_<action>_<resource>`.',
  '',
  '## Connection',
  '',
  '- REST gateway base URL: `https://api.lexware.io/v1`',
  '- Auth: `LEXWARE_API_TOKEN` env var (required). Tokens: https://app.lexware.de/addons/public-api',
  '- Optional `LEXWARE_WEBHOOK_PUBLIC_KEY` (PEM) overrides the cached webhook signature key.',
  '- Web app (deeplinks) host: `https://app.lexware.de` — distinct from the `api.lexware.io` REST host.',
  '',
  '## Conventions',
  '',
  '- IDs are UUIDs.',
  '- Optimistic locking: PUT/update requests require the current `version` field in the body.',
  '- Pagination: 0-indexed `page` plus `size`.',
  '- Deeplinks: `https://app.lexware.de/permalink/<type>/<edit|view>/<id>` — sales vouchers use',
  '  `edit/`, contacts use `view/`. The files deeplink is idless (`/permalink/files/view`).',
  '- Sales-voucher download tools take an optional `format` (`pdf` default, or `xml` for the',
  '  XRechnung XML e-invoice when the API can render it).',
  '- Errors: standard `{ message, status }` and legacy `{ IssueList }` validation arrays.',
  '',
  '## Domains and tools',
  '',
  '### Sales',
  '',
  '- Invoices: `lexware_create_invoice`, `lexware_get_invoice`, `lexware_pursue_invoice`,',
  '  `lexware_download_invoice_file`, `lexware_deeplink_invoice`.',
  '- Credit notes: `lexware_create_credit_note`, `lexware_get_credit_note`,',
  '  `lexware_pursue_credit_note`, `lexware_download_credit_note_file`, `lexware_deeplink_credit_note`.',
  '- Quotations: `lexware_create_quotation`, `lexware_get_quotation`,',
  '  `lexware_download_quotation_file`, `lexware_deeplink_quotation`.',
  '- Order confirmations: `lexware_create_order_confirmation`, `lexware_get_order_confirmation`,',
  '  `lexware_pursue_order_confirmation`, `lexware_download_order_confirmation_file`,',
  '  `lexware_deeplink_order_confirmation`.',
  '- Delivery notes: `lexware_create_delivery_note`, `lexware_get_delivery_note`,',
  '  `lexware_pursue_delivery_note`, `lexware_download_delivery_note_file`,',
  '  `lexware_deeplink_delivery_note`.',
  '- Down-payment invoices: `lexware_get_down_payment_invoice`,',
  '  `lexware_download_down_payment_invoice_file`, `lexware_deeplink_down_payment_invoice`.',
  '- Dunnings: `lexware_create_dunning`, `lexware_get_dunning`, `lexware_pursue_dunning`,',
  '  `lexware_download_dunning_file`, `lexware_deeplink_dunning`.',
  '',
  '### Contacts and articles',
  '',
  '- Contacts: `lexware_create_contact`, `lexware_get_contact`, `lexware_update_contact`,',
  '  `lexware_list_contacts`, `lexware_deeplink_contact`.',
  '- Articles: `lexware_create_article`, `lexware_get_article`, `lexware_update_article`,',
  '  `lexware_list_articles`, `lexware_delete_article`.',
  '',
  '### Reference data',
  '',
  '- `lexware_list_countries`, `lexware_list_payment_conditions`,',
  '  `lexware_list_posting_categories`, `lexware_list_print_layouts`, `lexware_get_profile`.',
  '',
  '### Bookkeeping',
  '',
  '- Vouchers: `lexware_create_voucher`, `lexware_get_voucher`, `lexware_update_voucher`,',
  '  `lexware_list_vouchers`, `lexware_upload_voucher_file`, `lexware_deeplink_voucher`.',
  '- Voucher list: `lexware_list_voucherlist`.',
  '- Payments: `lexware_get_payments`.',
  '',
  '### System',
  '',
  '- Event subscriptions: `lexware_create_event_subscription`, `lexware_get_event_subscription`,',
  '  `lexware_list_event_subscriptions`, `lexware_delete_event_subscription`,',
  '  `lexware_verify_webhook_signature`.',
  '- Files: `lexware_upload_file`, `lexware_download_file`, `lexware_get_file_status`,',
  '  `lexware_deeplink_file` (idless inbox link).',
  '- Recurring templates: `lexware_get_recurring_template`, `lexware_list_recurring_templates`,',
  '  `lexware_deeplink_recurring_template`.',
  '',
  '## Split binaries',
  '',
  'The full server (`lexware-mcp-server`) exposes all 67 tools. Lean split entry points group',
  'them by domain: `lexware-mcp-sales`, `lexware-mcp-contacts`, `lexware-mcp-bookkeeping`,',
  '`lexware-mcp-reference`, `lexware-mcp-system`. This Resource is registered on every binary.',
  '',
].join('\n');

/**
 * Register the read-only API-reference MCP Resource on the given server. Called from
 * `index.ts` AND every `entry-*.ts` so split-binary users also get the Resource.
 */
export function registerReferenceResource(server: McpServer): void {
  server.registerResource(
    REFERENCE_NAME,
    REFERENCE_URI,
    {
      title: 'Lexware Office API reference',
      description: 'Read-only quick reference for the Lexware Office API surface exposed by this MCP server.',
      mimeType: REFERENCE_MIME_TYPE,
    },
    // The callback receives `uri` as a URL object; ReadResourceResult.contents[].uri
    // must be a string, so serialize via uri.toString().
    (uri: URL): ReadResourceResult => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: REFERENCE_MIME_TYPE,
          text: REFERENCE_MD,
        },
      ],
    }),
  );
}
