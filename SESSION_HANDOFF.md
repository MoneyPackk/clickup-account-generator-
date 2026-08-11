# MoneyPack Session Handoff

Updated: 2026-08-08

## Latest work

- Added `storage.js` with atomic JSON writes and wired config, memory, todos, MCP config, and sessions to it.
- Kept persistent Playwright browser state and confirmed open/click/type/evaluate/screenshot/cleanup integration coverage passes.
- Restricted browser HTTP fallback to HTTP(S) URLs.
- Fixed the PowerShell smoke test so expected native stderr does not become a terminating error.
- Revalidated `npm test`, all 8 smoke stages, `npm audit` (0 vulnerabilities), and package dry-run.
- Added a reminder task for deferred hardening/release decisions.

## User intent

Continue developing and hardening MoneyPack while preserving `moneypack` as the canonical terminal command.

## Project

- Project directory: `C:\Users\blazi\.pandaos\demo-project`
- Launch command: `moneypack`
- Canonical launcher: `C:\Users\blazi\.npm-global\moneypack.cmd`
- TUI entry point: `moneypack-tui.js`
- Tool implementation/CLI: `surplus-cli.js`
- Safety and audit harness: `moneypack-harness.js`
- Audit directory: `C:\Users\blazi\.moneypack\audit`

## Completed work

- Preserved one canonical `moneypack` command and the legacy compatibility alias.
- Verified TUI exports and noninteractive behavior.
- Verified session save/list/restore and model/history hydration.
- Added and tested harness protections for destructive shell commands and protected/invalid process IDs.
- Added recursive audit redaction for common credential fields.
- Added `package.json` with start, CLI, dashboard, check, unit-test, and smoke-test scripts.
- Added `.gitignore` for credentials, local state, generated output, agent state, and bundled runtime files.
- Added `README.md` covering setup, operation, storage, safety, testing, browser limitations, and troubleshooting.
- Added `moneypack-tests.js` with regression checks for all 31 tool schemas, unique names, policy behavior, redaction, exports, and denied-executor behavior.
- Restricted future npm package contents with a `files` allowlist.

## Validation

Run:

```powershell
cd C:\Users\blazi\.pandaos\demo-project
npm test
npm pack --dry-run --json
```

Latest `npm test` result: all syntax checks, unit regressions, and all 8 smoke stages passed.

## Important current limitations

1. Browser state is not persistent. `browser_click`, `browser_type`, and `browser_evaluate` cannot follow a completed `browser_open` call as advertised.
2. The harness is defense in depth, not a sandbox. Free-form shell command policy remains bypassable in principle.
3. All project files are currently untracked. Do not make a broad initial commit until unrelated files are reviewed.
4. The package is intentionally `private` and `UNLICENSED`; it is not ready for public publishing.
5. Tool implementations return mostly human-readable strings rather than structured result objects.

## Recommended next implementation

Build a persistent Playwright browser manager in a separate module, preserving one browser/context/page across browser tool calls. Add integration tests for open, click, type, evaluate, and screenshot. If Playwright is unavailable, return a clear capability error for interactive operations while retaining the documented HTTP fallback for `browser_open`.

## Instructions for the next assistant

1. Inspect current files and run `npm test` before risky changes.
2. Preserve `moneypack` as the canonical launch command.
3. Do not commit/delete unrelated untracked files without explicit review.
4. Keep secrets and user-local state out of the repository/package.
5. Update this handoff after meaningful work.
