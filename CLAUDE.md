# lexware-mcp-server

Guidance for working in this repository. **Self-contained** — everything needed to work here safely
is below. If you are in the `lazy-ants/development/mcp/` fleet checkout, the fleet-root `CLAUDE.md`
one directory up carries the same cross-cutting rules plus fleet-only material (the publishing
playbook, the hygiene skill, the sibling servers). A standalone clone of this repo does not have it
and does not need it.

## Cross-cutting rules (all three lazy-ants MCP servers)

- **ESM + Node16 module resolution**: all relative imports MUST use the `.js` extension —
  `import { x } from '../helpers.js'`. TypeScript resolves `.js` → `.ts` at compile time.
- **NEVER** call `.strict()` on Zod schemas — it breaks MCP SDK schema generation.
- **Zod 4** (`zod ^4.4.0` here; requires MCP SDK ≥ 1.29). Two traps: the 1-arg
  `z.record(valueType)` overload is gone — use `z.record(z.string(), z.unknown())`; and
  `z.preprocess` outputs are tagged `optin: "optional"`, which silently drops required fields from
  the MCP `tools/list` `required[]` array. Runtime-verify `.describe()` propagation AND `required[]`
  via a `tools/list` round-trip in `{ io: 'input' }` mode before bumping the zod major.
- **Tool descriptions**: 1–2 sentences, no cross-references to other tools.
- **`CallToolResult` import path**: `@modelcontextprotocol/sdk/types.js`, NOT `server/mcp.js`.
- **`server.json` dual `version` fields**: root `version` is the MCP Registry version (unique per
  publish); `packages[0].version` is the npm version (must exist on npm). They may differ.
- **`@types/node` is capped at the `engines.node` floor** (Node 20). Reject Dependabot major bumps.
- **Git**: commit right after a change, present-tense imperative subject, never `git add -A`/`.`,
  no `Co-Authored-By` or "Generated with" trailers. Default branch `main`.
- **Counts in this file are pinned by `src/tests/smoke.test.ts`.** It is the source of truth — if a
  number here and a number there disagree, the test wins and this file is stale.

## Repository specifics

- **API**: Lexware Office REST. Base: `https://api.lexware.io/v1`. Docs: `https://developers.lexware.io/`.
- **Credentials**: an API token is required, from **either** the OS keyring **or** the environment.
  `resolveToken()` in `src/services/lexware.ts` reads the keyring first — service `lexware-mcp`,
  overridable with `LEXWARE_KEYRING_SERVICE` — and falls back to `LEXWARE_API_TOKEN`. The README
  recommends the keyring path for credential-free MCP config, so do not "fix" a setup that has no
  `LEXWARE_API_TOKEN`. `LEXWARE_WEBHOOK_PUBLIC_KEY` is optional (PEM; overrides the cached webhook
  signature key).
- **Tool naming**: `lexware_<action>_<resource>` (e.g. `lexware_create_invoice`).
- **Service module**: `src/services/lexware.ts` (axios client). `lexwareDownload()` returns
  `{ data: Buffer, contentType, fileName? }` — **a Buffer, not base64**; the tool-layer wrapper in
  `src/tools/_download.ts` is what converts it to `dataBase64`. Do not double-encode.
  `lexwareUpload()` posts form-data.
- **Layout**: 1 main + 5 split entry points + 20 tool modules + 66 tools. (4.0.0 removed
  `lexware_create_dunning` — it always 400'd, no standalone `POST /dunnings` form exists; 3.2.0
  added e-invoice XML `format` on the 3 XRechnung-capable voucher download tools + 3 deeplink
  tools; 3.0.0 removed `lexware_finalize_invoice` + `lexware_pursue_quotation`.)

  | Entry | Bin |
  |---|---|
  | `src/index.ts` | `lexware-mcp-server` |
  | `src/entry-sales.ts` | `lexware-mcp-sales` |
  | `src/entry-contacts.ts` | `lexware-mcp-contacts` |
  | `src/entry-bookkeeping.ts` | `lexware-mcp-bookkeeping` |
  | `src/entry-reference.ts` | `lexware-mcp-reference` |
  | `src/entry-system.ts` | `lexware-mcp-system` |

- **Conventions**:
  - Optimistic locking: PUT requests require a `version` field in the body.
  - IDs are UUIDs — use **`UuidSchema`** from `src/schemas/common.ts`. (There is no `UuidS`.)
  - Pagination: 0-indexed `page` + `size` (spread `PaginationParams`).
  - Complex bodies: `z.record(z.string(), z.unknown())` — zod 4 needs both key and value schemas.
  - Deeplinks (client-side): `https://app.lexware.de/permalink/<type>/<edit|view>/<id>`. The web app
    is `app.lexware.de`; `api.lexware.io` above is the REST gateway, not deeplinks. Sales vouchers
    use `edit/`, contacts use `view/` (no contacts edit-permalink per Lexware docs).
  - Error formats — the service handles both: `{message, status}` (standard) and `{IssueList}`
    (legacy validation array).
  - **No action-verb endpoints**: Lexware has NO `POST /{resource}/{id}/actions/{verb}` pattern
    (unlike Hetzner). State transitions happen via creation-time query params:
    `POST /{resource}?precedingSalesVoucherId={id}[&finalize=true]`. A tool posting to an
    `/actions/` path on a Lexware resource is wrong — verify against the docs before adding one.
- **Tests**: 41 vitest files under `src/tests/` (21 top-level + 20 in `src/tests/tools/`), 433 tests.
  They are not uniformly axios-mocked — the suite spans schema, resource, server and round-trip
  coverage at different boundaries. `smoke.test.ts` pins the per-entry-point tool counts; keep them
  in sync. `vi.mock()` is hoisted.
