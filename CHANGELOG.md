# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- npm package: [`@lazyants/lexware-mcp-server`](https://www.npmjs.com/package/@lazyants/lexware-mcp-server)
- MCP Registry: [`io.github.lazyants/lexware`](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.lazyants/lexware)

## [3.2.0] — 2026-06-20

### Added

- e-invoice (XRechnung) XML download for the three voucher download tools whose
  Lexware endpoints support it — `lexware_download_invoice_file`,
  `lexware_download_credit_note_file`, and
  `lexware_download_down_payment_invoice_file`. Each gains an optional `format`
  parameter (`pdf` default, or `xml`) that threads the matching `Accept` header
  through `lexwareDownload`. The default path is byte-for-byte unchanged (still
  PDF, still the per-tool `<resource>.pdf` fallback name); the fallback filename
  only swaps to `.xml` when the API actually returns an XML content type. The
  remaining voucher download tools (quotations, order confirmations, delivery
  notes, dunnings) and the generic `lexware_download_file` tool stay PDF-only —
  the Lexware API documents those endpoints as PDF-only and rejects `xml` with
  `406 Not Acceptable`, so no `format` parameter is exposed there.
- Three deeplink tools for parity with the existing permalink tools:
  `lexware_deeplink_voucher` (`/permalink/vouchers/edit/{id}`),
  `lexware_deeplink_recurring_template`
  (`/permalink/recurring-templates/edit/{id}`), and `lexware_deeplink_file`.
  The file deeplink is idless by design — per the Lexware docs it opens the
  bookkeeping inbox of newly-uploaded files (`/permalink/files/view`), not a
  per-file link.
- Tool count: 64 → 67 (entry-bookkeeping 7 → 8, entry-system 10 → 12).

## [3.1.1] — 2026-06-20

### Security

- Bump the `hono` override to `^4.12.25` and the `form-data` dependency to
  `^4.0.6` to clear two HIGH advisories that started failing the
  `npm audit --audit-level=moderate --omit=dev` CI gate: `form-data` CRLF
  injection via unescaped multipart field/file names (GHSA-hmw2-7cc7-3qxx)
  and the `hono` `serve-static` path traversal et al. (`hono <= 4.12.24`).
  Dependency-only change; no runtime or API behaviour changes.

## [3.1.0] — 2026-06-13

### Added

