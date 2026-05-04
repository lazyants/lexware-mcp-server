# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- npm package: [`@lazyants/lexware-mcp-server`](https://www.npmjs.com/package/@lazyants/lexware-mcp-server)
- MCP Registry: [`io.github.lazyants/lexware`](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.lazyants/lexware)

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

[1.0.2]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v1.0.2
[1.0.1]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v1.0.1
[1.0.0]: https://github.com/lazyants/lexware-mcp-server/releases/tag/v1.0.0
