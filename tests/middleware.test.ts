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

describe('SCPMiddleware', () => {
  let store: InMemoryVectorStore;
  let embed: ReturnType<typeof createLocalEmbedder>;
  let middleware: SCPMiddleware;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embed = createLocalEmbedder(64);
    middleware = new SCPMiddleware(store, embed);
  });

  it('returns stats with correct counts', async () => {
    const relatedVec = await embed('JWT auth token verification');
    const unrelatedVec = await embed('CSS grid layout flexbox responsive');

    await store.upsert('auth', relatedVec);
    await store.upsert('css', unrelatedVec);

    const slice = [
      node('auth', 'verifyToken', [], 'function verifyToken() { checkJWT(); }'),
      node('css', 'applyGrid', [], 'function applyGrid() { setCSSGrid(); }'),
    ];

    const result = await middleware.intercept(
      intent('fix JWT auth bug'),
      slice,
    );

    expect(result.stats.inputNodeCount).toBe(2);
    // At least one should be kept or pruned
    expect(result.stats.outputNodeCount + result.stats.prunedCount).toBe(2);
    expect(result.stats.estimatedTokenSavingPct).toBeGreaterThanOrEqual(0);
  });

  it('optimisedSlice contains only non-pruned nodes', async () => {
    const vec = await embed('database connection pool handler');
    await store.upsert('db', vec);

    const slice = [node('db', 'getConnection')];
    const result = await middleware.intercept(
      intent('database connection pool'),
      slice,
    );

    // Every node in optimisedSlice should exist in scored
    for (const n of result.optimisedSlice) {
      expect(result.scored.some((s) => s.node.id === n.id)).toBe(true);
    }
  });

  it('handles empty slices gracefully', async () => {
    const result = await middleware.intercept(intent('anything'), []);

    expect(result.optimisedSlice).toEqual([]);
    expect(result.stats.inputNodeCount).toBe(0);
    expect(result.stats.outputNodeCount).toBe(0);
    expect(result.stats.estimatedTokenSavingPct).toBe(0);
  });
});
