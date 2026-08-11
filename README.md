# MoneyPack Terminal

MoneyPack is a Windows-focused terminal assistant with a split-pane TUI, streaming model responses, saved sessions, MCP support, and 31 local tools.

> **Status:** local development build. Core tests and smoke checks pass, including persistent browser open/click/type/evaluate/screenshot operations. Privileged or unattended use is not recommended.

## Requirements

- Windows Terminal, PowerShell, or another interactive ANSI terminal
- Node.js 20 or newer
- A Surplus Intelligence API key
- Optional: Git and Python for their corresponding tools
- Optional: Playwright plus Chromium for full browser rendering/screenshots

## Start

The installed canonical command is:

```powershell
moneypack
```

From this source directory:

```powershell
npm start
```

The TUI deliberately refuses redirected/noninteractive input. Use the plain CLI for non-TUI operation:

```powershell
npm run cli
```

## API setup

Configure the API key through the existing CLI setup flow rather than placing it in this repository:

```powershell
node .\surplus-cli.js setup --key inf_your_key
```

Configuration is stored in `%USERPROFILE%\.surplus-cli.json`. Do not commit that file or paste its contents into issues and logs.

## Commands and features

- Streaming chat, fuzzy command/model/file/shell palette, and model shortcuts
- Grapheme-safe multi-line composer: `Shift+Enter` newline, line-aware arrows/Home/End, mouse cursor placement
- Keyboard message/range selection (`Ctrl+S`, `Shift+↑/↓`) and `Ctrl+Y` copy
- Searchable session manager with previews, resume, rename, confirmed delete, keyboard and mouse actions
- Persistent workspaces/tabs: `/tab new`, `/tab close`, `/tabs`, `/workspace NAME`, `Ctrl+W`
- Clickable links, fenced-code copy controls, and expandable/collapsible tool runs
- Compact (<76 columns), standard, and wide (≥120 columns) responsive layouts
- Context rail with model/session/filesystem/attached-file state and status metrics
- Markdown-oriented terminal rendering
- Tool activity rail and status display
- Local memory and todos
- MCP stdio/HTTP integration
- Filesystem, shell, web, browser, code, Git, process, clipboard, download, and system tools

The exported tool set currently contains 31 tools. Run the plain CLI and enter `/tools` to inspect them.

## Sessions and local data

| Data | Default location |
|---|---|
| API configuration | `%USERPROFILE%\.surplus-cli.json` |
| Sessions | `%USERPROFILE%\.moneypack-sessions` |
| Memory | `%USERPROFILE%\.moneypack-memory.json` |
| Todos | `%USERPROFILE%\.moneypack-todo.json` |
| MCP configuration | `%USERPROFILE%\.moneypack-mcp.json` |
| Audit events | `%USERPROFILE%\.moneypack\audit` |
| Persistent workspaces | `%USERPROFILE%\.moneypack\tabs.json` |

Audit entries redact fields with names such as `authorization`, `api_key`, `token`, `password`, `secret`, and `cookie`. Avoid putting credentials directly inside shell command strings because arbitrary free text cannot be redacted perfectly.

## Safety model

`moneypack-tui.js` routes tool calls through `moneypack-harness.js`. The harness:

- Audits tool requests, completions, denials, and failures
- Redacts common secret-bearing fields
- Rejects protected/invalid process IDs
- Rejects a conservative set of clearly destructive shell commands

This is a safety layer, **not a complete sandbox**. Tools can access the local machine with the permissions of the current user. Review important changes and do not run MoneyPack elevated unless necessary.

## Development

Syntax checks:

```powershell
npm run check
```

Full smoke suite:

```powershell
npm test
```

The suite verifies command resolution, syntax, exports, harness policy/redaction, audit events, the noninteractive guard, session restore, and the legacy alias.

## Terminal compatibility

The interaction layer uses standard ANSI/SGR mouse reporting and supports Windows Terminal, modern ConPTY hosts, PowerShell, and cmd. Terminal-native text selection remains available with `Shift`+drag. `Shift+Enter` recognizes CSI-u, modifyOtherKeys, and common Alt-Enter encodings; terminals that do not report modified Enter can insert a literal newline through paste. Hover styling is intentionally not used because continuous mouse-motion reporting interferes with terminal selection; all controls have persistent focus/selected states instead.

Playwright browser operations retain persistent page state for open/click/type/evaluate/screenshot calls and are covered by integration tests. Without Playwright/Chromium, browser opening falls back to HTTP extraction and stateful DOM interaction is unavailable.

## Dashboard

A local development dashboard/proxy can be started with:

```powershell
npm run dashboard
```

It listens only on `127.0.0.1:3000` by default.

## Troubleshooting

- **“The TUI needs an interactive terminal”** — run `moneypack` directly in an interactive terminal, not through redirected output.
- **“No API key”** — run the setup command above.
- **Browser fallback message** — install Playwright and Chromium, or use web fetch/scrape tools.
- **Git/Python tool errors** — ensure those executables are available on `PATH`.

## Release state

This package is currently marked `private` and `UNLICENSED`; it is not configured for npm publication. Choose a license, cleanly initialize the repository, and complete the security/browser backlog before public distribution.
