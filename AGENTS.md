# Agent rules

## Never publish a local disk path

Do not write a path from your machine into any file in this repository. This includes documentation,
comments, examples, tests, JSON configs and commit messages. The repository is public.

**Forbidden examples:**

- `C:\Users\<name>\...` or `C:/Users/<name>/...`
- `/Users/<name>/...` or `/home/<name>/...`
- `file:///C:/Users/...`
- `...\Documents\<workspace>\...` (any personal workspace folder)
- A hard-coded checkout path in a script or an MCP config

**Use instead:**

- `<repo>` or `<path-to-repo>` in prose
- relative links (`./docs/BUILDING.md`, `../electron-builder.json`)
- `<userData>`, `%APPDATA%`, `~/`, `$HOME` for per-user locations
- `process.cwd()`, `app.getAppPath()`, `app.getPath('userData')` in code
- environment variables such as `KUANG_MCP_SERVER` or `KUANG_REPO`

Absolute paths are resolved at runtime. They are never stored in the repository.

**Why:** a path reveals a username, a folder layout, and sometimes a real email address. It cannot be
removed from a public Git history by editing the current file.

**Check:** `npm run check:no-local-paths` scans every tracked text file. CI runs the same check. Do not
weaken the patterns to make a file pass; replace the path.

## Other house rules

- `stdout` in the MCP server is JSON-RPC only. Logs go to `data/logs/mcp-server.log`.
- Settings are written over IPC only. Do not add an HTTP route that changes settings.
- Run `npx tsc --noEmit` and `npm run test:mcp:contract` before you commit.
- Do not commit build output, runtime data or installer binaries. See `.gitignore`.
