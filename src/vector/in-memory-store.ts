import type { VectorClient } from '../types/index.js';

/**
 * A zero-dependency, in-memory vector store backed by a plain Map.
 *
 * Designed for local use alongside SDL-MCP where latency matters more
 * than persistence.  For production at scale, swap in a Chroma / Qdrant /
 * FAISS adapter that satisfies the same VectorClient interface.
 */
export class InMemoryVectorStore implements VectorClient {
  private store = new Map<string, number[]>();

  async upsert(id: string, vector: number[]): Promise<void> {
    this.store.set(id, vector);
  }

  async get(id: string): Promise<number[] | null> {
    return this.store.get(id) ?? null;
  }

  async getBatch(ids: string[]): Promise<(number[] | null)[]> {
    return ids.map((id) => this.store.get(id) ?? null);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  /** Number of vectors currently stored. */
  get size(): number {
    return this.store.size;
  }

  /** Remove all vectors. */
  clear(): void {
    this.store.clear();
  }
}
