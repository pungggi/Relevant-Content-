import type {
  EmbedFn,
  IntentContext,
  IntentFacet,
  RoundFeedback,
  VectorClient,
} from '../types/index.js';
import type { ExpandFn } from './query-expander.js';

/**
 * IntentTracker — stateful session-level object that evolves the
 * agent's understanding of intent across multiple pruning rounds.
 *
 * Lifecycle:
 *   1. Agent receives a user prompt → `tracker.initialise(prompt)`
 *   2. SCP prunes a slice using `tracker.getContext()`
 *   3. Agent reads some nodes, dismisses others
 *   4. Agent calls `tracker.recordFeedback(...)` with used/dismissed IDs
 *   5. On the next slice request, `tracker.getContext()` returns an
 *      updated IntentContext with refined facets and feedback history.
 *
 * The tracker also supports:
 *   - `addNegativeExemplar(id)` for hard "never show me this" signals.
 *   - `addFacet(facet)` if the agent discovers a new sub-intent mid-task.
 */
export class IntentTracker {
  private query = '';
  private facets: IntentFacet[] = [];
  private feedback: RoundFeedback[] = [];
  private negativeExemplars: Set<string> = new Set();

  private readonly embed: EmbedFn;
  private readonly vectorDb: VectorClient;
  private readonly expand: ExpandFn;

  constructor(embed: EmbedFn, vectorDb: VectorClient, expand: ExpandFn) {
    this.embed = embed;
    this.vectorDb = vectorDb;
    this.expand = expand;
  }

  /**
   * Bootstrap the tracker with the user's original prompt.
   * Automatically decomposes it into facets via the expander.
   */
  async initialise(query: string): Promise<void> {
    this.query = query;
    this.facets = await this.expand(query);
    this.feedback = [];
    this.negativeExemplars.clear();
  }

  /** Return the current intent context for the next pruning round. */
  getContext(): IntentContext {
    return {
      query: this.query,
      facets: [...this.facets],
      priorFeedback: [...this.feedback],
      negativeExemplarIds: [...this.negativeExemplars],
    };
  }

  /**
   * Record which nodes the agent used or dismissed after reading a
   * pruned slice.  This feeds into the next round's scoring.
   */
  recordFeedback(fb: RoundFeedback): void {
    this.feedback.push(fb);

    // Auto-promote dismissed nodes to negative exemplars if they've
    // been dismissed in 2+ consecutive rounds.
    for (const id of fb.dismissedNodeIds) {
      const dismissCount = this.feedback.filter((f) =>
        f.dismissedNodeIds.includes(id),
      ).length;
      if (dismissCount >= 2) {
        this.negativeExemplars.add(id);
      }
    }
  }

  /** Manually mark a node as a negative exemplar. */
  addNegativeExemplar(nodeId: string): void {
    this.negativeExemplars.add(nodeId);
  }

  /** Add a new facet discovered mid-task. */
  addFacet(facet: IntentFacet): void {
    this.facets.push(facet);
  }

  /**
   * Synthesise a set of "drift vectors" from feedback.
   *
   * Returns the centroid of all used-node vectors (positive drift)
   * and the centroid of all dismissed-node vectors (negative drift).
   * The pruner uses these to warp the scoring space.
   */
  async computeDriftVectors(): Promise<{
    positiveDrift: number[] | null;
    negativeDrift: number[] | null;
  }> {
    const allUsed = this.feedback.flatMap((f) => f.usedNodeIds);
    const allDismissed = [
      ...this.feedback.flatMap((f) => f.dismissedNodeIds),
      ...this.negativeExemplars,
    ];

    const positiveDrift = await this.centroid(allUsed);
    const negativeDrift = await this.centroid(allDismissed);

    return { positiveDrift, negativeDrift };
  }

  /** Average the vectors for a set of node IDs. Returns null if none found. */
  private async centroid(ids: string[]): Promise<number[] | null> {
    if (ids.length === 0) return null;

    const unique = [...new Set(ids)];
    const vectors = await this.vectorDb.getBatch(unique);
    const valid = vectors.filter((v): v is number[] => v !== null);
    if (valid.length === 0) return null;

    const dim = valid[0].length;
    const sum = new Float64Array(dim);
    for (const v of valid) {
      for (let i = 0; i < dim; i++) sum[i] += v[i];
    }
    const result = Array.from(sum).map((x) => x / valid.length);
    return result;
  }
}
