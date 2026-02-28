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
}

export const DEFAULT_SCP_CONFIG: SCPConfig = {
  alpha: 0.7,
  beta: 0.3,
  fullThreshold: 0.75,
  skeletonThreshold: 0.40,
  utilityIndegreeCap: 50,
  utilitySemanticCeiling: 0.2,
};
