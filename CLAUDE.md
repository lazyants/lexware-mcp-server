# lexware-mcp-server

Guidance for working in this repository. It carries the **coding and convention** rules — enough to
write and review code here without another file. It is deliberately NOT the whole story:

- **Validation and CI** are defined by `.github/workflows/test.yml` (the required sequence: `npm ci`,
  lint, `node scripts/check-versions.mjs`, `npm audit --audit-level=moderate --omit=dev`, build,
  tests, on the Node 20 + 22 matrix). Read that file — it is versioned here and is the source of
  truth, not a summary of it.
- **Releasing** is in `README.md` § Releasing, including the guarded tagging sequence.
- **Fleet-wide material** — the publishing playbook, the hygiene skill, the sibling servers — is in
  the fleet-root `CLAUDE.md` of the `lazy-ants/development/mcp/` checkout. A standalone clone does
  not have it; everything needed to work in *this* repo is here or in the two files named above.

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
- **This file does not restate structure that lives in code.** No inventories, no counts, no
  duplicated tables — a copy of a fact rots the moment the code moves, and nothing here is checked
  by any test. Where you need a structural fact, read the file that owns it (named below in each
  case) or run the one-liner. If you find a bare count or a duplicated table here, it is a bug:
  delete it and point at the source.

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
  `src/tools/_download.ts` is what converts it — its `downloadFileResult()` returns
  **`contentBase64`** (there is no `dataBase64` field in this repo). Do not double-encode.
  `lexwareUpload()` posts form-data.
- **Layout**: one main entry plus split entry binaries. `src/index.ts` and `src/entry-*.ts` are the
  entries; `package.json` `bin` maps each to its published command; `src/tools/` holds the tool
  modules and `src/tools/registrars.ts` the barrel. `src/tests/smoke.test.ts` asserts the tool count
  per entry point — read it for the current numbers, and update it in the same commit as any tool
  addition or removal.

  Removals worth knowing: 4.0.0 dropped `lexware_create_dunning` (it always 400'd — no standalone
  `POST /dunnings` form exists); 3.2.0 added e-invoice XML `format` to the XRechnung-capable voucher
  download tools and the deeplink tools; 3.0.0 dropped `lexware_finalize_invoice` and
  `lexware_pursue_quotation`.

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
- **Tests**: vitest, under `src/tests/` with a `tools/` subdirectory
  (`find src/tests -name '*.test.ts' | wc -l` for the current file count; `npm test` reports the
  test total). They are not uniformly axios-mocked — the suite spans schema, resource, server and round-trip
  coverage at different boundaries. `smoke.test.ts` pins the per-entry-point tool counts; keep them
  in sync. `vi.mock()` is hoisted.
