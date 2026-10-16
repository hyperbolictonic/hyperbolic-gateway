# Session Vault & Cookie Jar

The **Session Vault** (`src/main/session/session-vault.ts`) enables autonomous agents to serialize, persist, and restore browser state across sessions.

## Capabilities

- **Cookie Jar Persistence**: Captures all HTTP and secure cookies for the current domain or global partition.
- **LocalStorage State**: Reads active `localStorage` items from the live `WebContents` and restores them.
- **Session Rehydration**: Replays cookies into Electron's `session.cookies` partition and injects stored keys back into the DOM when navigating back to target sites.
- **Isolated Profiles**: Snapshots are saved to `data/sessions/<name>.json`, allowing agents to maintain multiple named personas (e.g. `research_agent`, `shopper_dev`, `reddit_auth`).

## HTTP Bridge API

- `POST /session/save` - `{ "name": "optional_name" }` -> saves active session snapshot.
- `POST /session/restore` - `{ "name": "snapshot_name" }` -> restores cookies and local storage.
- `GET /session/list` -> lists available session snapshots.
- `POST /session/delete` - `{ "name": "snapshot_name" }` -> deletes a snapshot.

## MCP Tools

- `save_session`: Save current session cookies and storage state under a named profile.
- `restore_session`: Restore cookies and storage state from a named profile.
- `list_sessions`: List all stored session profiles and cookie counts.
