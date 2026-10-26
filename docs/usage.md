# Usage notes

Behavior and API caveats worth knowing before you call the tools. This is not a tool inventory:
your MCP client's tool list, with each tool's description and input schema, is the authoritative
list. For setup, see the [configuration guide](configuration.md).

Every entry point also serves a read-only MCP resource, `reference://lexware/api`, with the API
conventions, text formatting rules and webhook guidance. For the API itself, see the
[Lexware Office API documentation](https://developers.lexware.io/docs/).

## Before you write data

- **Create, update, delete, upload, and pursue tools change real business data** — invoices,
  contacts, and accounting records in your Lexware account. A pursue tool creates a follow-up
  document.
- To limit what the server can change — read-only mode, a token with read-only permissions and your
  MCP client's approval prompts — see [Limit what the server can change](configuration.md#limit-what-the-server-can-change).
- Test against a sandbox or non-critical account before running write operations against
  production data.
- Rate limiting is handled automatically: requests retry with exponential backoff on 429, including
  file uploads — the multipart body is rebuilt fresh on every retry attempt, so it can be replayed
  safely.

## Conventions

- Tool names follow `lexware_<action>_<resource>`, for example `lexware_create_invoice`.
- IDs are UUIDs.
- Optimistic locking: PUT/update requests require the current `version` field in the body.
- Pagination: 0-indexed `page` plus `size`.
- Errors: standard `{ message, status }` and legacy `{ IssueList }` validation arrays.

## Sales vouchers

### Finalize at creation

The standalone invoice, credit-note, quotation, order-confirmation and delivery-note create tools
accept `finalize: true` to finalize at creation. Omit it or set `false` to create a draft; only
explicit `true` sends the API's `?finalize=true` query parameter.

For invoices, `finalize: true` creates status `"open"`. The API cannot finalize an existing draft,
so decide at creation time.

### Text formatting

Sales vouchers accept Lexware formatting in `introduction`, `lineItems[].description`, and
`remark`; articles accept it in `description`. Article `title` does not support formatting. Use
`**bold**`, `__italic__`, and dash-prefixed list items separated by newlines. Other Markdown
features and HTML are not documented as supported. Text is forwarded unchanged.

Example sales-voucher text fields (include the other required fields when creating a voucher):

```json
{
  "introduction": "Thank you for your **order**",
  "lineItems": [{ "description": "Includes __installation__" }],
  "remark": "- First step\n- Second step"
}
```

See Lexware's [text formatting FAQ](https://developers.lexware.io/docs/#faq-text-formatting) for the
upstream syntax.

### Voucher downloads

The invoice, credit-note, and down-payment-invoice download tools take an optional `format`
(`pdf` default, or `xml` for the XRechnung XML e-invoice when the API can render it). The other
voucher download tools are PDF-only (the API returns 406 otherwise). Downloads return the bytes as
`contentBase64`.

## Searching vouchers

### `lexware_list_voucherlist`

This is the collection endpoint for finding vouchers of every type.

For incremental sync, `updatedDateFrom` and `updatedDateTo` filter the last modification date
(`yyyy-MM-dd`, full days in CET/CEST). `sort` accepts `voucherDate`, `voucherNumber`, `createdDate`
or `updatedDate` followed by `ASC` or `DESC`, for example `updatedDate,DESC`. Status filters include
`transferred` and `sepadebit`; the transient `overdue` status cannot be combined with other statuses.

By default this is a single-page passthrough of the API response. Two additions are opt-in:

- `fetchAllPages: true` follows pagination until every page is retrieved, capped at 100 requests.
  The result adds `fetchedPages` and `truncated`, the latter marking a set cut short by the cap —
  API fields such as `totalElements` are preserved.
- `contactName` (SQL-style `%`/`_` wildcards, case-insensitive) and `hasOpenAmount` filter
  client-side after fetching, and each implies `fetchAllPages`. They are applied here rather than on
  `lexware_list_vouchers` because `/voucherlist` is the response shape that carries `contactName`
  and `openAmount`.

`page` cannot be combined with any of the three — those modes read every page, so a start offset is
meaningless. Use `size` to control the batch size instead. The combination is rejected rather than
silently ignored, so nobody can believe an offset was honored when it was not.

### `lexware_list_vouchers`

`lexware_list_vouchers` **requires** `voucherNumber`. `GET /vouchers` is a lookup endpoint, not a
browsable collection — the API answers `400 "voucherNumber parameter is required"` without it. To
browse or filter vouchers, use `lexware_list_voucherlist`, which is the collection endpoint and also
carries the summary fields (`contactName`, `openAmount`) that `/vouchers` does not.

## Bookkeeping vouchers

`lexware_get_voucher` normalizes `voucherStatus` to lowercase and retries a 404 three times
(1 s / 2 s / 4 s) to cover the indexing delay after an upload; if the voucher is still missing it
returns `{ voucherId, status: "processing", message }`. Other failures are reported as errors.

Voucher updates require the current `version` for optimistic locking. If the existing voucher is
`unchecked`, the update must transition `voucherStatus` to `open`. This constraint does not apply to
vouchers already in other statuses; the upstream API enforces status rules. See the Lexware
[change log](https://developers.lexware.io/docs/#change-log) (July 14, 2026).

## Contacts and deeplinks

Deeplink tools return web-app links of the form
`https://app.lexware.de/permalink/<type>/<edit|view>/<id>`: sales vouchers use `edit/`, contacts use
`view/`. The files deeplink has no ID (`/permalink/files/view`).

`lexware_deeplink_contact` returns `deeplink` and the permanent alias `url`, both containing the
same contact URL. Either output key is supported.

## Files

### Downloads

`lexware_download_file` accepts `format: "pdf"` (default) or `format: "xml"` to retrieve an
available e-invoice XML original. XML embedded in a PDF cannot be retrieved separately; Lexware
returns 404 when the requested XML is unavailable. Downloads return the bytes as `contentBase64`.

`lexware_get_file_status` calls `GET /files/{id}/status`. The bare `GET /files/{id}` is the binary
download route — with `Accept: application/json` it still answers `200` with the file body
base64-encoded, so it can never yield status metadata. The status route is scope-gated: API keys
without the necessary permission get `access_denied` from Lexware rather than a status.

### Uploads

Both upload tools (`lexware_upload_file` and `lexware_upload_voucher_file`) take the file either as
`contentBase64` or as `filePath` — an absolute path readable by the MCP server process. Prefer
`filePath` for anything sizeable: base64 inflates the payload by about a third and has to travel
through the model's context window. With `filePath`, `fileName` defaults to the file's base name and
`contentType` is auto-detected for `.png`, `.jpg`/`.jpeg`, `.tiff`/`.tif` and `.xml`, falling back
to `application/pdf`. Provide exactly one of the two — supplying both, or neither, is a validation
error.

Uploads are capped at 5 MB. For `filePath` the size is taken from the opened descriptor *before* the
file is read, so an oversized file costs a stat rather than a full load into memory, and anything
that is not a regular file is refused outright (reading `/dev/zero` would otherwise never return).
The decoded byte count is checked again afterwards, which also covers `contentBase64`. Failures
carry a `file_too_large` error with the actual and maximum sizes.

## Webhooks (event subscriptions)

Your application hosts the callback handler; this MCP server manages subscriptions and verifies
signatures but does not host a receiver. Acknowledge callbacks promptly with HTTP 200 or 204
within Lexware's 5-second (5000 ms) timeout, enqueue the received payload, and process it
asynchronously.

Use the queue to absorb event bursts and apply controlled processing retries/backoff independently
of Lexware's delivery retries. Throttle outgoing API calls to respect the API rate limits. See
[Lexware's event-subscription best practices](https://developers.lexware.io/docs/#event-subscriptions-endpoint-purpose-best-practices).

`lexware_verify_webhook_signature` uses Lexware's public key, fetched and cached by default; set
`LEXWARE_WEBHOOK_PUBLIC_KEY` to override it (see the
[configuration guide](configuration.md#environment-variables)).
