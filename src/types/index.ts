// ── SDL-MCP Graph primitives ────────────────────────────────────────

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'method'
  | 'variable'
  | 'type'
  | 'module';

/** A single node in the SDL-MCP structural graph slice. */
export interface GraphNode {
  /** Unique symbol ID (as stored in the SDL-MCP SQLite ledger). */
  id: string;
  symbolName: string;
  kind: SymbolKind;
  /** Full source code of the node (present when the node is in "full" view). */
  rawCode?: string;
  /** Signature-only skeleton (types + signature, no body). */
  skeleton?: string;
  /** AI-generated summary from SDL-MCP `semantic.generateSummaries`. */
  summary?: string;
  /** Symbol IDs this node directly depends on (callees, imports, etc.). */
  dependencies: string[];
  /** File path where this symbol lives. */
  filePath?: string;
}

/** The relevance tier assigned to a node after scoring. */
export enum RelevanceTier {
  /** R >= 0.75 — keep full source. */
  Full = 'full',
  /** 0.40 <= R < 0.75 — downgrade to skeleton. */
  Skeleton = 'skeleton',
  /** R < 0.40 — drop entirely from slice. */
  Pruned = 'pruned',
}

/** Scoring result attached to each node during the pruning pass. */
export interface ScoredNode {
  node: GraphNode;
  /** Cosine similarity between query vector and node vector. */
  semanticScore: number;
  /** Average semantic score of the node's immediate neighbours. */
  structuralScore: number;
  /** Weighted composite: α·semantic + β·structural. */
  compositeScore: number;
  tier: RelevanceTier;
}

// ── Vector DB abstraction ───────────────────────────────────────────

