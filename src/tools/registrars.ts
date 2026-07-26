import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerInvoiceTools } from './invoices.js';
import { registerCreditNoteTools } from './credit-notes.js';
import { registerQuotationTools } from './quotations.js';
import { registerOrderConfirmationTools } from './order-confirmations.js';
import { registerDeliveryNoteTools } from './delivery-notes.js';
import { registerDownPaymentInvoiceTools } from './down-payment-invoices.js';
import { registerDunningTools } from './dunnings.js';
import { registerArticleTools } from './articles.js';
import { registerContactTools } from './contacts.js';
import { registerCountryTools } from './countries.js';
import { registerPaymentConditionTools } from './payment-conditions.js';
import { registerPostingCategoryTools } from './posting-categories.js';
import { registerProfileTools } from './profile.js';
import { registerPrintLayoutTools } from './print-layouts.js';
import { registerVoucherTools } from './vouchers.js';
import { registerVoucherlistTools } from './voucherlist.js';
import { registerPaymentTools } from './payments.js';
import { registerEventSubscriptionTools } from './event-subscriptions.js';
import { registerFileTools } from './files.js';
import { registerRecurringTemplateTools } from './recurring-templates.js';

export type ToolRegistrar = (server: McpServer) => void;

// One array per bin entry point, in registration order. `entry-*.ts` and
// `smoke.test.ts` both consume these — a tool added to a domain here is
// automatically picked up by its entry's boot path AND its smoke-count
// assertion, instead of relying on two hand-copied lists staying in sync.
export const salesToolRegistrars: ToolRegistrar[] = [
  registerInvoiceTools,
  registerCreditNoteTools,
  registerQuotationTools,
  registerOrderConfirmationTools,
  registerDeliveryNoteTools,
  registerDownPaymentInvoiceTools,
  registerDunningTools,
  registerVoucherlistTools,
];

export const contactsToolRegistrars: ToolRegistrar[] = [
  registerContactTools,
  registerArticleTools,
];

export const referenceToolRegistrars: ToolRegistrar[] = [
  registerCountryTools,
  registerPaymentConditionTools,
  registerPostingCategoryTools,
  registerProfileTools,
  registerPrintLayoutTools,
];

export const bookkeepingToolRegistrars: ToolRegistrar[] = [
  registerVoucherTools,
  registerVoucherlistTools,
  registerPaymentTools,
];

export const systemToolRegistrars: ToolRegistrar[] = [
  registerEventSubscriptionTools,
  registerFileTools,
  registerRecurringTemplateTools,
];

// Full server order (`index.ts`). `registerVoucherlistTools` is shared by the
// sales and bookkeeping domains above but must be called exactly once here —
// unlike the per-entry arrays, this is NOT their concatenation.
export const allToolRegistrars: ToolRegistrar[] = [
  registerInvoiceTools,
  registerCreditNoteTools,
  registerQuotationTools,
  registerOrderConfirmationTools,
  registerDeliveryNoteTools,
  registerDownPaymentInvoiceTools,
  registerDunningTools,
  registerArticleTools,
  registerContactTools,
  registerCountryTools,
  registerPaymentConditionTools,
  registerPostingCategoryTools,
  registerProfileTools,
  registerPrintLayoutTools,
  registerVoucherTools,
  registerVoucherlistTools,
  registerPaymentTools,
  registerEventSubscriptionTools,
  registerFileTools,
  registerRecurringTemplateTools,
];

export function registerTools(server: McpServer, registrars: ToolRegistrar[]): void {
  for (const register of registrars) register(server);
}
