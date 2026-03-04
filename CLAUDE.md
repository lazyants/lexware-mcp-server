# Lexware MCP Server

## Project Setup

- ESM project — use `.js` extensions in all imports (Node16 module resolution)
- `npm run build` (tsc) then `npm test` (vitest) to verify changes
- 65 tools across 20 tool modules, 5 split entry points + 1 main index

## Conventions

- **Tool naming**: `lexware_<action>_<resource>` (e.g. `lexware_create_invoice`)
- **Complex bodies**: Use `z.record(z.unknown())` for create/update — API does server-side validation
- **Optimistic locking**: PUT requests require `version` field in body
- **IDs**: UUIDs for all resources (use `UuidSchema` from `schemas/common.ts`)
- **Pagination**: 0-indexed `page` + `size` params (use `PaginationParams` spread)
- **Deeplinks**: Generated client-side: `https://app.lexware.io/permalink/<type>/edit/<id>`
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
