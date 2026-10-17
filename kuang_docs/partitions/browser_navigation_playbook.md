# Kuang Grade Mark Eleven: Browser Navigation & Multi-Tab Playbook

## 1. Fast & Speculative Navigation

Mark Eleven features a **0ms Speculative Prerender Engine**:
- While interacting with a search results page or article list, call `prerender_links()`.
- Top candidate URLs are pre-fetched and fully hydrated in background views with host stealth headers.
- When `navigate_to(url)` is later called, the view is elevated instantly in **0ms** without a cold network fetch.
- All pre-rendered content is also automatically distilled and indexed into **LanceDB Cortex** vector memory, making it immediately queryable via `recall_memory(query)`.

## 2. Multi-Tab Orchestration
- `new_tab(url)`: Spawns an isolated tab.
- `switch_tab(tab_id)`: Focuses another tab without destroying state.
- `close_tab(tab_id)`: Frees memory.
- `list_tabs()`: Returns all active tabs and current URLs.

## 3. Session Persistence
- `save_session(name)`: Snapshots cookies, localStorage, and sessionStorage.
- `restore_session(name)`: Rehydrates an authenticated session on demand.
