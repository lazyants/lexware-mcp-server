# Configuration

How to give the server its Lexware Office API token and connect it to an MCP client. For the short
version, see the [README](../README.md#quick-start).

## How the server finds the API token

The API token is resolved in this order:

1. **OS keyring** (recommended — token never written to disk in plain text)
2. **Environment variable** `LEXWARE_API_TOKEN`

The keyring entry uses the service name `lexware-mcp` and the account name `api-token`. Set
`LEXWARE_KEYRING_SERVICE` to use a different service name.

If the keyring has no entry, is unavailable (headless Linux without a Secret Service / `libsecret`,
CI, a load failure, an unsupported platform, `--omit=optional`), or does not answer within
5 seconds, the server falls back to `LEXWARE_API_TOKEN`. The keyring is never required. If neither
source has a token, API calls fail with an error that names both sources and links to the token
page; it never includes a token value.

## Store the token in the OS keyring

Get your token from the [Lexware Office API settings](https://app.lexware.de/addons/public-api), then store it with the native credential manager for your OS.

> [!IMPORTANT]
> The commands below read the token from an interactive prompt rather than
> taking it as an argument, so it never lands in your shell history or the
> process list. Avoid pasting the token directly onto the command line.

### macOS

Omitting the value after `-w` makes `security` prompt for the token (with confirmation):

```bash
security add-generic-password -s "lexware-mcp" -a "api-token" -w
```

### Windows (PowerShell)

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

### Linux

```bash
secret-tool store --label="Lexware Office API" service lexware-mcp username api-token
# (prompts for the token value)
```

This needs a Secret Service (`libsecret`). On a headless machine without one, use the
[environment variable](#use-an-environment-variable-instead) instead.

Once stored, MCP config files need no credentials at all — the server reads the token from the
keyring on its first API request.

## Use an environment variable instead

If you prefer not to use the keyring, set `LEXWARE_API_TOKEN` in your shell or MCP client config:

```bash
export LEXWARE_API_TOKEN=your-token-here
```

A token in an MCP client config file is stored there in plain text. **Never commit your API token**
to version control.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `LEXWARE_API_TOKEN` | — | API token; used when the keyring has no entry for the configured service |
| `LEXWARE_KEYRING_SERVICE` | `lexware-mcp` | Keyring service name. Override when connecting to multiple Lexware accounts simultaneously — run one server instance per account, each with its own service name |
| `LEXWARE_WEBHOOK_PUBLIC_KEY` | — | PEM public key for `lexware_verify_webhook_signature`; by default the key is fetched from Lexware and cached |

To override the webhook-signature public key:

```bash
export LEXWARE_WEBHOOK_PUBLIC_KEY="$(cat lexware-webhook-public.pem)"
```

## Connect an MCP client

`npx` downloads and runs the package, so no separate install step is needed. To install it
globally instead, run `npm install -g @lazyants/lexware-mcp-server`; the entry-point commands
below are then on your `PATH`.

### Server entry

With the token in the keyring under the default service name `lexware-mcp`, no `env` key is
needed:

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

If you prefer the environment variable approach, add an `env` key:

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

### Claude Desktop

Add the server entry to `claude_desktop_config.json`.

### Claude Code

Add the server for all your projects:

```bash
claude mcp add --scope user lexware -- npx -y @lazyants/lexware-mcp-server
```

To share it with a project instead, put the keyring server entry in `.mcp.json` at the project root,
or run the command with `--scope project`. Do not put a token in `.mcp.json`: that file is meant to be
committed. `claude mcp add` also accepts `-e LEXWARE_API_TOKEN=…`, but that puts the token on the
command line and in your shell history; prefer the keyring. See the
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) for scopes and other options.

## Split servers

The package also ships smaller entry points that each cover one area (see the
[README](../README.md#entry-points)). Use split servers to reduce context size — pick only the entry
points you need. The `-p @lazyants/lexware-mcp-server` flag tells `npx` which package to source the
command from; the final argument (e.g. `lexware-mcp-sales`) is the specific entry-point binary
defined in that package:

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

In Claude Code:

```bash
claude mcp add --scope user lexware-sales -- npx -y -p @lazyants/lexware-mcp-server lexware-mcp-sales
```

## Multiple Lexware accounts

Run one server instance per account, each with its own keyring service name. Store each token under
its service name (replace `lexware-mcp` in the commands above, or `TargetName` on Windows). Example
for two Lexware companies:

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
