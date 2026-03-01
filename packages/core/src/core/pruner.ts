import type {
  ContextPayload,
  EmbedFn,
  GraphNode,
  IntentContext,
  IntentFacet,
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
 *
 * Intent-enhancement modes:
 *   1. **Multi-facet scoring** — score each node against multiple
 *      decomposed intent facets and take the weighted maximum.
 *   2. **Feedback drift** (Rocchio shift) — boost nodes similar to
 *      previously-used nodes, penalise dismissed ones.
 *   3. **Negative exemplars** — hard-suppress nodes too similar to
 *      explicitly rejected symbols.
 *   4. **Context payload** — IDE telemetry, Git signals, Agent state,
 *      and External tooling inject hard boosts and synthetic facets.
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
   * Requires a full {@link IntentContext} with decomposed facets,
   * optional feedback history, negative exemplars, and context payload.
   * Use {@link IntentTracker.getContext()} or build one manually.
   */
  async optimizeSlice(
    intent: IntentContext,
    rawSlice: GraphNode[],
  ): Promise<{ nodes: GraphNode[]; scored: ScoredNode[] }> {
    if (rawSlice.length === 0) return { nodes: [], scored: [] };

    // If facets list is empty, fall back to the raw query.
    if (intent.facets.length === 0) {
      intent.facets = [{ text: intent.query, weight: 1.0 }];
    }

    // ── 0. Extract context payload signals ───────────────────────
    const payload = intent.contextPayload;
    const {
      pinnedNodeIds,
      tabNodeIds,
      syntheticFacets,
      filePathBoosts,
    } = this.extractPayloadSignals(payload);

    // Merge synthetic facets from context payload into intent facets.
    const allFacets = [...intent.facets, ...syntheticFacets];

    // ── 1. Embed all facets ──────────────────────────────────────
    const facetVectors = await Promise.all(
      allFacets.map((f) => this.embed(f.text)),
    );

    // ── 2. Batch-fetch all node vectors ──────────────────────────
    const ids = rawSlice.map((n) => n.id);
    const nodeVectors = await this.vectorDb.getBatch(ids);

    // ── 3. Compute feedback drift centroids (Rocchio shift) ──────
    const allUsedIds = intent.priorFeedback.flatMap((f) => f.usedNodeIds);
    const allDismissedIds = intent.priorFeedback.flatMap(
      (f) => f.dismissedNodeIds,
    );
    const positiveDrift = await this.centroid(allUsedIds);
    const negativeDrift = await this.centroid([
      ...allDismissedIds,
      ...intent.negativeExemplarIds,
    ]);

    // ── 4. Fetch negative-exemplar vectors ───────────────────────
    const negExemplarVectors = await this.vectorDb.getBatch(
      intent.negativeExemplarIds,
    );

    // ── 5. Score each node ───────────────────────────────────────
    const semanticScores = new Map<string, number>();

    for (let i = 0; i < rawSlice.length; i++) {
      const nodeId = rawSlice[i].id;
      const nodeVec = nodeVectors[i];

      if (!nodeVec) {
        // No vector available — but context payload can still pin it.
        const payloadFloor = this.payloadFloor(
          nodeId,
          rawSlice[i].filePath,
          pinnedNodeIds,
          tabNodeIds,
          filePathBoosts,
        );
        semanticScores.set(nodeId, payloadFloor);
        continue;
      }

      // Multi-facet: take the best weighted similarity across all facets.
      let bestWeightedSim = 0;
      for (let f = 0; f < facetVectors.length; f++) {
        const sim = Math.max(0, cosineSimilarity(facetVectors[f], nodeVec));
        const weighted = sim * allFacets[f].weight;
        if (weighted > bestWeightedSim) bestWeightedSim = weighted;
      }

      // Feedback drift adjustment (Rocchio).
      let driftAdjustment = 1.0;
      if (positiveDrift) {
        const posSim = Math.max(
          0,
          cosineSimilarity(positiveDrift, nodeVec),
        );
        driftAdjustment *= 1.0 + (this.config.feedbackBoost - 1.0) * posSim;
      }
      if (negativeDrift) {
        const negSim = Math.max(
          0,
          cosineSimilarity(negativeDrift, nodeVec),
        );
        driftAdjustment *= 1.0 - (1.0 - this.config.feedbackPenalty) * negSim;
      }

      // Negative exemplar hard-suppression.
      let exemplarPenalty = 1.0;
      for (const negVec of negExemplarVectors) {
        if (!negVec) continue;
        const sim = cosineSimilarity(negVec, nodeVec);
        if (sim > this.config.negativeExemplarCeiling) {
          exemplarPenalty *= 1.0 - sim;
        }
      }

      // Context payload hard-boosts by node ID and file path.
      const payloadMultiplier = this.payloadMultiplier(
        nodeId,
        rawSlice[i].filePath,
        pinnedNodeIds,
        tabNodeIds,
        filePathBoosts,
      );

      const finalSemantic =
        bestWeightedSim *
        Math.max(0, driftAdjustment) *
        exemplarPenalty *
        payloadMultiplier;
      semanticScores.set(nodeId, Math.min(1, finalSemantic));
    }

    // ── 6. Composite scoring ─────────────────────────────────────
    const inDegree = this.buildInDegreeMap(rawSlice);

    const scored: ScoredNode[] = rawSlice.map((node) => {
      const semScore = semanticScores.get(node.id) ?? 0;
      const structScore = this.neighbourAverage(
        node.dependencies,
        semanticScores,
      );

      const { alpha, beta } = this.config;
      let composite = alpha * semScore + beta * structScore;

      // §7 — Utility Blackhole: auto-prune high-indegree, low-semantic nodes.
      // Pinned nodes bypass the blackhole.
      const nodeInDegree = inDegree.get(node.id) ?? 0;
      const isPinned = pinnedNodeIds.has(node.id);
      if (
        !isPinned &&
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

  // ── Context Payload Processing ─────────────────────────────────

  /**
   * Extract hard-boost node sets and synthetic facets from the
   * context payload.
   */
  private extractPayloadSignals(payload?: ContextPayload): {
    pinnedNodeIds: Set<string>;
    tabNodeIds: Set<string>;
    syntheticFacets: IntentFacet[];
    filePathBoosts: Map<string, number>;
  } {
    const pinnedNodeIds = new Set<string>();
    const tabNodeIds = new Set<string>();
    const syntheticFacets: IntentFacet[] = [];
    const filePathBoosts = new Map<string, number>();

    if (!payload) {
      return { pinnedNodeIds, tabNodeIds, syntheticFacets, filePathBoosts };
    }

    // ── IDE signals ────────────────────────────────────────────
    const ide = payload.ide;
    if (ide) {
      if (ide.activeNodeId) pinnedNodeIds.add(ide.activeNodeId);
      if (ide.breakpointNodeIds) {
        for (const id of ide.breakpointNodeIds) pinnedNodeIds.add(id);
      }
      if (ide.openTabNodeIds) {
        for (const id of ide.openTabNodeIds) tabNodeIds.add(id);
      }
      if (ide.diagnostics) {
        for (const diag of ide.diagnostics) {
          pinnedNodeIds.add(diag.nodeId);
          syntheticFacets.push({ text: diag.message, weight: 0.9 });
        }
      }
    }

    // ── Git signals ────────────────────────────────────────────
    const git = payload.git;
    if (git) {
      if (git.branch) {
        // Branch names are often semantic: "bugfix/jwt-timeout" → facet.
        const branchText = git.branch
          .replace(/[-_/]/g, ' ')
          .replace(/\b(feat|fix|bugfix|feature|hotfix|chore|refactor)\b/gi, '')
          .trim();
        if (branchText.length > 2) {
          syntheticFacets.push({ text: branchText, weight: 0.7 });
        }
      }
      if (git.dirtyFiles) {
        for (const fp of git.dirtyFiles) {
          filePathBoosts.set(fp, this.config.contextPayloadBoost);
        }
      }
      if (git.isMergeConflict && git.conflictFiles) {
        for (const fp of git.conflictFiles) {
          filePathBoosts.set(fp, this.config.contextPayloadBoost);
        }
      }
      if (git.recentlyChangedFiles) {
        for (const fp of git.recentlyChangedFiles) {
          if (!filePathBoosts.has(fp)) {
            filePathBoosts.set(fp, this.config.contextTabBoost);
          }
        }
      }
    }

    // ── Agent signals ──────────────────────────────────────────
    const agent = payload.agent;
    if (agent) {
      if (agent.lastToolError) {
        syntheticFacets.push({ text: agent.lastToolError, weight: 0.95 });
      }
      if (agent.currentPlanStep) {
        syntheticFacets.push({ text: agent.currentPlanStep, weight: 0.85 });
      }
    }

    // ── External signals ───────────────────────────────────────
    const ext = payload.external;
    if (ext) {
      if (ext.issueDescription) {
        syntheticFacets.push({ text: ext.issueDescription, weight: 0.8 });
      }
      if (ext.failingTestNames) {
        for (const t of ext.failingTestNames) {
          syntheticFacets.push({ text: t, weight: 0.9 });
        }
      }
    }

    return { pinnedNodeIds, tabNodeIds, syntheticFacets, filePathBoosts };
  }

  /**
   * Compute the score multiplier for a node based on context payload.
   * Pinned nodes (active file, breakpoints) get contextPayloadBoost,
   * tab nodes get contextTabBoost, file-path matches get their boost.
   */
  private payloadMultiplier(
    nodeId: string,
    filePath: string | undefined,
    pinnedNodeIds: Set<string>,
    tabNodeIds: Set<string>,
    filePathBoosts: Map<string, number>,
  ): number {
    if (pinnedNodeIds.has(nodeId)) return this.config.contextPayloadBoost;
    if (tabNodeIds.has(nodeId)) return this.config.contextTabBoost;
    if (filePath && filePathBoosts.has(filePath)) {
      return filePathBoosts.get(filePath)!;
    }
    return 1.0;
  }

  /**
   * Minimum score floor for pinned nodes that have no vector.
   * Ensures context-pinned nodes are never pruned even without embeddings.
   */
  private payloadFloor(
    nodeId: string,
    filePath: string | undefined,
    pinnedNodeIds: Set<string>,
    tabNodeIds: Set<string>,
    filePathBoosts: Map<string, number>,
  ): number {
    if (pinnedNodeIds.has(nodeId)) return this.config.fullThreshold;
    if (tabNodeIds.has(nodeId)) return this.config.skeletonThreshold;
    if (filePath && filePathBoosts.has(filePath)) {
      return this.config.skeletonThreshold;
    }
    return 0;
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

  /** Compute the centroid (average) of a set of node vectors. */
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
    return Array.from(sum).map((x) => x / valid.length);
  }
}
