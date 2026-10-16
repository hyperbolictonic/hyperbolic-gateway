# Script Vault & Semantic Macro Engine

The **Script Vault** (`src/main/scripts/script-vault.ts`) enables autonomous agents to author, persist, semantically recall, and execute custom JavaScript routines, scrapers, and DOM macros across browser sessions.

## Capabilities

- **Persistent Macro Library**: Automatically mirrors scripts into human-readable `.json` files in `data/scripts/<name>.json`.
- **LanceDB Cortex Semantic Recall**: Every saved script (name, description, tags, domain, and code) is embedded into the LanceDB `scripts` vector table. Agents can find appropriate macros using conversational natural language queries (e.g. *"extract all image URLs"*, *"unroll Reddit comments tree"*, *"flight price cards"*).
- **Safe Dynamic Execution**: Runs scripts inside the active `WebContents` via `runScript(wc, name, args)`. Parameters are cleanly injected via an async closure without polluting the global page namespace.
- **Domain Auto-Matching**: Scripts can specify target domain patterns (e.g. `skyscanner.net`, `reddit.com`, or `*` for universal macros), allowing agents to discover existing domain tools upon navigation.

## HTTP Bridge API

- `POST /scripts/save` - `{ "name": "...", "code": "...", "description": "...", "domain": "...", "tags": [...] }` -> saves & embeds macro.
- `POST /scripts/recall` - `{ "query": "...", "domain": "...", "limit": 10 }` -> vector similarity search for matching scripts.
- `POST /scripts/run` - `{ "name": "...", "args": { ... } }` -> executes script in active tab with runtime arguments.
- `GET /scripts/list` -> lists all registered scripts.
- `POST /scripts/delete` - `{ "name": "..." }` -> purges script from vector store and filesystem.

## MCP Tools

- `save_script`: Saves a reusable JavaScript routine into the persistent vault and vector index.
- `recall_script`: Semantically searches saved scripts using natural language.
- `run_script`: Executes a saved script by name in the active tab with dynamic arguments.
- `list_scripts`: Lists all registered scripts, optionally filtered by domain or tag.
- `delete_script`: Deletes a saved script from the vault.
