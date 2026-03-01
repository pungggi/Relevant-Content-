import type { EmbedFn } from '../types/index.js';

/**
 * Build the text blob that gets embedded for a given symbol.
 *
 * We intentionally embed the **summary + signature** (not raw code) to
 * maximise the embedding model's ability to capture semantic intent and
 * minimise vocabulary mismatch (spec §7 — "Vocabulary Mismatch").
 */
export function buildEmbeddingInput(
  symbolName: string,
  kind: string,
  signature?: string,
  summary?: string,
): string {
  const parts: string[] = [`${kind} ${symbolName}`];
  if (signature) parts.push(signature);
  if (summary) parts.push(summary);
  return parts.join('\n');
}

/**
 * Deterministic, zero-dependency fallback embedder.
 *
 * Uses simple character-level hashing to produce a fixed-dimension vector.
 * NOT suitable for production semantic search — plug in a real embedding
 * model (OpenAI ada-002, Sentence-Transformers, etc.) via the `EmbedFn`
 * contract for real usage.  This exists so the pruner can run and be
 * tested without any external API keys.
 */
export function createLocalEmbedder(dimensions: number = 128): EmbedFn {
  return async (text: string): Promise<number[]> => {
    const vec = new Float64Array(dimensions);

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      // Distribute each character across multiple buckets using primes
      const bucket1 = (code * 31 + i * 7) % dimensions;
      const bucket2 = (code * 53 + i * 13) % dimensions;
      const bucket3 = (code * 97 + i * 19) % dimensions;

      vec[bucket1] += Math.sin(code * 0.1 + i * 0.01);
      vec[bucket2] += Math.cos(code * 0.07 + i * 0.013);
      vec[bucket3] += Math.sin(code * 0.03 + i * 0.017);
    }

    // L2-normalise so cosine similarity is just the dot product
    let mag = 0;
    for (let i = 0; i < dimensions; i++) mag += vec[i] * vec[i];
    mag = Math.sqrt(mag);
    if (mag > 0) {
      for (let i = 0; i < dimensions; i++) vec[i] /= mag;
    }

    return Array.from(vec);
  };
}
