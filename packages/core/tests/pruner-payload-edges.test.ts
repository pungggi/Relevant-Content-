import { describe, expect, it, beforeEach } from 'vitest';
import { SemanticContextPruner } from '../src/core/pruner.js';
import { InMemoryVectorStore } from '../src/vector/in-memory-store.js';
import { createLocalEmbedder } from '../src/utils/embed.js';
import type { GraphNode } from '../src/types/index.js';
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

describe('Pruner — context payload edge cases', () => {
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

  it('boosts nodes matching recentlyChangedFiles via file path', async () => {
    const vec = await embed('some function in a recently changed file');
    await store.upsert('rc-1', vec);

    const slice = [node('rc-1', 'recentFunc', [], { filePath: 'src/recent.ts' })];

    const noRecent = await pruner.optimizeSlice(intent('fix bug'), slice);

    const withRecent = await pruner.optimizeSlice(
      intent('fix bug', {
        contextPayload: { git: { recentlyChangedFiles: ['src/recent.ts'] } },
      }),
      slice,
    );

    expect(withRecent.scored[0].semanticScore).toBeGreaterThanOrEqual(
      noRecent.scored[0].semanticScore,
    );
  });

  it('boosts nodes matching conflict files via file path', async () => {
    const vec = await embed('conflicting module code');
    await store.upsert('conflict-1', vec);

    const slice = [node('conflict-1', 'conflictFunc', [], { filePath: 'src/conflict.ts' })];

    const noConflict = await pruner.optimizeSlice(intent('resolve merge'), slice);

    const withConflict = await pruner.optimizeSlice(
      intent('resolve merge', {
        contextPayload: {
          git: { isMergeConflict: true, conflictFiles: ['src/conflict.ts'] },
        },
      }),
      slice,
    );

    expect(withConflict.scored[0].semanticScore).toBeGreaterThanOrEqual(
      noConflict.scored[0].semanticScore,
    );
  });

  it('dirty files take precedence over recentlyChangedFiles for same path', async () => {
    const vec = await embed('shared file function');
    await store.upsert('shared-1', vec);

    const slice = [node('shared-1', 'sharedFunc', [], { filePath: 'src/shared.ts' })];

    // dirty boost = contextPayloadBoost (2.0), recently changed = contextTabBoost (1.4)
    const dirtyOnly = await pruner.optimizeSlice(
      intent('fix code', {
        contextPayload: {
          git: {
            dirtyFiles: ['src/shared.ts'],
            recentlyChangedFiles: ['src/shared.ts'],
          },
        },
      }),
      slice,
    );

    const recentOnly = await pruner.optimizeSlice(
      intent('fix code', {
        contextPayload: {
          git: { recentlyChangedFiles: ['src/shared.ts'] },
        },
      }),
      slice,
    );

    // Dirty boost (2.0) should produce a higher score than recently changed (1.4)
    expect(dirtyOnly.scored[0].semanticScore).toBeGreaterThanOrEqual(
      recentOnly.scored[0].semanticScore,
    );
  });

  it('injects currentPlanStep as synthetic facet', async () => {
    const vec = await embed('database migration schema upgrade');
    await store.upsert('plan-1', vec);

    const slice = [node('plan-1', 'migrationStep')];

    const noPlan = await pruner.optimizeSlice(intent('run step'), slice);

    const withPlan = await pruner.optimizeSlice(
      intent('run step', {
        contextPayload: {
          agent: { currentPlanStep: 'Apply database schema migration' },
        },
      }),
      slice,
    );

    expect(withPlan.scored[0].semanticScore).toBeGreaterThanOrEqual(
      noPlan.scored[0].semanticScore,
    );
  });

  it('injects issueDescription as synthetic facet', async () => {
    const vec = await embed('OAuth token refresh endpoint');
    await store.upsert('issue-1', vec);

    const slice = [node('issue-1', 'refreshOAuth')];

    const noIssue = await pruner.optimizeSlice(intent('fix the ticket'), slice);

    const withIssue = await pruner.optimizeSlice(
      intent('fix the ticket', {
        contextPayload: {
          external: { issueDescription: 'OAuth refresh tokens expire silently' },
        },
      }),
      slice,
    );

    expect(withIssue.scored[0].semanticScore).toBeGreaterThanOrEqual(
      noIssue.scored[0].semanticScore,
    );
  });

  it('nodes with undefined filePath do not match file-path boosts', async () => {
    const vec = await embed('function without file path');
    await store.upsert('nofp-1', vec);

    // Node has no filePath
    const slice = [node('nofp-1', 'noPathFunc')];

    const withDirty = await pruner.optimizeSlice(
      intent('fix code', {
        contextPayload: {
          git: { dirtyFiles: ['src/other.ts'] },
        },
      }),
      slice,
    );

    const noDirty = await pruner.optimizeSlice(intent('fix code'), slice);

    // Score should be the same — the dirty file boost should not apply
    expect(withDirty.scored[0].semanticScore).toBeCloseTo(
      noDirty.scored[0].semanticScore,
      5,
    );
  });

  it('tab node without a vector gets skeleton threshold floor', async () => {
    // Don't index any vector for this node
    const slice = [node('tab-novec', 'tabNoVec')];

    const { scored } = await pruner.optimizeSlice(
      intent('investigate', {
        contextPayload: { ide: { openTabNodeIds: ['tab-novec'] } },
      }),
      slice,
    );

    // Tab nodes get skeletonThreshold as floor when they have no vector
    expect(scored[0].semanticScore).toBeGreaterThanOrEqual(0.2);
  });

  it('branch name too short after cleanup does not produce synthetic facet', async () => {
    const vec = await embed('some function');
    await store.upsert('short-1', vec);

    const slice = [node('short-1', 'someFunc')];

    // "fix" gets stripped, leaves nothing or <= 2 chars
    const withShortBranch = await pruner.optimizeSlice(
      intent('do work', {
        contextPayload: { git: { branch: 'fix/ab' } },
      }),
      slice,
    );

    const noBranch = await pruner.optimizeSlice(intent('do work'), slice);

    // Scores should be approximately equal (no synthetic facet injected)
    expect(withShortBranch.scored[0].semanticScore).toBeCloseTo(
      noBranch.scored[0].semanticScore,
      3,
    );
  });

  it('handles empty contextPayload gracefully', async () => {
    const vec = await embed('some function');
    await store.upsert('empty-payload', vec);

    const slice = [node('empty-payload', 'someFunc')];

    const { scored } = await pruner.optimizeSlice(
      intent('query', { contextPayload: {} }),
      slice,
    );

    expect(scored[0].semanticScore).toBeGreaterThan(0);
  });

  it('handles contextPayload with all sections empty', async () => {
    const vec = await embed('test function');
    await store.upsert('all-empty', vec);

    const slice = [node('all-empty', 'testFunc')];

    const { scored } = await pruner.optimizeSlice(
      intent('test', {
        contextPayload: { ide: {}, git: {}, agent: {}, external: {} },
      }),
      slice,
    );

    expect(scored[0].semanticScore).toBeGreaterThan(0);
  });
});
