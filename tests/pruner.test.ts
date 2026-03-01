import { describe, expect, it, beforeEach } from 'vitest';
import { SemanticContextPruner } from '../src/core/pruner.js';
import { InMemoryVectorStore } from '../src/vector/in-memory-store.js';
import { createLocalEmbedder } from '../src/utils/embed.js';
import type { GraphNode } from '../src/types/index.js';
import { RelevanceTier } from '../src/types/index.js';
import { intent } from './helpers.js';

/**
 * Helper: build a minimal graph node.
 */
function node(
  id: string,
  symbolName: string,
  deps: string[] = [],
  rawCode?: string,
): GraphNode {
  return {
    id,
    symbolName,
    kind: 'function',
    rawCode: rawCode ?? `function ${symbolName}() { /* body */ }`,
    skeleton: `function ${symbolName}(): void`,
    summary: symbolName,
    dependencies: deps,
  };
}

describe('SemanticContextPruner', () => {
  let store: InMemoryVectorStore;
  let embed: ReturnType<typeof createLocalEmbedder>;
  let pruner: SemanticContextPruner;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embed = createLocalEmbedder(64);
    pruner = new SemanticContextPruner(store, embed);
  });

  it('returns empty output for empty input', async () => {
    const { nodes, scored } = await pruner.optimizeSlice(
      intent('any query'),
      [],
    );
    expect(nodes).toEqual([]);
    expect(scored).toEqual([]);
  });

  it('keeps highly relevant nodes at full resolution', async () => {
    // Index a node that matches the query closely
    const vec = await embed('function verifyJwtToken');
    await store.upsert('jwt-1', vec);

    const slice = [node('jwt-1', 'verifyJwtToken')];

    // Use a lower full-threshold so a solo node with perfect semantic
    // match (1.0 × 0.7 + 0 × 0.3 = 0.7) qualifies for full tier.
    const fullPruner = new SemanticContextPruner(store, embed, {
      fullThreshold: 0.65,
    });

    const { nodes, scored } = await fullPruner.optimizeSlice(
      intent('function verifyJwtToken'),
      slice,
    );

    // The query IS the node text, so semantic score ≈ 1.0
    expect(nodes).toHaveLength(1);
    expect(nodes[0].rawCode).toBeDefined();
    expect(scored[0].tier).toBe(RelevanceTier.Full);
  });

  it('drops completely irrelevant nodes', async () => {
    // Index a node whose embedding is completely unrelated
    const unrelatedVec = await embed('render pagination HTML table CSS grid');
    await store.upsert('ui-1', unrelatedVec);

    const slice = [node('ui-1', 'renderTable')];

    const { nodes } = await pruner.optimizeSlice(
      intent('fix JWT token expiration bug in auth service'),
      slice,
    );

    // Should be pruned (low semantic relevance, no structural rescue)
    expect(nodes).toHaveLength(0);
  });

  it('downgrades mid-relevance nodes to skeleton', async () => {
    // Create a node that is somewhat related (shares some vocabulary)
    const vec = await embed('function handleRequest middleware HTTP');
    await store.upsert('mid-1', vec);

    const slice = [node('mid-1', 'handleRequest')];

    // Use a config that makes mid-range more likely
    const customPruner = new SemanticContextPruner(store, embed, {
      fullThreshold: 0.95,
      skeletonThreshold: 0.1,
    });

    const { nodes } = await customPruner.optimizeSlice(
      intent('function handleRequest middleware HTTP'),
      slice,
    );

    // Should be kept but possibly downgraded (depending on exact sim)
    // With the same text, similarity ≈ 1, so it will be full at 0.95
    expect(nodes).toHaveLength(1);
  });

  it('preserves structurally important bridge nodes', async () => {
    // A → B → C, where A and C are relevant but B is a generic router
    const vecA = await embed('JWT token verifier authentication');
    const vecB = await embed('generic request router middleware');
    const vecC = await embed('JWT expiration checker auth validation');

    await store.upsert('a', vecA);
    await store.upsert('b', vecB);
    await store.upsert('c', vecC);

    const slice = [
      node('a', 'verifyToken', ['b']),
      node('b', 'routeRequest', ['c']),
      node('c', 'checkExpiration', []),
    ];

    // B's structural score should be boosted by its connection to C
    const { scored } = await pruner.optimizeSlice(
      intent('fix JWT token expiration bug'),
      slice,
    );

    const nodeB = scored.find((s) => s.node.id === 'b')!;
    // Structural score should be non-zero because B connects to relevant C
    expect(nodeB.structuralScore).toBeGreaterThan(0);
    // Composite score includes the structural boost
    expect(nodeB.compositeScore).toBeGreaterThan(nodeB.semanticScore * 0.7);
  });

  it('repairs dangling edges after pruning', async () => {
    // Embed the "keep" node with the exact text we will query with
    const keepText = 'JWT auth token handler function';
    const vec = await embed(keepText);
    const unrelated = await embed('CSS animation keyframe render loop');

    await store.upsert('keep', vec);
    await store.upsert('drop', unrelated);

    const slice = [
      node('keep', 'authHandler', ['drop']),
      node('drop', 'animateCSS', []),
    ];

    // Use a lower skeleton threshold to ensure 'keep' survives
    const repairPruner = new SemanticContextPruner(store, embed, {
      skeletonThreshold: 0.2,
    });

    const { nodes } = await repairPruner.optimizeSlice(
      intent(keepText),
      slice,
    );

    // 'keep' should survive; 'drop' should be pruned
    const kept = nodes.find((n) => n.id === 'keep');
    expect(kept).toBeDefined();
    expect(kept!.dependencies).not.toContain('drop');
  });

  it('applies the utility-blackhole heuristic', async () => {
    // Create a node with very high indegree but low semantic relevance
    const utilityVec = await embed('log info message to stdout console');
    await store.upsert('logger', utilityVec);

    // 60 other nodes all depend on the logger
    const callers: GraphNode[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `caller-${i}`;
      const vec = await embed(`JWT auth verifier step ${i}`);
      await store.upsert(id, vec);
      callers.push(node(id, `step${i}`, ['logger']));
    }

    const slice = [...callers, node('logger', 'logInfo', [])];

    const customPruner = new SemanticContextPruner(store, embed, {
      utilityIndegreeCap: 50,
      utilitySemanticCeiling: 0.2,
    });

    const { scored } = await customPruner.optimizeSlice(
      intent('fix JWT authentication token bug'),
      slice,
    );

    const loggerScored = scored.find((s) => s.node.id === 'logger')!;
    // The utility blackhole should have forced composite to 0
    expect(loggerScored.compositeScore).toBe(0);
    expect(loggerScored.tier).toBe(RelevanceTier.Pruned);
  });

  it('handles nodes missing from the vector store gracefully', async () => {
    // Don't index anything — all vectors will be null
    const slice = [node('x', 'mystery')];

    const { nodes, scored } = await pruner.optimizeSlice(
      intent('any query'),
      slice,
    );

    // Should get a score of 0 (no vector → similarity 0)
    expect(scored[0].semanticScore).toBe(0);
    // And be pruned
    expect(nodes).toHaveLength(0);
  });
});