- Read-only API-reference MCP Resource `reference://lexware/api`
  (`text/markdown`) exposing a concise Lexware Office API quick-reference
  so clients can pull it without a tool call. Registered on the main
  binary and all five split entry points (#45).

## [3.0.1] — 2026-06-13

### Changed

- Bumped the `minor-and-patch` dependency group in the lockfile
  (6 updates) via Dependabot (#43).

### Fixed

- Deeplink/permalink tools now use the Lexware Office web app domain
  `https://app.lexware.de` instead of the API-root-style `.io` domain.
  This fixes generated links for contacts, invoices, quotations, credit
  notes, delivery notes, order confirmations, down payment invoices, and
  dunnings (#39).

### Security

- Pinned the `qs` override to `^6.15.2` to clear the npm-audit
  denial-of-service advisory
  ([GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26))
  pulled in transitively via `qs` (#42). `npm audit --omit=dev` reports
  0 vulnerabilities again.

## [3.0.0] — 2026-05-20

### Added

- Per-tool axios-mock test coverage for contacts, articles,
  vouchers, payments, sales follow-up resources, platform
  resources, and reference/misc resources (PRs #30, #31, #32,
  #34, #35). Tests live under `src/tests/tools/<domain>.test.ts`
  and exercise path/method/body/version shape against a mocked
  axios client.

### Removed

- `lexware_finalize_invoice` tool. It called an undocumented
  `POST /invoices/{id}/actions/finalize` endpoint that returns
  HTTP 404 on the current Lexware Office API. Per the official
  docs ("The status of an invoice cannot be changed via the
  api"), no per-id finalize action exists. Total tool count
  drops from 66 to 65.
- `lexware_pursue_quotation` tool. Quotations are the start of
  the Lexware sales-voucher document chain — there is no
  preceding voucher to pursue from, and the Lexware API documents
  no `Pursue to a Quotation` endpoint. The prior implementation
  hit `POST /quotations/{id}/actions/pursue` which returns HTTP
  404 on the live API. Total tool count drops from 65 to 64.

### Changed

- `lexware_create_invoice` gains an optional `finalize` boolean
  parameter. When true, the invoice is created in finalized
  status ("open") via the documented
  `POST /invoices?finalize=true` query parameter — this is the
  only documented way to obtain a finalized invoice through the
  API.
- **BREAKING**: `lexware_pursue_credit_note`,
  `lexware_pursue_delivery_note`,
  `lexware_pursue_order_confirmation`, and
  `lexware_pursue_dunning` were rewired to the documented
  `POST /<resource>?precedingSalesVoucherId={id}` Lexware
  endpoints. The prior implementations hit undocumented
  `POST /<resource>/{id}/actions/pursue` paths that return HTTP
  404 on the live API. The input schema changed from
  `{ id, version }` to `{ precedingSalesVoucherId, body }`
  (plus an optional `finalize` boolean on `pursue_credit_note`,
  which is the only sibling whose docs document `[&finalize=true]`
  on the pursue endpoint). Callers using the old `{ id, version }`
  shape will fail input validation.

## [2.0.1] — 2026-05-06

### Security

- Bumped transitive dependencies in the lockfile to clear the
  `ip-address` XSS advisory ([GHSA-v2v4-37r5-5v8g](https://github.com/advisories/GHSA-v2v4-37r5-5v8g)):
  `express-rate-limit` 8.3.1 → 8.5.1 and `ip-address` 10.1.0 → 10.2.0,
  both pulled in transitively via `@modelcontextprotocol/sdk`'s HTTP
  stack. `package.json` ranges unchanged. The vulnerable code paths
  (`express-rate-limit`, HTTP transport) are not exercised by this
  server — it uses `StdioServerTransport` only — so the XSS is not
  reachable in the running app; the bump is `npm audit` gate hygiene.

### Changed

- First release cut against the cross-ported publish pipeline (npm
  Trusted Publishing + provenance, no `NPM_TOKEN` secret). Required
  the `registry-url`, npm-version, and binding fixes that landed in
  `2.0.0` plus the cross-port commit on `main`.

## [2.0.0] — 2026-05-04

### Changed

- **License updated to [FSL-1.1-MIT](LICENSE).** Versions `1.1.0` and
  earlier remain under their original MIT license. (The license change
  is what makes this a semver-major bump; the rest of the entries below
  would be minor/patch on their own.)
- **Dependencies:** bumped `zod` to `^4.4.0`, `typescript` to `^6.0.0`,
  `vitest` to `^4.1.0`, `actions/checkout` to `v6`, `actions/setup-node`
  to `v6`. Migrated 12 sites of `z.record(z.unknown())` to
  `z.record(z.string(), z.unknown())` per zod 4's two-arg signature
  requirement (key type narrowed from "anything" to `string`; net effect
  on input validation is neutral-to-stricter).
- **Releasing:** GitHub Releases now auto-publish to npm with provenance
  (`--provenance --access public`) before pushing to the MCP Registry.
  The workflow installs `mcp-publisher` early and smoke-tests it before
  the irreversible `npm publish` so a broken publisher binary fails
  fast. Skips `npm publish` cleanly if the version is already on npm
  (cutover/recovery guard). Requires `NPM_TOKEN` repo secret as a
  granular access token (classic legacy tokens fail silently with
  `--provenance` per npm's 2024 enforcement).
- **Dependabot:** added `ignore` rule for `@types/node` major bumps so
  type definitions stay aligned with `engines.node >= 20`.

### Added

- **ESLint 9 flat config** (`eslint.config.mjs`) with
  `tseslint.configs.recommended` + `globals.node`. New `npm run lint`
  script, plus a Lint step in `test.yml` that runs before the version
  sync and audit gates.

## [1.1.0] — 2026-05-04

### Added

- New tool `lexware_verify_webhook_signature`: verifies the
  `X-Lxo-Signature` header (RSA-SHA512, base64) against the raw webhook
  body using Node's `crypto`. Public key is fetched once from
  `developers.lexware.io` and cached for the process; set
  `LEXWARE_WEBHOOK_PUBLIC_KEY` (PEM) to override.
- `eventType` description on `lexware_create_event_subscription` now
  enumerates the documented event types from the Lexware docs.

### Fixed

- `lexware_deeplink_contact` now produces
  `https://app.lexware.de/permalink/contacts/view/<id>` (Lexware docs
  document `view/` for contacts; `edit/` was a dangling permalink).

### Changed

- Tool count: 65 → 66 in the full server, 9 → 10 in
  `lexware-mcp-system`.

## [1.0.2] — 2026-05-04

### Security

- Bumped `axios` from `^1.7.0` to `^1.16.0`, resolving two moderate
  advisories: `GHSA-3p68-rc4w-qgx5` (NO_PROXY hostname normalization → SSRF)
  and `GHSA-fvcv-3m26-pcqx` (cloud metadata exfiltration via header injection).
- Bumped `@modelcontextprotocol/sdk` from `^1.27.0` to `^1.29.0`.
- `npm audit --audit-level=moderate --omit=dev` now reports 0 vulnerabilities.

### Added

- `.github/dependabot.yml` for weekly npm + GitHub Actions updates.
- `engines.node >= 20` in `package.json`.
- `scripts/check-versions.mjs` enforces `package.json#version`
  matches `server.json#/packages[0].version` (hard fail) and warns on
  registry-version regressions; wired into `test.yml`,
  `publish-registry.yml`, and the `prepublishOnly` hook.
- `SECURITY.md` with a vulnerability disclosure path.
- CHANGELOG.md (this file).

### Changed

- CI matrix expanded to Node 20 and 22.
- CI now caches the npm download cache and runs `npm audit`.

## [1.0.1] — 2026-03-12

### Added

- Logo and icon metadata in `server.json` for directory listings.
- `stdio` transport entry in `server.json` for the MCP Registry.

### Fixed

- Registry publish: use the existing npm version in `packages[0]` while
  bumping only the registry-side `version` (root `1.0.1`, packages still
  `1.0.0`).

## [1.0.0] — 2026-03-12

### Added

- Initial release.
- 65 MCP tools across 20 modules: invoices, credit notes, quotations, order
  confirmations, delivery notes, down-payment invoices, dunnings,
  voucherlist, contacts, articles, vouchers, payments, countries, payment
  conditions, posting categories, profile, print layouts, event
  subscriptions, files, recurring templates.
- Five split entry points (`lexware-mcp-sales`, `lexware-mcp-contacts`,
  `lexware-mcp-bookkeeping`, `lexware-mcp-reference`, `lexware-mcp-system`)
  for context-size optimization.
- Bearer-token authentication via `LEXWARE_API_TOKEN`.
- Rate-limit handling with exponential backoff.
- Dual error-format handling (standard `{ message, status }` and legacy
  `{ IssueList }`).
- GitHub Actions test workflow.
- MCP Registry publishing via `mcp-publisher` GitHub OIDC.

[3.2.0]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v3.2.0
[3.1.1]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v3.1.1
[3.1.0]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v3.1.0
[3.0.1]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v3.0.1
[3.0.0]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v3.0.0
[2.0.0]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v2.0.0
[1.1.0]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v1.1.0
[1.0.2]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v1.0.2
[1.0.1]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v1.0.1
[1.0.0]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v1.0.0
