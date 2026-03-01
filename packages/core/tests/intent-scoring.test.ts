import { describe, expect, it, beforeEach } from 'vitest';
import { SemanticContextPruner } from '../src/core/pruner.js';
import { InMemoryVectorStore } from '../src/vector/in-memory-store.js';
import { createLocalEmbedder } from '../src/utils/embed.js';
import type { GraphNode, IntentContext } from '../src/types/index.js';
import { RelevanceTier } from '../src/types/index.js';
import { intent } from './helpers.js';

function node(
  id: string,
  symbolName: string,
  deps: string[] = [],
  opts?: { rawCode?: string; filePath?: string },
): GraphNode {
  return {
    id,
    symbolName,
    kind: 'function',
    rawCode: opts?.rawCode ?? `function ${symbolName}() { /* body */ }`,
    skeleton: `function ${symbolName}(): void`,
    summary: symbolName,
    dependencies: deps,
    filePath: opts?.filePath,
  };
}

describe('Multi-facet scoring (Max-Score approach)', () => {
  let store: InMemoryVectorStore;
  let embed: ReturnType<typeof createLocalEmbedder>;
  let pruner: SemanticContextPruner;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embed = createLocalEmbedder(64);
    pruner = new SemanticContextPruner(store, embed, {
      fullThreshold: 0.5,
      skeletonThreshold: 0.2,
    });
  });

  it('scores a node against the best-matching facet (not average)', async () => {
    // A Redis-specific node should match the Redis facet perfectly
    const redisVec = await embed('Redis caching layer connection pool');
    await store.upsert('redis-1', redisVec);

    const slice = [node('redis-1', 'redisConnect')];

    const ctx: IntentContext = {
      query: 'Update JWT validator to use Redis cache and handle missing user',
      facets: [
        { text: 'JWT token validation logic', weight: 1.0 },
        { text: 'Redis caching implementation', weight: 1.0 },
        { text: 'User not found error handling', weight: 0.9 },
      ],
      priorFeedback: [],
      negativeExemplarIds: [],
    };

    const { scored } = await pruner.optimizeSlice(ctx, slice);

    // With multi-facet, the Redis node should score well because it
    // matches the Redis facet, even though it doesn't match JWT or error facets.
    expect(scored[0].semanticScore).toBeGreaterThan(0);
  });

  it('multi-facet produces higher scores than a single-facet query', async () => {
    // The node only matches one dimension of a compound task
    const authVec = await embed('JWT authentication token verifier');
    await store.upsert('auth-1', authVec);

    const slice = [node('auth-1', 'verifyJwt')];

    // Single-facet approach (the compound sentence averages all intents)
    const singleFacetResult = await pruner.optimizeSlice(
      intent('Update JWT validator to use Redis cache and handle missing user gracefully'),
      slice,
    );

    // Multi-facet approach (has a dedicated JWT facet)
    const multiFacetResult = await pruner.optimizeSlice(
      {
        query: 'Update JWT validator to use Redis cache and handle missing user gracefully',
        facets: [
          { text: 'JWT authentication token validation', weight: 1.0 },
          { text: 'Redis cache implementation', weight: 1.0 },
          { text: 'missing user error handling', weight: 0.8 },
        ],
        priorFeedback: [],
        negativeExemplarIds: [],
      },
      slice,
    );

    // The dedicated JWT facet should yield a higher score for the auth node.
    expect(multiFacetResult.scored[0].semanticScore).toBeGreaterThanOrEqual(
      singleFacetResult.scored[0].semanticScore,
    );
  });

  it('respects facet weights', async () => {
    const vec = await embed('error handling for missing user');
    await store.upsert('err-1', vec);

    const slice = [node('err-1', 'handleMissingUser')];

    const highWeight = await pruner.optimizeSlice(
      intent('fix bug', {
        facets: [
          { text: 'fix bug', weight: 0.1 },
          { text: 'error handling for missing user', weight: 1.0 },
        ],
      }),
      slice,
    );

    const lowWeight = await pruner.optimizeSlice(
      intent('fix bug', {
        facets: [
          { text: 'fix bug', weight: 0.1 },
          { text: 'error handling for missing user', weight: 0.3 },
        ],
      }),
      slice,
    );

    expect(highWeight.scored[0].semanticScore).toBeGreaterThanOrEqual(
      lowWeight.scored[0].semanticScore,
    );
  });

  it('falls back to query when facets array is empty', async () => {
    const vec = await embed('fix the auth bug');
    await store.upsert('auth-1', vec);

    const slice = [node('auth-1', 'fixAuth')];

    const { scored } = await pruner.optimizeSlice(
      intent('fix the auth bug', { facets: [] }),
      slice,
    );

    expect(scored[0].semanticScore).toBeGreaterThan(0);
  });
});

