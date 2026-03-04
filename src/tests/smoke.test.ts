import { describe, it, expect } from 'vitest';
import { createServer } from '../server.js';

import { registerInvoiceTools } from '../tools/invoices.js';
import { registerCreditNoteTools } from '../tools/credit-notes.js';
import { registerQuotationTools } from '../tools/quotations.js';
import { registerOrderConfirmationTools } from '../tools/order-confirmations.js';
import { registerDeliveryNoteTools } from '../tools/delivery-notes.js';
import { registerDownPaymentInvoiceTools } from '../tools/down-payment-invoices.js';
import { registerDunningTools } from '../tools/dunnings.js';
import { registerArticleTools } from '../tools/articles.js';
import { registerContactTools } from '../tools/contacts.js';
import { registerCountryTools } from '../tools/countries.js';
import { registerPaymentConditionTools } from '../tools/payment-conditions.js';
import { registerPostingCategoryTools } from '../tools/posting-categories.js';
import { registerProfileTools } from '../tools/profile.js';
import { registerVoucherTools } from '../tools/vouchers.js';
import { registerVoucherlistTools } from '../tools/voucherlist.js';
import { registerPaymentTools } from '../tools/payments.js';
import { registerEventSubscriptionTools } from '../tools/event-subscriptions.js';
import { registerFileTools } from '../tools/files.js';
import { registerRecurringTemplateTools } from '../tools/recurring-templates.js';
import { registerPrintLayoutTools } from '../tools/print-layouts.js';

function registerAllAndCount(): number {
  const server = createServer('test');
  let count = 0;
  // GOTCHA: McpServer.registerTool has overloaded signatures — TypeScript rejects
  // spreading Parameters<> for overloads. Use `any` + `.apply()` to bypass.
  const orig = server.registerTool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerTool = ((...args: any[]) => {
    count++;
    return (orig as any).apply(server, args);
  }) as typeof server.registerTool;

  registerInvoiceTools(server);
  registerCreditNoteTools(server);
  registerQuotationTools(server);
  registerOrderConfirmationTools(server);
  registerDeliveryNoteTools(server);
  registerDownPaymentInvoiceTools(server);
  registerDunningTools(server);
  registerArticleTools(server);
  registerContactTools(server);
  registerCountryTools(server);
  registerPaymentConditionTools(server);
  registerPostingCategoryTools(server);
  registerProfileTools(server);
  registerPrintLayoutTools(server);
  registerVoucherTools(server);
  registerVoucherlistTools(server);
  registerPaymentTools(server);
  registerEventSubscriptionTools(server);
  registerFileTools(server);
  registerRecurringTemplateTools(server);

  return count;
}

function registerAndCount(registerFns: Array<(s: ReturnType<typeof createServer>) => void>): number {
  const server = createServer('test');
  let count = 0;
  const orig = server.registerTool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerTool = ((...args: any[]) => {
    count++;
    return (orig as any).apply(server, args);
  }) as typeof server.registerTool;
  for (const fn of registerFns) fn(server);
  return count;
}

describe('smoke tests', () => {
  it('registers exactly 65 tools in full server', () => {
    expect(registerAllAndCount()).toBe(65);
  });

  it('entry-sales registers 35 tools', () => {
    expect(registerAndCount([
      registerInvoiceTools,
      registerCreditNoteTools,
      registerQuotationTools,
      registerOrderConfirmationTools,
      registerDeliveryNoteTools,
      registerDownPaymentInvoiceTools,
      registerDunningTools,
      registerVoucherlistTools,
    ])).toBe(35);
  });

  it('entry-contacts registers 10 tools', () => {
    expect(registerAndCount([
      registerContactTools,
      registerArticleTools,
    ])).toBe(10);
  });

  it('entry-bookkeeping registers 7 tools', () => {
    expect(registerAndCount([
      registerVoucherTools,
      registerVoucherlistTools,
      registerPaymentTools,
    ])).toBe(7);
  });

  it('entry-reference registers 5 tools', () => {
    expect(registerAndCount([
      registerCountryTools,
      registerPaymentConditionTools,
      registerPostingCategoryTools,
      registerProfileTools,
      registerPrintLayoutTools,
    ])).toBe(5);
  });

  it('entry-system registers 9 tools', () => {
    expect(registerAndCount([
      registerEventSubscriptionTools,
      registerFileTools,
      registerRecurringTemplateTools,
    ])).toBe(9);
  });
});
