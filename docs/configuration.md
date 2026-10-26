# Configuration

How to give the server its Lexware Office API token, connect it to an MCP client, and limit what it
can change. For the short version, see the [README](../README.md#quick-start).

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

If you prefer not to use the keyring, set `LEXWARE_API_TOKEN` in your shell or MCP client config.
In bash or zsh, `read -rs` asks for the token without showing it, so it stays out of your shell
history:

```bash
read -rs LEXWARE_API_TOKEN   # paste the token, then press Enter
export LEXWARE_API_TOKEN
```

A token in an MCP client config file is stored there in plain text. **Never commit your API token**
to version control.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `LEXWARE_API_TOKEN` | — | API token; used when the keyring has no entry for the configured service or cannot be read. An empty value counts as no token |
| `LEXWARE_KEYRING_SERVICE` | `lexware-mcp` | Keyring service name. Override when connecting to multiple Lexware accounts simultaneously — run one server instance per account, each with its own service name |
| `LEXWARE_WEBHOOK_PUBLIC_KEY` | — | PEM public key for `lexware_verify_webhook_signature`; by default the key is fetched from Lexware and cached |
| `LEXWARE_READ_ONLY` | off | `true` or `1` makes the server refuse every tool that changes Lexware data; see [Read-only mode](#read-only-mode) |

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

## Read-only mode

Set `LEXWARE_READ_ONLY` to `true` to make the server refuse every tool that creates, changes,
deletes, uploads or pursues data. The server enforces this itself: a blocked tool sends no request
to Lexware, whatever the MCP client or the AI model asks for.

```json
{
  "mcpServers": {
    "lexware": {
      "command": "npx",
      "args": ["-y", "@lazyants/lexware-mcp-server"],
      "env": { "LEXWARE_READ_ONLY": "true" }
    }
  }
}
```

| Value | Effect |
| --- | --- |
| unset, empty, `false`, `0` | Off (the default). Every tool works as before. |
| `true`, `1` | On. Case and surrounding spaces are ignored. |
| anything else | The server does not start. It prints `LEXWARE_READ_ONLY must be "true", "1", "false" or "0" (unset or empty means off).` |

When read-only mode is on:

- Tools that change data stay in your client's tool list, but their description starts with
  "Blocked:" and they take no parameters. A call to one returns an error such as
  `lexware_create_invoice is blocked: read-only mode is on (LEXWARE_READ_ONLY), so this server does not create, change, delete, upload or pursue Lexware data.`
  No request is sent to Lexware.
- Tools that only read work as usual: the get, list, download and deeplink tools and
  `lexware_verify_webhook_signature`. The `reference://lexware/api` resource is still available.
- Which tools may run is a fixed list in the server code, not a guess from tool names. A tool added
  in a later version is blocked in read-only mode until it is put on that list.

The setting applies to the full server and to every split server. Each server entry in your client
config runs as its own process, so set the variable in every entry that should be read-only.

### Limitations

- It limits this server only. Your API key keeps all the permissions it was created with, and any
  other program that uses the key can still change data.
- Read tools still send business data and file contents to your MCP client and to the AI model
  behind it.
- Unless `LEXWARE_WEBHOOK_PUBLIC_KEY` is set, `lexware_verify_webhook_signature` fetches Lexware's
  public key from `developers.lexware.io` once. This only reads; it changes nothing.
- You cannot choose which tools to block. Read-only mode blocks every tool that changes data, and
  nothing else.

## Limit what the server can change

Several safeguards can apply when an AI client uses this server. This table shows who enforces each
one; some are only hints.

| Safeguard | Enforced by | What it does | What it does not do |
| --- | --- | --- | --- |
| API token permissions | Lexware | Lexware refuses requests the token is not allowed to make (HTTP 403). | A token's permissions cannot be changed after it is created; create a new token instead. |
| [Read-only mode](#read-only-mode) | This server | With `LEXWARE_READ_ONLY=true`, refuses every tool that changes data; a blocked call sends no request to Lexware. | It is off by default and limits only this server; the token keeps its permissions for any other program. Read tools still send business data to the client and the AI model. |
| Approval of tool calls | Your MCP client | The client asks you before a tool runs, if it is set up to ask. Some clients can also block single tools. | This server does not ask for approval and cannot tell whether you were asked. "Always allow", auto-approval, or a mode that skips approval prompts turns this safeguard off. |
| Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) | Nobody; they are descriptions | Tell the client which tools only read and which change data, so it can decide when to warn or ask. | They block nothing. The [MCP specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) tells clients to treat annotations as untrusted unless they trust the server. |
| [Split servers](#split-servers) | This server | Offer only the tools for one subject area, so the client sees fewer tools. | They are grouped by subject, not by read or write access. Most of them include tools that create, change, or delete data. |
| Draft creation | Lexware, by default | Tools with a `finalize` option create a draft unless you pass `finalize: true`; only then does this server ask Lexware to finalize. | A draft is still a new record in your Lexware account. Other tools that change data — for example updates, deletes, uploads, and creating contacts or articles — have no draft step. |

### A conservative setup

1. **Create a dedicated API token with individual permissions.** Lexware calls the token an API key
   (*API-Schlüssel*). In the [Lexware Office API settings](https://app.lexware.de/addons/public-api),
   choose individual permissions instead of all permissions. Select only what the AI client needs,
   and prefer read-only permissions — in Lexware's list, those that retrieve (*abrufen*) or download
   (*herunterladen*). Add permissions that save or change data only for the areas where the client
   must make changes. Lexware's guide
   [Alles rund um Public API](https://help.lexware.de/de-form/articles/9263622-alles-rund-um-public-api)
   (German) describes the options.
2. **Store the token in the OS keyring**, as described in
   [Store the token in the OS keyring](#store-the-token-in-the-os-keyring). Do not put it in a
   committed file or on a command line.
3. **Turn on read-only mode** in every server entry that only needs to read, as described in
   [Read-only mode](#read-only-mode). It blocks the tools that change data in this server, even if
   the token could write.
4. **Keep reading and writing in separate server entries** if you need both. Give each entry its own
   keyring service name and store a token under each, as for
   [multiple accounts](#multiple-lexware-accounts): a token with read-only permissions and read-only
   mode for the entry you keep on, and a token that can write for an entry you turn on only when you
   need it.

   ```json
   {
     "mcpServers": {
       "lexware-read": {
         "command": "npx",
         "args": ["-y", "@lazyants/lexware-mcp-server"],
         "env": {
           "LEXWARE_KEYRING_SERVICE": "lexware-read",
           "LEXWARE_API_TOKEN": "",
           "LEXWARE_READ_ONLY": "true"
         }
       },
       "lexware-write": {
         "command": "npx",
         "args": ["-y", "@lazyants/lexware-mcp-server"],
         "env": { "LEXWARE_KEYRING_SERVICE": "lexware-write", "LEXWARE_API_TOKEN": "" }
       }
     }
   }
   ```

   The empty `LEXWARE_API_TOKEN` matters. If an entry's keyring item is missing or cannot be read,
   the server falls back to `LEXWARE_API_TOKEN`, and your client may pass on a value from its own
   environment that can write. The empty value replaces it, so the server reports "No Lexware API
   token found" instead of using a different token.

   In the read entry, the tools that change data stay listed but are marked "Blocked:". Read-only
   mode refuses them before any request is sent, and Lexware would refuse them too, because the
   token lacks the permission.
5. **Require approval for tools that change data.** Do not "always allow" them, and do not use a
   client mode that skips approval prompts while an entry with a token that can write runs without
   read-only mode. Where your
   client supports it, block tools you never use. In Claude Code, for example, this deny rule blocks
   one tool of a server named `lexware` (see the
   [Claude Code permissions documentation](https://code.claude.com/docs/en/permissions#mcp)):

   ```json
   {
     "permissions": {
       "deny": ["mcp__lexware__lexware_delete_article"]
     }
   }
   ```
6. **Approve an upload only for a file you mean to send to Lexware.** The upload tools accept
   `filePath` and send any file that the server process can read. Read-only token permissions do not
   stop the server from reading the file and sending the upload request; read-only mode does, because
   it blocks the upload tools.
7. **Use a split server to offer fewer tools.** Most split servers still include tools that change
   data.
8. **Test against a sandbox or non-critical account** before you let the client change production
   data.

### When read-only mode is off

Unless read-only mode is on, this server carries out every valid tool call that its API token
allows, including calls a model makes after reading untrusted text, such as an email or a document
that contains instructions. Then the safeguards against unintended changes are your API token's
permissions and your client's approval prompts.
