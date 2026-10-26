import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolError } from './helpers.js';

/**
 * Tools that may run while read-only mode is on. Every tool NOT listed here is
 * blocked in that mode, so a new tool stays blocked until someone adds it on
 * purpose.
 *
 * Written out by hand rather than derived from tool names or from the
 * `readOnlyHint` annotation: annotations are advisory metadata for the client,
 * and one wrong hint must not open a write path. `read-only.test.ts` cross-checks
 * this list against the annotations and against the HTTP methods the tools use.
 */
export const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  // Sales vouchers
  'lexware_get_invoice',
  'lexware_download_invoice_file',
  'lexware_deeplink_invoice',
  'lexware_get_credit_note',
  'lexware_download_credit_note_file',
  'lexware_deeplink_credit_note',
  'lexware_get_quotation',
  'lexware_download_quotation_file',
  'lexware_deeplink_quotation',
  'lexware_get_order_confirmation',
  'lexware_download_order_confirmation_file',
  'lexware_deeplink_order_confirmation',
  'lexware_get_delivery_note',
  'lexware_download_delivery_note_file',
  'lexware_deeplink_delivery_note',
  'lexware_get_down_payment_invoice',
  'lexware_download_down_payment_invoice_file',
  'lexware_deeplink_down_payment_invoice',
  'lexware_get_dunning',
  'lexware_download_dunning_file',
  'lexware_deeplink_dunning',
  // Contacts and articles
  'lexware_list_articles',
  'lexware_get_article',
  'lexware_list_contacts',
  'lexware_get_contact',
  'lexware_deeplink_contact',
  // Reference data
  'lexware_list_countries',
  'lexware_list_payment_conditions',
  'lexware_list_posting_categories',
  'lexware_get_profile',
  'lexware_list_print_layouts',
  // Bookkeeping
  'lexware_get_voucher',
  'lexware_list_vouchers',
  'lexware_deeplink_voucher',
  'lexware_list_voucherlist',
  'lexware_get_payments',
  // System
  'lexware_list_event_subscriptions',
  'lexware_get_event_subscription',
  'lexware_verify_webhook_signature',
  'lexware_download_file',
  'lexware_get_file_status',
  'lexware_deeplink_file',
  'lexware_list_recurring_templates',
  'lexware_get_recurring_template',
  'lexware_deeplink_recurring_template',
]);

/**
 * Parse `LEXWARE_READ_ONLY`. Unset, empty, "false" and "0" mean off (the default);
 * "true" and "1" mean on. Case and surrounding spaces are ignored.
 *
 * Any other value throws. A typo such as "yes" or "on" must not leave a server the
 * user meant to be read-only able to change data without notice, so the server
 * refuses to start instead.
 */
export function parseReadOnlyMode(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized === '' || normalized === 'false' || normalized === '0') return false;
  if (normalized === 'true' || normalized === '1') return true;
  throw new Error('LEXWARE_READ_ONLY must be "true", "1", "false" or "0" (unset or empty means off).');
}

export function readOnlyModeFromEnv(): boolean {
  return parseReadOnlyMode(process.env.LEXWARE_READ_ONLY);
}

const BLOCKED_DESCRIPTION =
  'Blocked: read-only mode (LEXWARE_READ_ONLY) is on, and this tool would change Lexware data.';

// These describe the stub, not the tool it replaces: the stub changes nothing and
// contacts nothing.
const BLOCKED_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * Make `server` refuse every tool not in READ_ONLY_TOOL_NAMES. Call it before any
 * tool is registered.
 *
 * A blocked tool is registered as a stub under its own name: it stays in
 * tools/list, marked blocked, so a model can tell the user why a change is refused,
 * and a call to it returns an error. The tool's real handler is never handed to the
 * SDK, so no request can reach Lexware. The stub has no input schema, which makes
 * the SDK skip argument validation: every call, with any arguments or none, gets the
 * read-only message rather than a validation error.
 *
 * Only `registerTool` is intercepted — it is the one registration method the tool
 * modules use.
 */
export function enforceReadOnly(server: McpServer): void {
  const register = server.registerTool.bind(server);
  // GOTCHA: registerTool is generic over its input and output schemas. The wrapper
  // only forwards what it was given, so it is typed loosely and cast back.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerTool = ((name: string, config: any, handler: any) => {
    if (READ_ONLY_TOOL_NAMES.has(name)) return register(name, config, handler);
    return register(
      name,
      { title: config.title, description: BLOCKED_DESCRIPTION, annotations: BLOCKED_ANNOTATIONS },
      () => toolError(new Error(
        `${name} is blocked: read-only mode is on (LEXWARE_READ_ONLY), so this server does not ` +
        'create, change, delete, upload or pursue Lexware data.'
      )),
    );
  }) as typeof server.registerTool;
}
