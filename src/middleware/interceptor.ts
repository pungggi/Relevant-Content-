import type {
  EmbedFn,
  GraphNode,
  SCPConfig,
  ScoredNode,
  VectorClient,
} from '../types/index.js';
import { SemanticContextPruner } from '../core/pruner.js';

/**
 * The result returned by the middleware after intercepting
 * an SDL-MCP slice response.
 */
export interface InterceptResult {
  /** The pruned & downgraded graph slice, ready for the LLM. */
  optimisedSlice: GraphNode[];
  /** Per-node scoring details (useful for debugging / logging). */
  scored: ScoredNode[];
  /** Stats about what the middleware did. */
  stats: PruningStats;
}

export interface PruningStats {
  /** Original number of nodes in the SDL-MCP response. */
  inputNodeCount: number;
  /** Number of nodes in the optimised slice. */
  outputNodeCount: number;
  /** Number of nodes kept at full resolution. */
  fullCount: number;
  /** Number of nodes downgraded to skeleton. */
  skeletonCount: number;
  /** Number of nodes pruned entirely. */
  prunedCount: number;
  /** Estimated token reduction (rough heuristic). */
  estimatedTokenSavingPct: number;
}

/**
 * SCP Middleware — sits between the agent and SDL-MCP.
 *
 * Intercepts the raw graph slice returned by `sdl.slice.build` or
 * `sdl.slice.spillover.get`, runs it through the pruner, and hands
 * back a lean, semantically-focused payload.
 */
export class SCPMiddleware {
  private readonly pruner: SemanticContextPruner;

  constructor(
    vectorDb: VectorClient,
    embed: EmbedFn,
    config?: Partial<SCPConfig>,
  ) {
    this.pruner = new SemanticContextPruner(vectorDb, embed, config);
  }

  /**
   * Intercept an SDL-MCP slice response.
   *
   * @param userQuery  The original user prompt / task description.
   * @param rawSlice   The full graph slice returned by SDL-MCP.
   */
  async intercept(
    userQuery: string,
    rawSlice: GraphNode[],
  ): Promise<InterceptResult> {
    const { nodes, scored } = await this.pruner.optimizeSlice(
      userQuery,
      rawSlice,
    );

    const stats = this.computeStats(rawSlice, nodes, scored);

    return { optimisedSlice: nodes, scored, stats };
  }

  private computeStats(
    original: GraphNode[],
    optimised: GraphNode[],
    scored: ScoredNode[],
  ): PruningStats {
    let fullCount = 0;
    let skeletonCount = 0;
    let prunedCount = 0;

    const optimisedIds = new Set(optimised.map((n) => n.id));

    for (const s of scored) {
      if (!optimisedIds.has(s.node.id)) {
        prunedCount++;
      } else {
        // Check if rawCode was stripped (skeleton).
        const kept = optimised.find((n) => n.id === s.node.id);
        if (kept && kept.rawCode === undefined && s.node.rawCode !== undefined) {
          skeletonCount++;
        } else {
          fullCount++;
        }
      }
    }

    // Rough token-saving heuristic: full source ~N tokens, skeleton ~N/5.
    const originalTokens = original.reduce(
      (sum, n) => sum + estimateTokens(n),
      0,
    );
    const optimisedTokens = optimised.reduce(
      (sum, n) => sum + estimateTokens(n),
      0,
    );
    const saving =
      originalTokens > 0
        ? ((originalTokens - optimisedTokens) / originalTokens) * 100
        : 0;

    return {
      inputNodeCount: original.length,
      outputNodeCount: optimised.length,
      fullCount,
      skeletonCount,
      prunedCount,
      estimatedTokenSavingPct: Math.round(saving * 10) / 10,
    };
  }
}

/** Very rough token count: ~4 chars per token for English/code. */
function estimateTokens(node: GraphNode): number {
  const source = node.rawCode ?? node.skeleton ?? '';
  return Math.ceil(source.length / 4);
}
