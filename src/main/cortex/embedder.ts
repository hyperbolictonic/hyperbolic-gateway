/**
 * Kuang Grade Mark Eleven - Cortex Embedding Provider
 *
 * Embeddings back semantic recall/ranking inside LanceDB. Providers are
 * pluggable: the default `hash-128` provider is a deterministic, zero-dependency
 * 128-dimensional bag-of-words/trigram hash embedder (lexical similarity with
 * no model download). A real semantic model (e.g. EmbeddingGemma-2 via ONNX)
 * can be registered under its own id and selected at runtime.
 *
 * Because a provider defines the vector *space* (dimension and semantics), the
 * active provider id/dimension is persisted by CortexDB so vectors produced by
 * one model are never silently compared against vectors produced by another.
 * See docs/EMBEDDING_PROVIDERS.md for wiring a real provider.
 */

export interface EmbeddingProvider {
  /** Stable identifier, persisted alongside the vectors (e.g. "hash-128"). */
  readonly id: string;
  /** Vector dimension this provider produces. */
  readonly dim: number;
  /** Produce an embedding for `text`. May be async (e.g. ONNX inference). */
  embed(text: string): Promise<number[]>;
}

export const DEFAULT_PROVIDER_ID = 'hash-128';

/** Legacy dimension constant for the default provider (kept for compatibility). */
export const EMBEDDING_DIM = 128;

/**
 * Deterministic 128-d embedding from subword hashing, character trigrams, and
 * log-frequency weighting. L2-normalized, so cosine similarity is a dot product.
 * This is a lexical similarity signal, not a learned semantic one.
 */
function hashEmbed(text: string): number[] {
  const vector = new Float32Array(EMBEDDING_DIM);
  if (!text || text.trim().length === 0) {
    return Array.from(vector);
  }

  const normalized = text.toLowerCase().replace(/[^\w\s-]/g, ' ');
  const words = normalized.split(/\s+/).filter(w => w.length > 1);

  if (words.length === 0) {
    return Array.from(vector);
  }

  // Word & n-gram frequency hashing
  const termCounts = new Map<string, number>();
  for (const word of words) {
    termCounts.set(word, (termCounts.get(word) || 0) + 1);

    // Extract character trigrams for subword semantic matching
    if (word.length >= 3) {
      for (let i = 0; i <= word.length - 3; i++) {
        const trigram = word.substring(i, i + 3);
        termCounts.set(trigram, (termCounts.get(trigram) || 0) + 0.5);
      }
    }
  }

  // Map tokens into the 128-dimensional embedding space
  for (const [term, count] of termCounts.entries()) {
    const hash = hashString(term);
    const index1 = Math.abs(hash) % EMBEDDING_DIM;
    const index2 = Math.abs(hash >> 7) % EMBEDDING_DIM;
    const sign = (hash & 1) === 0 ? 1 : -1;

    // Weight by log frequency
    const weight = Math.log(1 + count);
    vector[index1] += sign * weight;
    vector[index2] += -sign * (weight * 0.5);
  }

  // L2 normalization
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vector[i] /= norm;
    }
  }

  return Array.from(vector);
}

function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash;
}

class HashEmbeddingProvider implements EmbeddingProvider {
  readonly id = DEFAULT_PROVIDER_ID;
  readonly dim = EMBEDDING_DIM;
  async embed(text: string): Promise<number[]> {
    return hashEmbed(text);
  }
}

const registry = new Map<string, EmbeddingProvider>();
registry.set(DEFAULT_PROVIDER_ID, new HashEmbeddingProvider());

let activeProviderId = DEFAULT_PROVIDER_ID;

/** Register (or replace) a provider so it can be selected by id. */
export function registerEmbeddingProvider(provider: EmbeddingProvider): void {
  if (!provider.id || !Number.isInteger(provider.dim) || provider.dim <= 0) {
    throw new Error('EmbeddingProvider requires a non-empty id and a positive integer dim.');
  }
  registry.set(provider.id, provider);
}

/** Ids of every registered provider. */
export function listEmbeddingProviders(): string[] {
  return [...registry.keys()];
}

/** Select the active provider by id. Throws when the id is unknown. */
export function setEmbeddingProvider(id: string): void {
  if (!registry.has(id)) {
    throw new Error(`Unknown embedding provider "${id}". Available: ${listEmbeddingProviders().join(', ')}`);
  }
  activeProviderId = id;
}

/** The provider used for all new embeddings. */
export function getEmbeddingProvider(): EmbeddingProvider {
  const provider = registry.get(activeProviderId);
  if (!provider) {
    throw new Error(`Active embedding provider "${activeProviderId}" is not registered.`);
  }
  return provider;
}

/** Embed `text` with the active provider. */
export function embedText(text: string): Promise<number[]> {
  return getEmbeddingProvider().embed(text);
}

/**
 * @deprecated Synchronous embedding via the default hash provider only. Use
 * `embedText` (active provider) for anything that must match stored vectors.
 */
export function generateEmbedding(text: string): number[] {
  return hashEmbed(text);
}
