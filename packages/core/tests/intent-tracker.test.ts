import { describe, expect, it, beforeEach } from 'vitest';
import { IntentTracker } from '../src/core/intent-tracker.js';
import { createHeuristicExpander } from '../src/core/query-expander.js';
import { InMemoryVectorStore } from '../src/vector/in-memory-store.js';
import { createLocalEmbedder } from '../src/utils/embed.js';

describe('IntentTracker', () => {
  let store: InMemoryVectorStore;
  let embed: ReturnType<typeof createLocalEmbedder>;
  let tracker: IntentTracker;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embed = createLocalEmbedder(64);
    tracker = new IntentTracker(embed, store, createHeuristicExpander());
  });

  it('initialises with facets decomposed from the query', async () => {
    await tracker.initialise('fix the JWT token expiration bug');
    const ctx = tracker.getContext();

    expect(ctx.query).toBe('fix the JWT token expiration bug');
    expect(ctx.facets.length).toBeGreaterThanOrEqual(1);
    expect(ctx.facets[0].weight).toBe(1.0);
    expect(ctx.priorFeedback).toEqual([]);
    expect(ctx.negativeExemplarIds).toEqual([]);
  });

  it('records feedback and accumulates rounds', async () => {
    await tracker.initialise('fix the bug');

    tracker.recordFeedback({
      usedNodeIds: ['a', 'b'],
      dismissedNodeIds: ['c'],
    });

    const ctx = tracker.getContext();
    expect(ctx.priorFeedback).toHaveLength(1);
    expect(ctx.priorFeedback[0].usedNodeIds).toEqual(['a', 'b']);
    expect(ctx.priorFeedback[0].dismissedNodeIds).toEqual(['c']);
  });

  it('auto-promotes nodes dismissed 2+ times to negative exemplars', async () => {
    await tracker.initialise('fix the bug');

    tracker.recordFeedback({
      usedNodeIds: [],
      dismissedNodeIds: ['legacy-1'],
    });
    tracker.recordFeedback({
      usedNodeIds: [],
      dismissedNodeIds: ['legacy-1'],
    });

    const ctx = tracker.getContext();
    expect(ctx.negativeExemplarIds).toContain('legacy-1');
  });

  it('allows manual negative exemplar addition', async () => {
    await tracker.initialise('query');
    tracker.addNegativeExemplar('bad-node');

    const ctx = tracker.getContext();
    expect(ctx.negativeExemplarIds).toContain('bad-node');
  });

  it('allows adding facets mid-task', async () => {
    await tracker.initialise('fix the bug');
    tracker.addFacet({ text: 'Redis caching layer', weight: 0.9 });

    const ctx = tracker.getContext();
    const redisFacet = ctx.facets.find((f) => f.text === 'Redis caching layer');
    expect(redisFacet).toBeDefined();
    expect(redisFacet!.weight).toBe(0.9);
  });

  it('computes drift vectors from feedback', async () => {
    await tracker.initialise('fix the bug');

    // Seed some vectors so centroid computation works.
    const vecA = await embed('auth token handler');
    const vecB = await embed('logging utility');
    await store.upsert('used-1', vecA);
    await store.upsert('dismissed-1', vecB);

    tracker.recordFeedback({
      usedNodeIds: ['used-1'],
      dismissedNodeIds: ['dismissed-1'],
    });

    const { positiveDrift, negativeDrift } =
      await tracker.computeDriftVectors();

    expect(positiveDrift).not.toBeNull();
    expect(positiveDrift!.length).toBe(64);
    expect(negativeDrift).not.toBeNull();
    expect(negativeDrift!.length).toBe(64);
  });

  it('returns null drift vectors when no feedback exists', async () => {
    await tracker.initialise('fix the bug');

    const { positiveDrift, negativeDrift } =
      await tracker.computeDriftVectors();

    expect(positiveDrift).toBeNull();
    expect(negativeDrift).toBeNull();
  });

  it('resets state on re-initialise', async () => {
    await tracker.initialise('first task');
    tracker.recordFeedback({ usedNodeIds: ['a'], dismissedNodeIds: [] });
    tracker.addNegativeExemplar('bad');

    await tracker.initialise('second task');
    const ctx = tracker.getContext();

    expect(ctx.query).toBe('second task');
    expect(ctx.priorFeedback).toEqual([]);
    expect(ctx.negativeExemplarIds).toEqual([]);
  });
});
