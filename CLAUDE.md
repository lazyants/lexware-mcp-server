# lexware-mcp-server

> Repo-specific guidance. **Fleet-wide rules — ESM `.js` import extensions, the zod-4 traps, no
> `.strict()`, tool-description limits, the `CallToolResult` import path, `server.json`'s dual
> `version` fields, the `@types/node` cap, the build/test/publish flow, the code-review protocol and
> the git workflow — live in the fleet root `CLAUDE.md` one directory up** (`lazy-ants/development/mcp/`),
> which is now its own git repository. Read both. This file holds only what is true for this server
> and nothing else.

- **API**: Lexware Office REST. Base: `https://api.lexware.io/v1`. Docs: `https://developers.lexware.io/`.
- **Env**: `LEXWARE_API_TOKEN` (required). `LEXWARE_WEBHOOK_PUBLIC_KEY` (optional PEM, overrides cached webhook signature key).
- **Tool naming**: `lexware_<action>_<resource>` (e.g. `lexware_create_invoice`).
- **Service module**: `src/services/lexware.ts` (axios client). File helpers: `lexwareDownload()` (returns base64), `lexwareUpload()` (form-data).
- **Layout**: 1 main + 5 split entry points + 20 tool modules + 66 tools (4.0.0 removed `lexware_create_dunning` — it always 400'd, no standalone `POST /dunnings` form exists; 3.2.0 added e-invoice XML `format` on the 3 XRechnung-capable voucher download tools + 3 deeplink tools; 3.0.0 removed `lexware_finalize_invoice` + `lexware_pursue_quotation`).

  | Entry | Bin |
  |---|---|
  | `src/index.ts` | `lexware-mcp-server` |
  | `entry-sales.ts` | `lexware-mcp-sales` |
  | `entry-contacts.ts` | `lexware-mcp-contacts` |
  | `entry-bookkeeping.ts` | `lexware-mcp-bookkeeping` |
  | `entry-reference.ts` | `lexware-mcp-reference` |
  | `entry-system.ts` | `lexware-mcp-system` |

- **Conventions**:
  - Optimistic locking: PUT requests require a `version` field in body.
  - IDs: UUIDs (use `UuidS` schema).
  - Pagination: 0-indexed `page` + `size` (use `PaginationParams` spread).
  - Complex bodies: `z.record(z.string(), z.unknown())` — zod 4 requires both key + value schemas.
  - Deeplinks (client-side): `https://app.lexware.de/permalink/<type>/<edit|view>/<id>` (web app is `app.lexware.de`; the `api.lexware.io` host above is the REST gateway, not deeplinks). Sales vouchers use `edit/`, contacts use `view/` (no contacts edit-permalink per Lexware docs).
  - Error formats — service handles both: `{message, status}` (standard) and `{IssueList}` (legacy validation array).
  - **No action-verb endpoints**: Lexware has NO `POST /{resource}/{id}/actions/{verb}` pattern (unlike Hetzner). State transitions (finalize, pursue-chain) happen via creation-time query params: `POST /{resource}?precedingSalesVoucherId={id}[&finalize=true]`. A tool that posts to an `/actions/` path on a Lexware resource is wrong — verify against `https://developers.lexware.io/` before adding one.
- **Tests**: 6 vitest files with mocked axios. `smoke.test.ts` counts tools per entry point — keep counts in sync. `vi.mock()` is hoisted.
