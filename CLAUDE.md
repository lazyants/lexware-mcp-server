# Lexware MCP Server

## Project Setup

- ESM project — use `.js` extensions in all imports (Node16 module resolution)
- `npm run build` (tsc) then `npm test` (vitest) to verify changes
- 66 tools across 20 tool modules, 5 split entry points + 1 main index

## Conventions

- **Tool naming**: `lexware_<action>_<resource>` (e.g. `lexware_create_invoice`)
- **Complex bodies**: Use `z.record(z.string(), z.unknown())` for create/update — zod 4 requires both key and value schemas. API does server-side validation.
- **Optimistic locking**: PUT requests require `version` field in body
- **IDs**: UUIDs for all resources (use `UuidSchema` from `schemas/common.ts`)
- **Pagination**: 0-indexed `page` + `size` params (use `PaginationParams` spread)
- **Deeplinks**: Generated client-side. Sales vouchers use `edit/` (`invoices`, `credit-notes`, `quotations`, `order-confirmations`, `delivery-notes`, `down-payment-invoices`, `dunnings`); contacts use `view/` (no edit permalink per Lexware docs). Pattern: `https://app.lexware.io/permalink/<type>/<edit|view>/<id>`.
- **File downloads**: Use `lexwareDownload()` from `services/lexware.ts` — returns base64
- **File uploads**: Use `lexwareUpload()` from `services/lexware.ts` — uses `form-data`

## Error Handling

Dual error formats in `services/lexware.ts`:
- Standard: `{ message, status }`
- Legacy: `{ IssueList }` (array of validation issues)

## Testing

- 6 test files, vitest with mocked axios
- `smoke.test.ts` — counts tools per entry point (update counts when adding/removing tools)
- **GOTCHA**: `vi.mock()` calls are hoisted — use `vi.hoisted()` for shared mocks
- **GOTCHA**: Use `importOriginal` when you need to keep real implementations alongside mocks

## MCP Registry

- **GOTCHA**: `server.json` has two `version` fields — root `version` is the MCP Registry version (must be unique per publish), `packages[0].version` is the npm version (must exist on npm). They can differ.
