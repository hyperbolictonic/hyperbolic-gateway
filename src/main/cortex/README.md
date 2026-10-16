# 🧠 Kuang Grade Mark Eleven — Cortex LanceDB Subsystem (`src/main/cortex/`)

The Cortex subsystem transforms Mark Eleven from an ephemeral session into a persistent knowledge memory. It embeds **LanceDB** locally inside `./data/cortex/`, giving local LLM agents the ability to semantically recall any web page, research article, or bookmarked resource ever visited.

---

## 🏛️ Architecture & Components

```mermaid
flowchart LR
    URL[Web Page HTML] --> HARVEST[Harvester Markdown]
    HARVEST --> CHUNKER[chunker.ts]
    CHUNKER --> EMBEDDER[embedder.ts (128-d)]
    EMBEDDER --> LANCE[(LanceDB: ./data/cortex/)]
    QUERY[Agent Recall Query] --> LANCE
    LANCE --> RANKED[Ranked Snippets + Match Scores]
```

---

## 📄 Source Files

- **[`cortex-db.ts`](./cortex-db.ts)**:
  The primary database service (`CortexDB`). Manages two persistent LanceDB tables:
  - `page_history`: Stores chunked markdown content, titles, URLs, timestamps, dense vectors, and Tantivy BM25 Full-Text Search (FTS) indexes.
  - `bookmarks`: Stores saved research bookmarks with semantic tags, notes, and vector embeddings.
  Provides hybrid recall, distinct temporal history, and bookmark CRUD.
- **[`embedder.ts`](./embedder.ts)**:
  Fast, deterministic 128-dimensional local semantic feature embedder. Generates normalized dense vectors using subword tokenization, hashed trigrams, and TF-IDF positional weights in <1ms without downloading external multi-gigabyte models.
- **[`chunker.ts`](./chunker.ts)**:
  Splits long extracted markdown documents into indexable chunks (~750 chars with overlap) while preserving heading hierarchies and paragraph boundaries.