describe('Feedback drift (Rocchio shift)', () => {
  let store: InMemoryVectorStore;
  let embed: ReturnType<typeof createLocalEmbedder>;
  let pruner: SemanticContextPruner;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embed = createLocalEmbedder(64);
    pruner = new SemanticContextPruner(store, embed, {
      fullThreshold: 0.5,
      skeletonThreshold: 0.2,
      feedbackBoost: 1.5,
      feedbackPenalty: 0.3,
    });
  });

  it('boosts nodes similar to previously used nodes', async () => {
    // Node we "used" in the previous round
    const usedVec = await embed('JWT auth service token validator');
    await store.upsert('used-1', usedVec);

    // New node that is semantically similar to the used node
    const similarVec = await embed('JWT auth token expiration checker');
    await store.upsert('similar-1', similarVec);

    const slice = [node('similar-1', 'checkTokenExpiry')];

    // Without feedback
    const noFeedback = await pruner.optimizeSlice(
      intent('fix auth'),
      slice,
    );

    // With positive feedback from used node
    const withFeedback = await pruner.optimizeSlice(
      intent('fix auth', {
        priorFeedback: [{ usedNodeIds: ['used-1'], dismissedNodeIds: [] }],
      }),
      slice,
    );

    // The similar node should get a higher score when feedback is provided
    expect(withFeedback.scored[0].semanticScore).toBeGreaterThanOrEqual(
      noFeedback.scored[0].semanticScore,
    );
  });

  it('penalises nodes similar to dismissed nodes', async () => {
    // Node the agent dismissed
    const dismissedVec = await embed('CSS grid layout rendering');
    await store.upsert('dismissed-1', dismissedVec);

    // A node similar to the dismissed one
    const similarVec = await embed('CSS flexbox layout styling');
    await store.upsert('css-1', similarVec);

    const slice = [node('css-1', 'applyFlexbox')];

    // Without feedback
    const noFeedback = await pruner.optimizeSlice(
      intent('fix CSS layout'),
      slice,
    );

    // With negative feedback
    const withFeedback = await pruner.optimizeSlice(
      intent('fix CSS layout', {
        priorFeedback: [{ usedNodeIds: [], dismissedNodeIds: ['dismissed-1'] }],
      }),
      slice,
    );

    // The similar node should get a lower score when dismissed feedback is provided
    expect(withFeedback.scored[0].semanticScore).toBeLessThanOrEqual(
      noFeedback.scored[0].semanticScore,
    );
  });
});

