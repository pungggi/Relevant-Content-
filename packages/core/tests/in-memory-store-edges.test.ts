import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryVectorStore } from '../src/vector/in-memory-store.js';

describe('InMemoryVectorStore — edge cases', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  it('getBatch with empty ID array returns empty array', async () => {
    const result = await store.getBatch([]);
    expect(result).toEqual([]);
  });

  it('getBatch with duplicate IDs returns a result for each occurrence', async () => {
    await store.upsert('a', [1, 2, 3]);
    const result = await store.getBatch(['a', 'a', 'a']);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual([1, 2, 3]);
    expect(result[1]).toEqual([1, 2, 3]);
    expect(result[2]).toEqual([1, 2, 3]);
  });

  it('upsert stores a reference (not a deep copy)', async () => {
    const vec = [1, 2, 3];
    await store.upsert('ref-test', vec);

    // Mutate the original array
    vec[0] = 999;

    // The stored vector is mutated too (reference semantics)
    const stored = await store.get('ref-test');
    expect(stored![0]).toBe(999);
  });

  it('delete on non-existent key does not throw', async () => {
    await expect(store.delete('nonexistent')).resolves.toBeUndefined();
  });

  it('size is 0 after clear', async () => {
    await store.upsert('a', [1]);
    await store.upsert('b', [2]);
    expect(store.size).toBe(2);

    store.clear();
    expect(store.size).toBe(0);

    const result = await store.get('a');
    expect(result).toBeNull();
  });

  it('upsert then delete then get returns null', async () => {
    await store.upsert('temp', [1, 2, 3]);
    await store.delete('temp');
    const result = await store.get('temp');
    expect(result).toBeNull();
    expect(store.size).toBe(0);
  });

  it('handles high-dimensional vectors', async () => {
    const dim = 1536; // typical embedding dimension
    const vec = Array.from({ length: dim }, (_, i) => Math.sin(i));
    await store.upsert('large', vec);

    const stored = await store.get('large');
    expect(stored).not.toBeNull();
    expect(stored!.length).toBe(dim);
    expect(stored![0]).toBeCloseTo(Math.sin(0), 10);
  });
});
