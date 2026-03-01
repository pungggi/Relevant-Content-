import { describe, expect, it, beforeEach } from 'vitest';
import { IntentTracker } from '../src/core/intent-tracker.js';
import { createHeuristicExpander } from '../src/core/query-expander.js';
import { InMemoryVectorStore } from '../src/vector/in-memory-store.js';
import { createLocalEmbedder } from '../src/utils/embed.js';

describe('IntentTracker — edge cases', () => {
  let store: InMemoryVectorStore;
  let embed: ReturnType<typeof createLocalEmbedder>;
  let tracker: IntentTracker;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embed = createLocalEmbedder(64);
    tracker = new IntentTracker(embed, store, createHeuristicExpander());
  });

  it('recordFeedback with empty arrays does not crash', async () => {
    await tracker.initialise('query');
    tracker.recordFeedback({ usedNodeIds: [], dismissedNodeIds: [] });

    const ctx = tracker.getContext();
    expect(ctx.priorFeedback).toHaveLength(1);
    expect(ctx.priorFeedback[0].usedNodeIds).toEqual([]);
    expect(ctx.priorFeedback[0].dismissedNodeIds).toEqual([]);
  });

  it('computeDriftVectors returns null when feedback references non-existent nodes', async () => {
    await tracker.initialise('some query');

    tracker.recordFeedback({
      usedNodeIds: ['ghost-1', 'ghost-2'],
      dismissedNodeIds: ['ghost-3'],
    });

    // Nodes are not in the vector store — centroid should return null
    const { positiveDrift, negativeDrift } = await tracker.computeDriftVectors();

    expect(positiveDrift).toBeNull();
    expect(negativeDrift).toBeNull();
  });

  it('addNegativeExemplar is idempotent for duplicate IDs', async () => {
    await tracker.initialise('query');
    tracker.addNegativeExemplar('dup-node');
    tracker.addNegativeExemplar('dup-node');
    tracker.addNegativeExemplar('dup-node');

    const ctx = tracker.getContext();
    // It's a Set internally, so duplicates should collapse
    const count = ctx.negativeExemplarIds.filter((id) => id === 'dup-node').length;
    expect(count).toBe(1);
  });

  it('exactly 2 dismissals triggers auto-promotion (threshold is >=2)', async () => {
    await tracker.initialise('query');

    // First dismissal — should NOT promote
    tracker.recordFeedback({ usedNodeIds: [], dismissedNodeIds: ['edge-node'] });
    let ctx = tracker.getContext();
    expect(ctx.negativeExemplarIds).not.toContain('edge-node');

    // Second dismissal — should promote
    tracker.recordFeedback({ usedNodeIds: [], dismissedNodeIds: ['edge-node'] });
    ctx = tracker.getContext();
    expect(ctx.negativeExemplarIds).toContain('edge-node');
  });

  it('computeDriftVectors deduplicates node IDs before fetching vectors', async () => {
    await tracker.initialise('query');

    const vec = await embed('auth handler function');
    await store.upsert('used-1', vec);

    // Same node used across multiple feedback rounds
    tracker.recordFeedback({ usedNodeIds: ['used-1'], dismissedNodeIds: [] });
    tracker.recordFeedback({ usedNodeIds: ['used-1'], dismissedNodeIds: [] });
    tracker.recordFeedback({ usedNodeIds: ['used-1'], dismissedNodeIds: [] });

    const { positiveDrift } = await tracker.computeDriftVectors();

    // Should be exactly the vector itself (centroid of one unique vector)
    expect(positiveDrift).not.toBeNull();
    expect(positiveDrift!.length).toBe(64);
  });

  it('getContext returns defensive copies (mutations do not affect tracker)', async () => {
    await tracker.initialise('fix bug');
    tracker.recordFeedback({ usedNodeIds: ['a'], dismissedNodeIds: [] });

    const ctx1 = tracker.getContext();
    // Mutate the returned context
    ctx1.facets.push({ text: 'injected', weight: 1 });
    ctx1.priorFeedback.push({ usedNodeIds: ['injected'], dismissedNodeIds: [] });
    ctx1.negativeExemplarIds.push('injected');

    // Get a fresh context — should not contain the mutations
    const ctx2 = tracker.getContext();
    expect(ctx2.facets.find((f) => f.text === 'injected')).toBeUndefined();
    expect(ctx2.priorFeedback.length).toBe(1);
    expect(ctx2.negativeExemplarIds).not.toContain('injected');
  });

  it('multiple feedback rounds accumulate correctly', async () => {
    await tracker.initialise('task');

    tracker.recordFeedback({ usedNodeIds: ['a'], dismissedNodeIds: ['x'] });
    tracker.recordFeedback({ usedNodeIds: ['b'], dismissedNodeIds: ['y'] });
    tracker.recordFeedback({ usedNodeIds: ['c'], dismissedNodeIds: ['z'] });

    const ctx = tracker.getContext();
    expect(ctx.priorFeedback).toHaveLength(3);
    expect(ctx.priorFeedback[0].usedNodeIds).toEqual(['a']);
    expect(ctx.priorFeedback[2].dismissedNodeIds).toEqual(['z']);
  });
});