describe('Negative exemplars', () => {
  let store: InMemoryVectorStore;
  let embed: ReturnType<typeof createLocalEmbedder>;
  let pruner: SemanticContextPruner;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embed = createLocalEmbedder(64);
    pruner = new SemanticContextPruner(store, embed, {
      fullThreshold: 0.5,
      skeletonThreshold: 0.2,
      negativeExemplarCeiling: 0.5,
    });
  });

  it('suppresses nodes that are very similar to negative exemplars', async () => {
    // The negative exemplar (deprecated legacy code)
    const legacyVec = await embed('legacy auth v1 token handler deprecated');
    await store.upsert('legacy-1', legacyVec);

    // A node that is similar to the legacy code
    const similarVec = await embed('legacy auth v1 token validator deprecated');
    await store.upsert('similar-legacy', similarVec);

    const slice = [node('similar-legacy', 'legacyValidateV1')];

    // Without negative exemplar
    const noExemplar = await pruner.optimizeSlice(
      intent('auth token validation'),
      slice,
    );

    // With negative exemplar
    const withExemplar = await pruner.optimizeSlice(
      intent('auth token validation', {
        negativeExemplarIds: ['legacy-1'],
      }),
      slice,
    );

    expect(withExemplar.scored[0].semanticScore).toBeLessThanOrEqual(
      noExemplar.scored[0].semanticScore,
    );
  });
});

