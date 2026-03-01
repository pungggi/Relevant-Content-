/**
 * Pure-math helpers for vector similarity.
 * No external dependencies — works with plain number[].
 */

/** Cosine similarity in [-1, 1]. Returns 0 when either vector has zero magnitude. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new RangeError(
      `Vector dimensions must match: got ${a.length} vs ${b.length}`,
    );
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;

  return dot / denom;
}

/**
 * Normalise a cosine similarity value (which may be negative) into [0, 1]
 * so it can be used as a relevance score.
 */
export function normalise(sim: number): number {
  return Math.max(0, Math.min(1, (sim + 1) / 2));
}
