#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerInvoiceTools } from './tools/invoices.js';
import { registerCreditNoteTools } from './tools/credit-notes.js';
import { registerQuotationTools } from './tools/quotations.js';
import { registerOrderConfirmationTools } from './tools/order-confirmations.js';
import { registerDeliveryNoteTools } from './tools/delivery-notes.js';
import { registerDownPaymentInvoiceTools } from './tools/down-payment-invoices.js';
import { registerDunningTools } from './tools/dunnings.js';
import { registerArticleTools } from './tools/articles.js';
import { registerContactTools } from './tools/contacts.js';
import { registerCountryTools } from './tools/countries.js';
import { registerPaymentConditionTools } from './tools/payment-conditions.js';
import { registerPostingCategoryTools } from './tools/posting-categories.js';
import { registerProfileTools } from './tools/profile.js';
import { registerVoucherTools } from './tools/vouchers.js';
import { registerVoucherlistTools } from './tools/voucherlist.js';
import { registerPaymentTools } from './tools/payments.js';
import { registerEventSubscriptionTools } from './tools/event-subscriptions.js';
import { registerFileTools } from './tools/files.js';
import { registerRecurringTemplateTools } from './tools/recurring-templates.js';
import { registerPrintLayoutTools } from './tools/print-layouts.js';

const server = createServer('lexware-mcp-server');

// Sales
registerInvoiceTools(server);
registerCreditNoteTools(server);
registerQuotationTools(server);
registerOrderConfirmationTools(server);
registerDeliveryNoteTools(server);
registerDownPaymentInvoiceTools(server);
registerDunningTools(server);

// Contacts & Articles
registerArticleTools(server);
registerContactTools(server);

// Reference Data
registerCountryTools(server);
registerPaymentConditionTools(server);
registerPostingCategoryTools(server);
registerProfileTools(server);
registerPrintLayoutTools(server);

// Bookkeeping
registerVoucherTools(server);
registerVoucherlistTools(server);
registerPaymentTools(server);

// System
registerEventSubscriptionTools(server);
registerFileTools(server);
registerRecurringTemplateTools(server);

startServer(server).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
