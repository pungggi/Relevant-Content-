import type {
  EmbedFn,
  GraphNode,
  SCPConfig,
  ScoredNode,
  VectorClient,
} from '../types/index.js';
import { DEFAULT_SCP_CONFIG, RelevanceTier } from '../types/index.js';
import { cosineSimilarity } from '../vector/similarity.js';

/**
 * Semantic Context Pruner (SCP)
 *
 * Evaluates every node in an SDL-MCP graph slice against the agent's
 * query, then keeps / downgrades / drops nodes according to the
 * composite relevance score described in §5 of the specification.
 */
export class SemanticContextPruner {
  private readonly vectorDb: VectorClient;
  private readonly embed: EmbedFn;
  private readonly config: SCPConfig;

  constructor(
    vectorDb: VectorClient,
    embed: EmbedFn,
    config: Partial<SCPConfig> = {},
  ) {
    this.vectorDb = vectorDb;
    this.embed = embed;
    this.config = { ...DEFAULT_SCP_CONFIG, ...config };
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Main entry point.
   *
   * 1. Embeds the user query.
   * 2. Fetches vectors for every node in the slice.
   * 3. Scores each node (semantic × α + structural × β).
   * 4. Applies the action matrix (full / skeleton / pruned).
   * 5. Repairs dangling edges left by pruned nodes.
   */
  async optimizeSlice(
    userQuery: string,
    rawSlice: GraphNode[],
  ): Promise<{ nodes: GraphNode[]; scored: ScoredNode[] }> {
    if (rawSlice.length === 0) return { nodes: [], scored: [] };

    const queryVector = await this.embed(userQuery);

    // Batch-fetch all node vectors in one round trip.
    const ids = rawSlice.map((n) => n.id);
    const vectors = await this.vectorDb.getBatch(ids);

    // Pre-compute semantic scores (cosine similarity with query).
    const semanticScores = new Map<string, number>();
    for (let i = 0; i < rawSlice.length; i++) {
      const vec = vectors[i];
      const sim = vec ? cosineSimilarity(queryVector, vec) : 0;
      // Cosine similarity is already in [-1,1]; we clamp to [0,1].
      semanticScores.set(rawSlice[i].id, Math.max(0, sim));
    }

    // Build an in-degree map for the utility-blackhole heuristic.
    const inDegree = this.buildInDegreeMap(rawSlice);

    // Score every node.
    const scored: ScoredNode[] = rawSlice.map((node) => {
      const semScore = semanticScores.get(node.id) ?? 0;
      const structScore = this.neighbourAverage(
        node.dependencies,
        semanticScores,
      );

      const { alpha, beta } = this.config;
      let composite = alpha * semScore + beta * structScore;

      // §7 — Utility Blackhole: auto-prune high-indegree, low-semantic nodes.
      const nodeInDegree = inDegree.get(node.id) ?? 0;
      if (
        nodeInDegree > this.config.utilityIndegreeCap &&
        semScore < this.config.utilitySemanticCeiling
      ) {
        composite = 0;
      }

      return {
        node,
        semanticScore: semScore,
        structuralScore: structScore,
        compositeScore: composite,
        tier: this.tierFor(composite),
      };
    });

    // Apply tier actions + edge repair.
    const optimised = this.applyTiers(scored);
    const repaired = this.repairEdges(optimised);

    return { nodes: repaired, scored };
  }

  // ── Internals ───────────────────────────────────────────────────

  /** Determine the relevance tier for a composite score. */
  private tierFor(score: number): RelevanceTier {
    if (score >= this.config.fullThreshold) return RelevanceTier.Full;
    if (score >= this.config.skeletonThreshold) return RelevanceTier.Skeleton;
    return RelevanceTier.Pruned;
  }

  /**
   * Average semantic score of a node's direct neighbours.
   * This is the "Structural Centrality / Bridging Penalty" from §5.B.
   */
  private neighbourAverage(
    depIds: string[],
    scores: Map<string, number>,
  ): number {
    if (depIds.length === 0) return 0;
    let sum = 0;
    let count = 0;
    for (const id of depIds) {
      const s = scores.get(id);
      if (s !== undefined) {
        sum += s;
        count++;
      }
    }
    return count === 0 ? 0 : sum / count;
  }

  /** Build a map of symbol ID → number of callers within the slice. */
  private buildInDegreeMap(nodes: GraphNode[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const n of nodes) map.set(n.id, 0);
    for (const n of nodes) {
      for (const dep of n.dependencies) {
        map.set(dep, (map.get(dep) ?? 0) + 1);
      }
    }
    return map;
  }

  /** Apply the action matrix: keep-full / downgrade-to-skeleton / prune. */
  private applyTiers(scored: ScoredNode[]): GraphNode[] {
    const kept: GraphNode[] = [];

    for (const { node, tier } of scored) {
      switch (tier) {
        case RelevanceTier.Full:
          kept.push(node);
          break;
        case RelevanceTier.Skeleton:
          // Downgrade: strip the body, keep the skeleton.
          kept.push({
            ...node,
            rawCode: undefined,
          });
          break;
        case RelevanceTier.Pruned:
          // Dropped — intentionally omitted from `kept`.
          break;
      }
    }

    return kept;
  }

  /**
   * Repair dangling edges left after pruning.
   *
   * Any dependency ID that no longer appears in the slice is removed
   * from the `dependencies` array so the downstream consumer never
   * sees an orphaned reference.
   */
  private repairEdges(nodes: GraphNode[]): GraphNode[] {
    const retainedIds = new Set(nodes.map((n) => n.id));

    return nodes.map((node) => ({
      ...node,
      dependencies: node.dependencies.filter((id) => retainedIds.has(id)),
    }));
  }
}
