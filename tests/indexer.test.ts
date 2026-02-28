import { describe, expect, it, beforeEach } from 'vitest';
import { SCPIndexer } from '../src/indexer/sync.js';
import type { LedgerReader } from '../src/indexer/sync.js';
import { InMemoryVectorStore } from '../src/vector/in-memory-store.js';
import { createLocalEmbedder } from '../src/utils/embed.js';
import type { LedgerSymbol } from '../src/types/index.js';

function makeLedgerSymbol(
  id: string,
  name: string,
  updatedAt: number,
): LedgerSymbol {
  return {
    id,
    symbolName: name,
    kind: 'function',
    signature: `function ${name}(): void`,
    summary: `Does ${name} things`,
    filePath: `src/${name}.ts`,
    updatedAt,
  };
}

describe('SCPIndexer', () => {
  let store: InMemoryVectorStore;
  let embed: ReturnType<typeof createLocalEmbedder>;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embed = createLocalEmbedder(64);
  });

  it('indexes new symbols and stores their vectors', async () => {
    const symbols: LedgerSymbol[] = [
      makeLedgerSymbol('a', 'authenticate', 1000),
      makeLedgerSymbol('b', 'authorize', 2000),
    ];

    const ledger: LedgerReader = {
      getUpdatedSymbols: async () => symbols,
    };

    const indexer = new SCPIndexer(ledger, store, embed);
    const count = await indexer.sync();

    expect(count).toBe(2);
    expect(await store.get('a')).not.toBeNull();
    expect(await store.get('b')).not.toBeNull();
    expect((await store.get('a'))!).toHaveLength(64);
  });

  it('advances the watermark so re-sync skips old symbols', async () => {
    let callCount = 0;
    const ledger: LedgerReader = {
      getUpdatedSymbols: async (sinceMs) => {
        callCount++;
        if (callCount === 1) {
          return [makeLedgerSymbol('a', 'first', 1000)];
        }
        // Second call: only symbols after watermark 1000
        if (sinceMs >= 1000) return [];
        return [makeLedgerSymbol('a', 'first', 1000)];
      },
    };

    const indexer = new SCPIndexer(ledger, store, embed);
    await indexer.sync();
    const secondCount = await indexer.sync();

    expect(secondCount).toBe(0);
  });

  it('resetWatermark causes full re-index', async () => {
    let callCount = 0;
    const symbols = [makeLedgerSymbol('a', 'first', 1000)];

    const ledger: LedgerReader = {
      getUpdatedSymbols: async (sinceMs) => {
        callCount++;
        if (sinceMs === 0) return symbols;
        return [];
      },
    };

    const indexer = new SCPIndexer(ledger, store, embed);
    await indexer.sync(); // call 1: sinceMs=0 → returns symbols, watermark → 1000
    indexer.resetWatermark(); // watermark → 0
    await indexer.sync(); // call 2: sinceMs=0 → returns symbols again

    expect(callCount).toBe(2);
  });

  it('returns 0 when ledger has no updates', async () => {
    const ledger: LedgerReader = {
      getUpdatedSymbols: async () => [],
    };

    const indexer = new SCPIndexer(ledger, store, embed);
    const count = await indexer.sync();

    expect(count).toBe(0);
    expect(store.size).toBe(0);
  });
});
