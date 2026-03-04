#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerInvoiceTools } from './tools/invoices.js';
import { registerCreditNoteTools } from './tools/credit-notes.js';
import { registerQuotationTools } from './tools/quotations.js';
import { registerOrderConfirmationTools } from './tools/order-confirmations.js';
import { registerDeliveryNoteTools } from './tools/delivery-notes.js';
import { registerDownPaymentInvoiceTools } from './tools/down-payment-invoices.js';
import { registerDunningTools } from './tools/dunnings.js';
import { registerVoucherlistTools } from './tools/voucherlist.js';

const server = createServer('lexware-mcp-sales');
registerInvoiceTools(server);
registerCreditNoteTools(server);
registerQuotationTools(server);
registerOrderConfirmationTools(server);
registerDeliveryNoteTools(server);
registerDownPaymentInvoiceTools(server);
registerDunningTools(server);
registerVoucherlistTools(server);
startServer(server).catch((err) => { console.error('Fatal:', err); process.exit(1); });
