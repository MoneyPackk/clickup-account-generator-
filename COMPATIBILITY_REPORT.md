# MoneyPack TUI Compatibility Report

## Completed interaction contract

- Grapheme-aware multi-line editing, vertical and line-aware cursor navigation, deletion, paste, and composer mouse placement.
- Fuzzy, categorized command/model/session/file/shell completion with descriptions, metadata, keyboard focus, Enter selection, and mouse targets.
- Whole-message keyboard range selection and clipboard copy; terminal-native Shift+drag remains supported.
- Searchable session manager with previews, relative time, keyboard and exact mouse actions, rename editing, and confirmed deletion.
- Persistent application workspaces with create, rename, switch, direct API selection, close, manager overlay, and atomic JSON storage.
- Exact link and code-copy hit regions, selectable transcript rows, and grouped tool status/elapsed/collapse controls.
- Compact, standard, and wide responsive modes; minimum body sizing is enforced for short terminals.
- Context rail exposes session/model/current directory and attached files; wide status exposes workspace/file counts.

## Terminal behavior

| Host | Keyboard | SGR mouse | Notes |
|---|---|---|---|
| Windows Terminal / PowerShell | Full | Full | Recommended |
| Windows Terminal / cmd | Full | Full | Recommended |
| ConPTY ANSI hosts | Full | Full when SGR enabled | Modified Enter encoding depends on host |
| Redirected/non-TTY | Not applicable | Not applicable | TUI intentionally refuses startup |

Modified Enter support includes CSI-u (`CSI 13;2u`), xterm modifyOtherKeys, and Alt-Enter byte forms. Hover is not enabled because terminal mouse-motion capture prevents normal selection; controls use persistent labels and selected/focus surfaces. Browser interactions require Playwright/Chromium for persistent DOM state and fall back to read-only HTTP extraction otherwise.

## Verification

`npm test` runs syntax checks plus editor, palette, responsive layout, selection/actions, session mutation, workspace, safety policy, browser persistence, screenshot, and cleanup regressions. `.moneypack-smoke.ps1` validates installed command resolution and interactive-launch guards on Windows.
