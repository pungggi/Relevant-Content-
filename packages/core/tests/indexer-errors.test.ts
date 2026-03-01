import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SCPIndexer } from '../src/indexer/sync.js';
import type { LedgerReader } from '../src/indexer/sync.js';
import { InMemoryVectorStore } from '../src/vector/in-memory-store.js';
import { createLocalEmbedder } from '../src/utils/embed.js';
import type { LedgerSymbol } from '../src/types/index.js';

function symbol(overrides: Partial<LedgerSymbol> = {}): LedgerSymbol {
  return {
    id: 'sym-1',
    symbolName: 'doStuff',
    kind: 'function',
    signature: 'function doStuff(): void',
    summary: 'Does stuff',
    filePath: 'src/stuff.ts',
    updatedAt: 1000,
    ...overrides,
  };
}

describe('SCPIndexer — error handling', () => {
  let store: InMemoryVectorStore;
  let embed: ReturnType<typeof createLocalEmbedder>;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embed = createLocalEmbedder(64);
  });

  it('propagates errors when embed() throws', async () => {
    const failingEmbed = vi.fn().mockRejectedValue(new Error('Embedding failed'));
    const ledger: LedgerReader = {
      getUpdatedSymbols: async () => [symbol()],
    };

    const indexer = new SCPIndexer(ledger, store, failingEmbed);

    await expect(indexer.sync()).rejects.toThrow('Embedding failed');
  });

  it('propagates errors when vectorDb.upsert() throws', async () => {
    const failingStore = {
      ...store,
      upsert: vi.fn().mockRejectedValue(new Error('DB write failed')),
      get: store.get.bind(store),
      getBatch: store.getBatch.bind(store),
      delete: store.delete.bind(store),
    };

    const ledger: LedgerReader = {
      getUpdatedSymbols: async () => [symbol()],
    };

    const indexer = new SCPIndexer(ledger, failingStore, embed);

    await expect(indexer.sync()).rejects.toThrow('DB write failed');
  });

  it('propagates errors when ledger.getUpdatedSymbols() throws', async () => {
    const failingLedger: LedgerReader = {
      getUpdatedSymbols: async () => {
        throw new Error('Ledger read failed');
      },
    };

    const indexer = new SCPIndexer(failingLedger, store, embed);

    await expect(indexer.sync()).rejects.toThrow('Ledger read failed');
  });

  it('indexes symbols with empty signature and summary fields', async () => {
    const ledger: LedgerReader = {
      getUpdatedSymbols: async () => [
        symbol({ id: 'minimal', signature: '', summary: '' }),
      ],
    };

    const indexer = new SCPIndexer(ledger, store, embed);
    const count = await indexer.sync();

    expect(count).toBe(1);
    const vec = await store.get('minimal');
    expect(vec).not.toBeNull();
    expect(vec!.length).toBe(64);
  });

  it('watermark does not advance when sync fails mid-batch', async () => {
    let callCount = 0;
    const partialFailEmbed = vi.fn().mockImplementation(async (text: string) => {
      callCount++;
      if (callCount > 1) throw new Error('Fail on second symbol');
      return embed(text);
    });

    const ledger: LedgerReader = {
      getUpdatedSymbols: async () => [
        symbol({ id: 's1', updatedAt: 100 }),
        symbol({ id: 's2', updatedAt: 200 }),
      ],
    };

    const indexer = new SCPIndexer(ledger, store, partialFailEmbed);

    await expect(indexer.sync()).rejects.toThrow('Fail on second symbol');

    // The watermark should not have advanced, so a subsequent sync
    // re-fetches from the same point. We can verify by calling sync
    // again with a working embed and checking it tries the same symbols.
    callCount = 0;
    const ledgerSpy = vi.spyOn(ledger, 'getUpdatedSymbols');
    // Reset the embed to succeed
    partialFailEmbed.mockImplementation(async (text: string) => embed(text));

    // The watermark is 0 still (never advanced), so we pass 0
    await indexer.sync();
    expect(ledgerSpy).toHaveBeenCalledWith(0);
  });
});
