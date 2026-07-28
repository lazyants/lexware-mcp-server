# lexware-mcp-server

[![Tests](https://github.com/lazyants/lexware-mcp-server/actions/workflows/test.yml/badge.svg)](https://github.com/lazyants/lexware-mcp-server/actions/workflows/test.yml)

MCP server for the [Lexware Office API](https://developers.lexware.io/docs/). Manage invoices, contacts, articles, vouchers, and more through the Model Context Protocol.

> **Unofficial — community project.** Not affiliated with, endorsed by, or supported by Lexware GmbH or Haufe Group. "Lexware" and "Lexware Office" are trademarks of their respective owners; used here only to identify the API this client targets (nominative fair use).

**65 tools** across 20 resource domains, with 6 entry points so you can pick the right server for your MCP client's tool limit.

## Installation

```bash
npm install -g @lazyants/lexware-mcp-server
```

Or run directly:

```bash
npx @lazyants/lexware-mcp-server
```

## Configuration

The API token is resolved in this order:

1. **OS keyring** (recommended — token never written to disk in plain text)
2. **Environment variable** `LEXWARE_API_TOKEN`

### Store the token in the OS keyring

Get your token from the [Lexware Office API settings](https://app.lexware.de/addons/public-api), then store it with the native credential manager for your OS.

> [!IMPORTANT]
> The commands below read the token from an interactive prompt rather than
> taking it as an argument, so it never lands in your shell history or the
> process list. Avoid pasting the token directly onto the command line.

#### macOS

Omitting the value after `-w` makes `security` prompt for the token (with confirmation):

```bash
security add-generic-password -s "lexware-mcp" -a "api-token" -w
```

#### Windows (PowerShell)

`cmdkey` can only take the token as a command-line argument, which exposes it in
the process list. Instead, read it from a hidden prompt and write it straight
into Windows Credential Manager via `CredWrite`, so the token never reaches argv.
The credential's target name is `<account>.<service>` — `api-token.lexware-mcp`
for the default service — which is exactly what the server reads back:

```powershell
$secure = Read-Host -AsSecureString "Lexware API token"
Add-Type -Namespace LexwareKeyring -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
    [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
    [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
}
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredWriteW(ref CREDENTIAL credential, uint flags);
'@
$blob = [Runtime.InteropServices.Marshal]::SecureStringToCoTaskMemUnicode($secure)
try {
    $cred = New-Object LexwareKeyring.Native+CREDENTIAL
    $cred.Type = 1                              # CRED_TYPE_GENERIC
    $cred.Persist = 2                           # CRED_PERSIST_LOCAL_MACHINE
    $cred.TargetName = 'api-token.lexware-mcp'  # "<account>.<service>"
    $cred.UserName = 'api-token'
    $cred.CredentialBlob = $blob
    $cred.CredentialBlobSize = $secure.Length * 2   # UTF-16 bytes, no terminator
    if (-not [LexwareKeyring.Native]::CredWriteW([ref]$cred, 0)) {
        throw "CredWrite failed (Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
    }
    Write-Host 'Stored Lexware API token in Windows Credential Manager.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($blob)
    $secure.Dispose()
    Remove-Variable secure, blob
}
```

> Using a custom `LEXWARE_KEYRING_SERVICE` (e.g. `acme`)? Set `TargetName` to
> `api-token.acme` to match — the server looks the token up under
> `<account>.<service>`.

#### Linux

```bash
secret-tool store --label="Lexware Office API" service lexware-mcp username api-token
# (prompts for the token value)
```

Once stored, MCP config files need no credentials at all — the server reads the token from the keyring at startup.

### Use an environment variable instead

If you prefer not to use the keyring, set `LEXWARE_API_TOKEN` in your shell or MCP client config:

```bash
export LEXWARE_API_TOKEN=your-token-here
```

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `LEXWARE_API_TOKEN` | — | API token; used when the keyring has no entry for the configured service |
| `LEXWARE_KEYRING_SERVICE` | `lexware-mcp` | Keyring service name. Override when connecting to multiple Lexware accounts simultaneously — run one server instance per account, each with its own service name |

Optionally override the webhook-signature public key used by `lexware_verify_webhook_signature`
(by default fetched from Lexware and cached):

```bash
export LEXWARE_WEBHOOK_PUBLIC_KEY="$(cat lexware-webhook-public.pem)"
```

## Entry Points

| Command | Domains | Tools |
|---|---|---|
| `lexware-mcp-server` | All 20 domains | 65 |
| `lexware-mcp-sales` | Invoices, Credit Notes, Quotations, Order Confirmations, Delivery Notes, Down Payment Invoices, Dunnings, Voucherlist | 32 |
| `lexware-mcp-contacts` | Contacts, Articles | 10 |
| `lexware-mcp-bookkeeping` | Vouchers, Voucherlist, Payments | 8 |
| `lexware-mcp-reference` | Countries, Payment Conditions, Posting Categories, Profile, Print Layouts | 5 |
| `lexware-mcp-system` | Event Subscriptions, Files, Recurring Templates | 11 |

Use split servers to reduce context size — pick only the splits you need.

## Claude Code

Add to `~/.claude/settings.json`. If you stored the token in the OS keyring under the default service name `lexware-mcp` (recommended), no `env` key is needed:

```json
{
  "mcpServers": {
    "lexware": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"]
    }
  }
}
```

If you prefer the environment variable approach:

```json
{
  "mcpServers": {
    "lexware": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"],
      "env": { "LEXWARE_API_TOKEN": "your-token-here" }
    }
  }
}
```

### Split servers

Use split servers to reduce context size — pick only the entry points you need. The `-p @lazyants/lexware-mcp-server` flag tells `npx` which package to source the command from; the final argument (e.g. `lexware-mcp-sales`) is the specific entry-point binary defined in that package (see [Entry Points](#entry-points)):

```json
{
  "mcpServers": {
    "lexware-sales": {
      "command": "npx",
      "args": ["-y", "-p", "@lazyants/lexware-mcp-server", "lexware-mcp-sales"]
    },
    "lexware-contacts": {
      "command": "npx",
      "args": ["-y", "-p", "@lazyants/lexware-mcp-server", "lexware-mcp-contacts"]
    }
  }
}
```

Multi-account example (two Lexware companies, tokens stored under separate keyring service names):

```json
{
  "mcpServers": {
    "lexware-company-a": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"],
      "env": { "LEXWARE_KEYRING_SERVICE": "lexware-company-a" }
    },
    "lexware-company-b": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"],
      "env": { "LEXWARE_KEYRING_SERVICE": "lexware-company-b" }
    }
  }
}
```

## Claude Desktop

Add to `claude_desktop_config.json`. With the OS keyring (recommended — assumes the token is stored under the default service name `lexware-mcp`):

```json
{
  "mcpServers": {
    "lexware": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"]
    }
  }
}
```

With an environment variable instead:

```json
{
  "mcpServers": {
    "lexware": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"],
      "env": { "LEXWARE_API_TOKEN": "your-token-here" }
    }
  }
}
```

## Tools

### Invoices (5 tools) — sales

`lexware_create_invoice` (supports `finalize=true` at creation), `lexware_get_invoice`, `lexware_download_invoice_file`, `lexware_pursue_invoice`, `lexware_deeplink_invoice`

### Credit Notes (5 tools) — sales

`lexware_create_credit_note`, `lexware_get_credit_note`, `lexware_download_credit_note_file`, `lexware_pursue_credit_note`, `lexware_deeplink_credit_note`

### Quotations (4 tools) — sales

`lexware_create_quotation`, `lexware_get_quotation`, `lexware_download_quotation_file`, `lexware_deeplink_quotation`

### Order Confirmations (5 tools) — sales

`lexware_create_order_confirmation`, `lexware_get_order_confirmation`, `lexware_download_order_confirmation_file`, `lexware_pursue_order_confirmation`, `lexware_deeplink_order_confirmation`

### Delivery Notes (5 tools) — sales

`lexware_create_delivery_note`, `lexware_get_delivery_note`, `lexware_download_delivery_note_file`, `lexware_pursue_delivery_note`, `lexware_deeplink_delivery_note`

### Down Payment Invoices (3 tools) — sales

`lexware_get_down_payment_invoice`, `lexware_download_down_payment_invoice_file`, `lexware_deeplink_down_payment_invoice`

### Dunnings (4 tools) — sales

`lexware_get_dunning`, `lexware_download_dunning_file`, `lexware_pursue_dunning`, `lexware_deeplink_dunning`

### Voucherlist (1 tool) — sales, bookkeeping

`lexware_list_voucherlist`

### Contacts (5 tools) — contacts

`lexware_list_contacts`, `lexware_get_contact`, `lexware_create_contact`, `lexware_update_contact`, `lexware_deeplink_contact`

### Articles (5 tools) — contacts

`lexware_list_articles`, `lexware_get_article`, `lexware_create_article`, `lexware_update_article`, `lexware_delete_article`

### Vouchers (6 tools) — bookkeeping

`lexware_list_vouchers`, `lexware_get_voucher`, `lexware_create_voucher`, `lexware_update_voucher`, `lexware_upload_voucher_file`, `lexware_deeplink_voucher`

### Payments (1 tool) — bookkeeping

`lexware_get_payments`

### Countries (1 tool) — reference

`lexware_list_countries`

### Payment Conditions (1 tool) — reference

`lexware_list_payment_conditions`

### Posting Categories (1 tool) — reference

`lexware_list_posting_categories`

### Profile (1 tool) — reference

`lexware_get_profile`

### Print Layouts (1 tool) — reference

`lexware_list_print_layouts`

### Event Subscriptions (5 tools) — system

`lexware_create_event_subscription`, `lexware_list_event_subscriptions`, `lexware_get_event_subscription`, `lexware_delete_event_subscription`, `lexware_verify_webhook_signature`

### Files (3 tools) — system

`lexware_upload_file`, `lexware_download_file`, `lexware_deeplink_file`

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

### Recurring Templates (3 tools) — system

`lexware_list_recurring_templates`, `lexware_get_recurring_template`, `lexware_deeplink_recurring_template`

## Security

- **Use the OS keyring** to keep your API token out of config files and shell history entirely (see [Configuration](#configuration))
- **Never commit your API token** to version control
- Use **read-only** access when you only need to list/get resources
- **Create, update, and delete tools modify real business data** — invoices, contacts, and accounting records in your Lexware account
- Rate limiting is handled automatically: requests retry with exponential backoff on 429, including file uploads — the multipart body is rebuilt fresh on every retry attempt, so it can be replayed safely

## Releasing

Releases ship via the GitHub Release event. Maintainer flow:

1. Bump the version in `package.json`, `package-lock.json`, and `server.json` (`npm version <x.y.z> --no-git-tag-version` updates the first two together). `npm run check-versions` hard-fails unless `package.json#/version`, `server.json#/packages[0].version`, and both `package-lock.json` version fields (root and `packages[""]`) all agree. `server.json#/version` is checked more loosely: it must be present, but it is only compared against `packages[0].version` as a regression check — it may legitimately be *ahead* (registry-only republishes bump just that field), so a value left behind at the previous release passes with a `WARN:` line and no failure. For an ordinary release both should move together, so read the script's output rather than trusting its exit code. `CHANGELOG.md` is not checked at all.
2. Update `CHANGELOG.md`.
3. Commit, and **merge the version bump to `main` before creating the release**. Then create the tag yourself, on a SHA you have checked, and only then create the release from it:

   ```bash
   V=X.Y.Z && PR=<release-pr-number> &&
     SHA="$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)" && test -n "$SHA" &&
     git fetch origin main && git merge-base --is-ancestor "$SHA" origin/main &&
     PKG="$(git show "$SHA:package.json")" &&
     test "$(printf '%s' "$PKG" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')" = "$V" &&
     CL="$(git show "$SHA:CHANGELOG.md")" &&
     printf '%s\n' "$CL" | awk -v v="$V" 'index($0,"## ["v"]")==1{f=1;next} /^## \[/{f=0} /^\[[0-9]+\.[0-9]+\.[0-9]+\]:/{f=0} f' > "/tmp/notes-v$V.md" &&
     grep -q '[^[:space:]]' "/tmp/notes-v$V.md" &&
     git tag -a "v$V" "$SHA" -m "v$V" &&
     git push origin "v$V" &&
     gh release create "v$V" --verify-tag --notes-file "/tmp/notes-v$V.md"
   ```

   The failure this prevents: with no existing tag, `gh release create` places one on the **tip of the default branch**, so running it while the bump is still on a release branch tags the *previous* release's commit. The workflow then publishes whatever version it finds in that commit's `package.json`, and you get a `vX.Y.Z` GitHub Release that silently republishes the old version. Nothing downstream catches it — neither the workflow nor `check-versions` compares the tag against the version files (tracked in #103), which is why the sequence above has to do it.

   Each element is load-bearing:

   - **`gh pr view … .mergeCommit.oid`** names the release PR's own squash commit. Do not substitute `git rev-parse origin/main` — that is merely whatever is on `main` at the moment you look, so an unrelated merge landing in the gap gets tagged and shipped instead. `gh` exits 0 and prints nothing for an unmerged PR, hence the explicit `test -n`.
   - **The `&&` chain** stops on the first failure instead of falling through to the irreversible step. Both `git show` calls are assigned to a variable rather than piped directly, so their exit status is actually checked — a pipeline reports only its *last* command's status unless `pipefail` is set, which is not assumed here.
   - **`git merge-base --is-ancestor`** proves the commit is actually reachable from `main`. Mere existence is not enough — a commit can be present locally because some other branch was fetched, and if its version files happen to match it would otherwise sail through every remaining check.
   - **The version test reads `package.json` out of the target commit**, not the working tree, which would still show the right version while `$SHA` pointed elsewhere.
   - **The `awk`** lifts that version's section out of the commit's `CHANGELOG.md` for `--notes-file`. Without it the release body is whatever `--notes-from-tag` finds in the annotation — for this flow, the literal string `vX.Y.Z`, which is a poor release note for any version and an actively misleading one for a major carrying a breaking change. It stops at the next `## [` heading *or* at the first link-reference definition, because the oldest entry in the file has no heading after it and would otherwise swallow the entire link-reference block. `grep -q` rather than `test -s` guards the result: a section that is empty apart from its blank line still produces a one-byte file, which `test -s` accepts.
   - **`--verify-tag`** makes `gh` abort rather than invent a tag if the push did not land — the guard against `gh` falling back to the tip-of-default-branch behavior described above.

   If `gh release create` fails after the tag is already pushed, do not rerun the whole block — it will stop at `git tag`, which is correct. Rerun only the final command.
4. The `Publish to npm + MCP Registry` workflow runs automatically: it `npm publish`es with provenance, polls the registry until the tarball is available, then pushes the matching `server.json` to the MCP Registry via `mcp-publisher`.

The workflow skips `npm publish` cleanly if the version is already on npm (cutover guard for releases that were partially published manually).

### Publishing auth — npm Trusted Publishing (no token)

Publishing uses **npm Trusted Publishing** via OIDC — there is **no `NPM_TOKEN` secret**. The workflow's `id-token: write` permission is exchanged for a short-lived, one-shot publish token at publish time, using the trusted-publisher binding configured for `@lazyants/lexware-mcp-server` in the npm web UI. The only setup required is that trusted-publisher binding on npm; nothing needs to be stored in repository secrets.

## Disclaimer

This is an **unofficial, independent community project**. It is not affiliated with, endorsed by, sponsored by, or supported by Lexware GmbH, Haufe Group, or any of their affiliates. For official Lexware support, contact Lexware directly — issues with this MCP server should be reported here, not to Lexware.

"Lexware" and "Lexware Office" are trademarks of their respective owners and are used in this project's name and documentation under nominative fair use, solely to identify the third-party API this client connects to.

Create, update, and delete operations modify real business data in your Lexware account. The authors provide this software "as-is" and accept no responsibility for unintended changes, data loss, or any other damages arising from its use. Test against a sandbox or non-critical account before running write operations against production data.

## License

[FSL-1.1-MIT](LICENSE) — see [LICENSE](LICENSE) for the full terms.
