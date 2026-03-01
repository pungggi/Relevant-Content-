import { describe, expect, it, beforeEach } from 'vitest';
import { SCPMiddleware } from '../src/middleware/interceptor.js';
import { InMemoryVectorStore } from '../src/vector/in-memory-store.js';
import { createLocalEmbedder } from '../src/utils/embed.js';
import type { GraphNode } from '../src/types/index.js';
import { intent } from './helpers.js';

function node(
  id: string,
  name: string,
  deps: string[] = [],
  rawCode?: string,
): GraphNode {
  return {
    id,
    symbolName: name,
    kind: 'function',
    rawCode: rawCode ?? `function ${name}() { /* impl */ }`,
    skeleton: `function ${name}(): void`,
    summary: name,
    dependencies: deps,
  };
}

describe('SCPMiddleware — edge cases', () => {
  let store: InMemoryVectorStore;
  let embed: ReturnType<typeof createLocalEmbedder>;
  let middleware: SCPMiddleware;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embed = createLocalEmbedder(64);
    middleware = new SCPMiddleware(store, embed);
  });

  it('reports 0% token savings when all nodes are kept at full resolution', async () => {
    const vec = await embed('relevant function for search query');
    await store.upsert('a', vec);

    const slice = [node('a', 'relevantFunc')];
    const result = await middleware.intercept(intent('relevant function for search query'), slice);

    // If the single node is kept at full tier, saving should be 0
    if (result.stats.fullCount === 1 && result.stats.prunedCount === 0) {
      expect(result.stats.estimatedTokenSavingPct).toBe(0);
    }
  });

  it('handles a single node slice', async () => {
    const vec = await embed('single node test');
    await store.upsert('only', vec);

    const slice = [node('only', 'onlyFunc')];
    const result = await middleware.intercept(intent('single node test'), slice);

    expect(result.stats.inputNodeCount).toBe(1);
    expect(result.stats.outputNodeCount + result.stats.prunedCount).toBe(1);
  });

  it('stats add up: full + skeleton + pruned = inputNodeCount', async () => {
    for (let i = 0; i < 5; i++) {
      const vec = await embed(`function ${i} handler`);
      await store.upsert(`n-${i}`, vec);
    }

    const slice = Array.from({ length: 5 }, (_, i) =>
      node(`n-${i}`, `func${i}`),
    );

    const result = await middleware.intercept(intent('handler'), slice);

    expect(
      result.stats.fullCount + result.stats.skeletonCount + result.stats.prunedCount,
    ).toBe(result.stats.inputNodeCount);
  });

  it('token savings are between 0 and 100', async () => {
    for (let i = 0; i < 10; i++) {
      const vec = await embed(`token test func ${i}`);
      await store.upsert(`t-${i}`, vec);
    }

    const slice = Array.from({ length: 10 }, (_, i) =>
      node(`t-${i}`, `tokenFunc${i}`, [], `function tokenFunc${i}() { /* long body with lots of content to make tokens significant */ return ${i}; }`),
    );

    const result = await middleware.intercept(intent('token test'), slice);

    expect(result.stats.estimatedTokenSavingPct).toBeGreaterThanOrEqual(0);
    expect(result.stats.estimatedTokenSavingPct).toBeLessThanOrEqual(100);
  });
});
