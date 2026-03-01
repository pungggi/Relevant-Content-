import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryVectorStore } from '../src/vector/in-memory-store.js';

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  it('upserts and retrieves a vector', async () => {
    await store.upsert('a', [1, 2, 3]);
    expect(await store.get('a')).toEqual([1, 2, 3]);
  });

  it('returns null for a missing ID', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('overwrites on re-upsert', async () => {
    await store.upsert('a', [1]);
    await store.upsert('a', [2]);
    expect(await store.get('a')).toEqual([2]);
  });

  it('deletes a vector', async () => {
    await store.upsert('a', [1]);
    await store.delete('a');
    expect(await store.get('a')).toBeNull();
  });

  it('getBatch returns vectors in order, null for missing', async () => {
    await store.upsert('a', [1]);
    await store.upsert('c', [3]);
    const result = await store.getBatch(['a', 'b', 'c']);
    expect(result).toEqual([[1], null, [3]]);
  });

  it('tracks size correctly', async () => {
    expect(store.size).toBe(0);
    await store.upsert('a', [1]);
    expect(store.size).toBe(1);
    await store.delete('a');
    expect(store.size).toBe(0);
  });

  it('clear removes everything', async () => {
    await store.upsert('a', [1]);
    await store.upsert('b', [2]);
    store.clear();
    expect(store.size).toBe(0);
  });
});
