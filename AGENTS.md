# Agent rules

## Never publish a local disk path

Do not write a path from your machine into any file in this repository. This includes documentation,
comments, examples, tests, JSON configs and commit messages. The repository is public.

**Forbidden examples:**

- `[drive]:\Users\<name>\...` or `[drive]:/Users/<name>/...`
- `/Users/<name>/...` or `/home/<name>/...`
- `file:///<drive>/Users/<name>/...`
- any path that contains a personal workspace folder (for example, `Documents/<workspace>/...`)
- a hard-coded checkout path in a script or an MCP config

**Use instead:**

- `<repo>` or `<path-to-repo>` in prose
- relative links (`./docs/BUILDING.md`, `../electron-builder.json`)
- `<userData>`, `%APPDATA%`, `~/`, `$HOME` for per-user locations
- `process.cwd()`, `app.getAppPath()`, `app.getPath('userData')` in code
- environment variables such as `KUANG_MCP_SERVER` or `KUANG_REPO`

Absolute paths are resolved at runtime. They are never stored in the repository.

**Why:** a path reveals a username, a folder layout, and sometimes a real email address. It cannot be
removed from a public Git history by editing the current file.

**Check:** `npm run check:no-local-paths` scans every tracked text file. CI runs the same check on every
push and pull request. Do not weaken the patterns to make a file pass; replace the path.

**Fix:** `npm run fix:local-paths` rewrites obvious leaks in Markdown (home prefixes, the workspace folder,
`file:///` URLs). Review the diff; it does not rewrite Git history.

## Other house rules

- `stdout` in the MCP server is JSON-RPC only. Logs go to `data/logs/mcp-server.log`.
- Settings are written over IPC only. Do not add an HTTP route that changes settings.
- For new transport, session, tunnel, auth or child-process code, apply the NASA/JPL review skill in `.agents/skills/NASACodeReview`. Treat Blocker findings as merge blockers; legacy findings are warnings unless the change makes them worse.
- If a review or implementation finds a real problem unrelated to the current task, file it in the GitHub issue queue instead of fixing it on a tangent. Search for an existing issue first; link the issue from the final summary. Related findings — ones the change introduces, worsens, or needs to complete safely — stay in the current task. Only fix an unrelated finding immediately when it is a security or lifecycle problem that the current change would worsen or that blocks safe verification.
- Run `npx tsc --noEmit` and `npm run test:mcp:contract` before you commit.
- Do not commit build output, runtime data or installer binaries. See `.gitignore`.