/** Minimal contract every vector store adapter must satisfy. */
export interface VectorClient {
  /** Store an embedding keyed by symbol ID. */
  upsert(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void>;
  /** Retrieve the vector for a given symbol ID, or null if missing. */
  get(id: string): Promise<number[] | null>;
  /** Batch-retrieve vectors for several IDs (order matches input). */
  getBatch(ids: string[]): Promise<(number[] | null)[]>;
  /** Remove an entry by ID. */
  delete(id: string): Promise<void>;
}

/** A function that turns text into a fixed-dimension vector. */
export type EmbedFn = (text: string) => Promise<number[]>;

// ── SDL-MCP Ledger types (rows read from the SQLite DB) ─────────────

export interface LedgerSymbol {
  id: string;
  symbolName: string;
  kind: SymbolKind;
  signature: string;
  summary: string;
  filePath: string;
  updatedAt: number; // epoch ms
}

// ── Intent types ────────────────────────────────────────────────────

/**
 * A single semantic facet extracted from the user query.
 *
 * Example: "Fix the JWT token expiration bug" might decompose into:
 *   - { text: "JWT token verification",  weight: 1.0 }
 *   - { text: "token expiration check",  weight: 1.0 }
 *   - { text: "date/time comparison",    weight: 0.8 }
 *   - { text: "error handling for expired tokens", weight: 0.7 }
 */
export interface IntentFacet {
  text: string;
  /** Importance weight in [0, 1]. Defaults to 1.0. */
  weight: number;
}

/**
 * Feedback from a previous pruning round.
 *
 * The agent tells us which nodes it actually consumed (positive signal)
 * and which it ignored or dismissed (negative signal), so subsequent
 * rounds can drift the intent vector toward what matters.
 */
export interface RoundFeedback {
  /** Node IDs the agent read / used — boost similar nodes. */
  usedNodeIds: string[];
  /** Node IDs the agent explicitly dismissed — suppress similar nodes. */
  dismissedNodeIds: string[];
}

/**
 * Full intent context passed to `optimizeSlice`.
 *
 * When only a plain string is available (first turn), callers can
 * still pass just the string — the pruner will auto-expand it.
 */
export interface IntentContext {
  /** Original user prompt (always required). */
  query: string;
  /** Decomposed facets.  If empty the pruner auto-generates one facet from `query`. */
  facets: IntentFacet[];
  /** Accumulated feedback from prior rounds. */
  priorFeedback: RoundFeedback[];
  /** Hard-negative node IDs: any node whose similarity to these exceeds
   *  `negativeExemplarCeiling` gets its score penalised. */
  negativeExemplarIds: string[];
  /** Rich environmental context from IDE, Git, Agent, and external tools. */
  contextPayload?: ContextPayload;
}

// ── Context Payload ─────────────────────────────────────────────────

/**
 * IDE telemetry signals — "immediate focus" from the developer's editor.
 *
 * These are non-semantic signals that carry extremely high confidence
 * about what the developer is currently working on.
 */
export interface IDEContext {
  /** Symbol ID of the node currently under the cursor. */
  activeNodeId?: string;
  /** Symbol IDs visible in open editor tabs (the developer's "mental buffer"). */
  openTabNodeIds?: string[];
  /** Symbol IDs where the developer has placed debug breakpoints. */
  breakpointNodeIds?: string[];
  /** File paths currently visible in the viewport. */
  visibleFiles?: string[];
  /** Active linter / type errors: { nodeId, message }. */
  diagnostics?: Array<{ nodeId: string; message: string }>;
}

/**
 * Git / version-control signals — "temporal intent" from recent activity.
 */
export interface GitContext {
  /** Current branch name (often semantic, e.g. "bugfix/jwt-timeout"). */
  branch?: string;
  /** File paths with uncommitted changes (dirty working tree). */
  dirtyFiles?: string[];
  /** File paths changed in the last N commits. */
  recentlyChangedFiles?: string[];
  /** True when the repo is in a merge-conflict state. */
  isMergeConflict?: boolean;
  /** File paths containing conflict markers. */
  conflictFiles?: string[];
}

/**
 * Agent internal state — "cognitive intent" from the AI's own reasoning.
 */
export interface AgentContext {
  /** Description of the agent's current plan step. */
  currentPlanStep?: string;
  /** The most recent tool error message (highest-priority re-query signal). */
  lastToolError?: string;
  /** Summary of what the agent has learned so far (avoids re-fetching). */
  scratchpadSummary?: string;
}

/**
 * External tooling signals — issue trackers, CI/CD, etc.
 */
export interface ExternalContext {
  /** Title + description from the linked issue (Jira / Linear / GitHub). */
  issueDescription?: string;
  /** Names of failing CI tests — each becomes a high-weight facet. */
  failingTestNames?: string[];
}

/**
 * Combined context payload from the developer's environment.
 *
 * The pruner uses these signals to inject hard boosts and produce
 * additional facets, going far beyond the text of the user prompt.
 */
export interface ContextPayload {
  ide?: IDEContext;
  git?: GitContext;
  agent?: AgentContext;
  external?: ExternalContext;
}

// ── Configuration ───────────────────────────────────────────────────

export interface SCPConfig {
  /** Weight for semantic similarity (α). Default 0.7. */
  alpha: number;
  /** Weight for structural centrality (β). Default 0.3. */
  beta: number;
  /** Threshold at or above which a node keeps full source. */
  fullThreshold: number;
  /** Threshold at or above which a node is kept as skeleton. */
  skeletonThreshold: number;
  /**
   * If a node's in-degree exceeds this AND its raw semantic score is
   * below `utilitySemanticCeiling`, auto-prune it ("utility blackhole").
   */
  utilityIndegreeCap: number;
  /** Max semantic score for the utility-blackhole heuristic. */
  utilitySemanticCeiling: number;
  /** Boost multiplier applied to nodes similar to previously-used nodes. */
  feedbackBoost: number;
  /** Penalty multiplier applied to nodes similar to dismissed / negative exemplars. */
  feedbackPenalty: number;
  /** Similarity ceiling: if a node's similarity to a negative exemplar
   *  exceeds this, the penalty applies. */
  negativeExemplarCeiling: number;
  /** Multiplier for nodes pinned by context payload signals (active file,
   *  breakpoints, dirty files, etc.). Applied on top of semantic score. */
  contextPayloadBoost: number;
  /** Multiplier for nodes in open tabs — weaker than activeNode but
   *  still a strong signal of developer focus. */
  contextTabBoost: number;
}

export const DEFAULT_SCP_CONFIG: SCPConfig = {
  alpha: 0.7,
  beta: 0.3,
  fullThreshold: 0.75,
  skeletonThreshold: 0.40,
  utilityIndegreeCap: 50,
  utilitySemanticCeiling: 0.2,
  feedbackBoost: 1.25,
  feedbackPenalty: 0.5,
  negativeExemplarCeiling: 0.85,
  contextPayloadBoost: 2.0,
  contextTabBoost: 1.4,
};