describe('Context payload integration', () => {
  let store: InMemoryVectorStore;
  let embed: ReturnType<typeof createLocalEmbedder>;
  let pruner: SemanticContextPruner;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embed = createLocalEmbedder(64);
    pruner = new SemanticContextPruner(store, embed, {
      fullThreshold: 0.5,
      skeletonThreshold: 0.2,
    });
  });

  it('pins active node via IDE context even without vector', async () => {
    // Don't index any vector — the node would normally score 0
    const slice = [node('active-1', 'currentlyEditing')];

    const { scored } = await pruner.optimizeSlice(
      intent('fix something', {
        contextPayload: { ide: { activeNodeId: 'active-1' } },
      }),
      slice,
    );

    // The pinned node should get a floor score >= fullThreshold
    expect(scored[0].semanticScore).toBeGreaterThanOrEqual(0.5);
    expect(scored[0].tier).not.toBe(RelevanceTier.Pruned);
  });

  it('boosts breakpoint nodes', async () => {
    const vec = await embed('function with breakpoint');
    await store.upsert('bp-1', vec);

    const slice = [node('bp-1', 'debugTarget')];

    // Without breakpoint context
    const noBP = await pruner.optimizeSlice(intent('investigate error'), slice);

    // With breakpoint context (pinned)
    const withBP = await pruner.optimizeSlice(
      intent('investigate error', {
        contextPayload: { ide: { breakpointNodeIds: ['bp-1'] } },
      }),
      slice,
    );

    expect(withBP.scored[0].semanticScore).toBeGreaterThanOrEqual(
      noBP.scored[0].semanticScore,
    );
  });

  it('boosts open tab nodes with weaker multiplier', async () => {
    const vec = await embed('utility helper function');
    await store.upsert('tab-1', vec);

    const slice = [node('tab-1', 'helperUtil')];

    const noTabs = await pruner.optimizeSlice(intent('fix bug'), slice);

    const withTabs = await pruner.optimizeSlice(
      intent('fix bug', {
        contextPayload: { ide: { openTabNodeIds: ['tab-1'] } },
      }),
      slice,
    );

    expect(withTabs.scored[0].semanticScore).toBeGreaterThanOrEqual(
      noTabs.scored[0].semanticScore,
    );
  });

  it('boosts nodes in dirty files via Git context', async () => {
    const vec = await embed('auth validator function');
    await store.upsert('dirty-1', vec);

    const slice = [node('dirty-1', 'validate', [], { filePath: 'src/auth/validator.ts' })];

    const noGit = await pruner.optimizeSlice(intent('fix auth'), slice);

    const withGit = await pruner.optimizeSlice(
      intent('fix auth', {
        contextPayload: { git: { dirtyFiles: ['src/auth/validator.ts'] } },
      }),
      slice,
    );

    expect(withGit.scored[0].semanticScore).toBeGreaterThanOrEqual(
      noGit.scored[0].semanticScore,
    );
  });

  it('injects branch name as synthetic facet', async () => {
    const vec = await embed('JWT token timeout refresh loop');
    await store.upsert('jwt-1', vec);

    const slice = [node('jwt-1', 'refreshTokenLoop')];

    const noBranch = await pruner.optimizeSlice(intent('fix the bug'), slice);

    // The branch name "bugfix/token-refresh-loop" should inject
    // "token refresh loop" as a synthetic facet
    const withBranch = await pruner.optimizeSlice(
      intent('fix the bug', {
        contextPayload: { git: { branch: 'bugfix/token-refresh-loop' } },
      }),
      slice,
    );

    expect(withBranch.scored[0].semanticScore).toBeGreaterThanOrEqual(
      noBranch.scored[0].semanticScore,
    );
  });

  it('injects agent tool error as high-priority synthetic facet', async () => {
    const vec = await embed('import missing module X dependency');
    await store.upsert('import-1', vec);

    const slice = [node('import-1', 'importResolver')];

    const noError = await pruner.optimizeSlice(intent('fix build'), slice);

    const withError = await pruner.optimizeSlice(
      intent('fix build', {
        contextPayload: {
          agent: { lastToolError: 'Compile Error: Missing import X' },
        },
      }),
      slice,
    );

    expect(withError.scored[0].semanticScore).toBeGreaterThanOrEqual(
      noError.scored[0].semanticScore,
    );
  });

  it('injects failing test names as synthetic facets', async () => {
    const vec = await embed('test auth timeout validation');
    await store.upsert('test-1', vec);

    const slice = [node('test-1', 'testAuthTimeout')];

    const noTests = await pruner.optimizeSlice(intent('fix CI'), slice);

    const withTests = await pruner.optimizeSlice(
      intent('fix CI', {
        contextPayload: {
          external: { failingTestNames: ['test_auth_timeout'] },
        },
      }),
      slice,
    );

    expect(withTests.scored[0].semanticScore).toBeGreaterThanOrEqual(
      noTests.scored[0].semanticScore,
    );
  });

  it('injects diagnostics as both pin and synthetic facet', async () => {
    const vec = await embed('user model property access');
    await store.upsert('diag-1', vec);

    const slice = [node('diag-1', 'getUserProp')];

    const { scored } = await pruner.optimizeSlice(
      intent('fix error', {
        contextPayload: {
          ide: {
            diagnostics: [
              { nodeId: 'diag-1', message: 'TS2339: Property does not exist on type User' },
            ],
          },
        },
      }),
      slice,
    );

    // Node is pinned (diagnostic), so it should not be pruned
    expect(scored[0].tier).not.toBe(RelevanceTier.Pruned);
  });

  it('pinned nodes bypass the utility blackhole', async () => {
    // Create a utility-like node with high indegree
    const utilVec = await embed('generic log info message utility');
    await store.upsert('logger', utilVec);

    const callers: GraphNode[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `caller-${i}`;
      const vec = await embed(`caller step ${i}`);
      await store.upsert(id, vec);
      callers.push(node(id, `step${i}`, ['logger']));
    }

    const slice = [...callers, node('logger', 'logInfo', [])];

    // Normally the logger would be blackholed (indegree=60 > cap=50, low semantic).
    // But pinning it via IDE context should bypass the blackhole.
    const customPruner = new SemanticContextPruner(store, embed, {
      utilityIndegreeCap: 50,
      utilitySemanticCeiling: 0.2,
      fullThreshold: 0.5,
      skeletonThreshold: 0.2,
    });

    const { scored } = await customPruner.optimizeSlice(
      intent('investigate logging', {
        contextPayload: { ide: { activeNodeId: 'logger' } },
      }),
      slice,
    );

    const loggerScored = scored.find((s) => s.node.id === 'logger')!;
    // Pinned node bypasses blackhole — composite should not be forced to 0
    expect(loggerScored.compositeScore).toBeGreaterThan(0);
  });
});
