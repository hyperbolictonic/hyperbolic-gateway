# Cortex Embedding Providers

Cortex stores embeddings for three LanceDB tables — `page_history` (chunks),
`bookmarks`, and `scripts` — and uses them for `recall_memory`, `list_scripts`
(when a `query` is supplied), and bookmark relevance ranking.

Embedding is provided through a small pluggable interface so a real semantic
model can be adopted without rewriting the storage layer.

## The interface

```ts
export interface EmbeddingProvider {
  readonly id: string;    // stable, persisted alongside the vectors, e.g. "hash-128"
  readonly dim: number;   // vector dimension this provider produces
  embed(text: string): Promise<number[]>;
}
```

Selection helpers live in `src/main/cortex/embedder.ts`:

- `registerEmbeddingProvider(provider)` — make a provider selectable by id.
- `setEmbeddingProvider(id)` / `getEmbeddingProvider()` — choose the active one.
- `listEmbeddingProviders()` — ids currently registered.
- `embedText(text)` — embed with the **active** provider (what Cortex uses).

## Default: `hash-128`

The default provider is a deterministic 128-dimensional bag-of-words/trigram hash
embedder with no dependencies and no model download. It captures **lexical**
similarity (shared words/subwords), not learned semantics. It is intentionally
cheap so Cortex works offline and out of the box.

`generateEmbedding()` remains as a synchronous helper bound to the hash provider,
but Cortex itself always calls the async `embedText()` so an alternative provider
takes effect everywhere (history, bookmarks, scripts, and the query side alike).

## Selecting a provider

Set `KUANG_EMBEDDING_PROVIDER` to a registered provider id:

```powershell
# PowerShell
$env:KUANG_EMBEDDING_PROVIDER = "embeddinggemma2-768"
```

Unknown ids are ignored with a warning; the app never fails to start.

## The model-identity guard

Changing the provider changes the **vector space** (dimension *and* semantics).
Vectors from different models are not comparable, so Cortex records the active
provider in `<storageDir>/embedding-provider.json`:

```json
{ "id": "hash-128", "dim": 128, "updatedAt": "2026-10-19T00:00:00.000Z" }
```

When the active provider differs from the recorded one, CortexDB logs a warning
on startup. It does **not** silently mix spaces. Re-embedding existing rows is a
follow-up migration step (see below).

## Adding a real (ONNX) provider

`EmbeddingGemma 2` (Gemma 4 decoder, 740M params) and the earlier
`embeddinggemma-300m` both emit **768-dimensional** vectors, and ONNX builds
exist (e.g. `onnx-community/embeddinggemma-2-ONNX`). Sketch:

```ts
import { registerEmbeddingProvider, type EmbeddingProvider } from './embedder.js';

// Lazily imported so the dependency/model is only paid for when selected.
class GemmaOnnxProvider implements EmbeddingProvider {
  readonly id = 'embeddinggemma2-768';
  readonly dim = 768;
  private session: any;

  async embed(text: string): Promise<number[]> {
    if (!this.session) {
      const ort = await import('onnxruntime-node');
      const modelPath = process.env.KUANG_EMBEDDING_MODEL; // path to model.onnx
      this.session = await ort.InferenceSession.create(modelPath!);
    }
    // Tokenize -> run session -> mean-pool -> L2-normalize -> number[768]
    // (tokenizer + pooling depend on the exported model; use the model card.)
    throw new Error('wire tokenizer + session.run here');
  }
}

registerEmbeddingProvider(new GemmaOnnxProvider());
```

Adopting this means, at minimum:

1. Add `onnxruntime-node` (native dependency) and ship/point at a ~200–300 MB
   model artifact.
2. Accept per-call inference latency (CPU) where the hash provider is ~free.
3. **Migrate** the three Cortex tables from 128-d to the new dimension:
   drop/`createTable` them and re-embed the source text (`page_history.content`,
   `bookmark` title/notes/tags, `script` name/description/code). LanceDB infers
   the vector column from the rows, so a dimension change cannot be applied
   in place.

Until step 3 is done, leave the hash provider as the default.
