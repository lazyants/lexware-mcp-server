# Open-issue implementation plan — 2026-10-02

This batch covers every open issue in `lazyants/lexware-mcp-server` when work
started. Each implementation ships through a focused pull request. The initial
dependency PR #119 shared the failing audit; after prerequisite #125 merged,
Dependabot closed #119 and replaced it with the remaining updates in #128.

| Scope | Implementation and acceptance evidence | Pull request |
| --- | --- | --- |
| Audit prerequisite | Refresh affected dependency floors and the lockfile; require production audit, lint, version sync, build and tests before merging. | [#125](https://github.com/lazyants/lexware-mcp-server/pull/125), [#128](https://github.com/lazyants/lexware-mcp-server/pull/128) |
| #70 | Add creation-time `finalize` to four sales tools, updated-date filters and sorting to voucherlist, and XML generic file downloads. Verify query/header forwarding, defaults, pagination and MCP discovery. | [#126](https://github.com/lazyants/lexware-mcp-server/pull/126) |
| #78 | Keep the contact `url` output permanently alongside `deeplink`; document the decision and retain the existing output assertions. | [#123](https://github.com/lazyants/lexware-mcp-server/pull/123) |
| #120–#122 | Publish unchecked-voucher update restrictions, supported text formatting, and external webhook acknowledgement/queue guidance through MCP descriptions/resources and README. Verify discovery and unchanged payload forwarding. | [#124](https://github.com/lazyants/lexware-mcp-server/pull/124) |
| #99 | Enable grouped security updates after the configuration PR merges; verify the repository setting with the GitHub API. Retain the Node 20 type-package cap and unsupported TypeScript-major exclusion, and document the security fixes they can suppress. | [#127](https://github.com/lazyants/lexware-mcp-server/pull/127) |
| #95 | Keep parked until a published `typescript-eslint` peer range admits TypeScript 7. Registry check on 2026-10-02: latest `typescript-eslint` 8.71.0 and canary 8.71.1-alpha.5 require `>=4.8.4 <6.1.0`; TypeScript latest is 7.0.2. No compatible upgrade exists yet. | [Upstream condition](https://github.com/lazyants/lexware-mcp-server/issues/95) |

For each changed tree, perform simplification, adversarial and security reviews
in that order, rerunning after reviewer changes. Require current-head Node 20
and Node 22 CI success and resolve review findings before merging. Rebase later
PRs onto the merged prerequisite and preceding PRs because branch protection
requires an up-to-date branch.

Issue #95 remains open until its upstream condition is satisfied. Passing the
other PRs does not satisfy that issue. Releases are separate from this batch.

## Dependency policy decision

The maintainer selected **enable grouped security updates** on 2026-10-02.
The npm and GitHub Actions ecosystems each have a `security-updates` group
using `applies-to: security-updates` and `patterns: ["*"]`; weekly minor/patch
version-update groups remain separate. This follows GitHub's
[security-update configuration guidance](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates).

Per GitHub's [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference),
`ignore` rules affect security updates as well as version updates. The
`@types/node` major exclusion maintains the Node 20 declarations; the TypeScript
major exclusion prevents an unsupported parser/compiler combination. Security
advisories requiring either excluded major need manual review. Dependency alerts
remain enabled, and ordinary security updates still pass the existing CI and PR
review gates.
