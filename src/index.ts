// ── Public API ──────────────────────────────────────────────────────
//
// Semantic Context Pruner (SCP) — Active Retrieval Engine for SDL-MCP
//
// See README.md for full usage.

// Core pruner
export { SemanticContextPruner } from './core/pruner.js';

// Intent
export { IntentTracker } from './core/intent-tracker.js';
export {
  createHeuristicExpander,
  createLLMExpander,
} from './core/query-expander.js';
export type { ExpandFn } from './core/query-expander.js';

// Middleware
export { SCPMiddleware } from './middleware/interceptor.js';
export type { InterceptResult, PruningStats } from './middleware/interceptor.js';

// Indexer
export { SCPIndexer } from './indexer/sync.js';
export type { LedgerReader } from './indexer/sync.js';

// Vector
export { InMemoryVectorStore } from './vector/in-memory-store.js';
export { cosineSimilarity, normalise } from './vector/similarity.js';

// Utils
export { buildEmbeddingInput, createLocalEmbedder } from './utils/embed.js';

// Types
export type {
  AgentContext,
  ContextPayload,
  EmbedFn,
  ExternalContext,
  GitContext,
  GraphNode,
  IDEContext,
  IntentContext,
  IntentFacet,
  LedgerSymbol,
  RoundFeedback,
  SCPConfig,
  ScoredNode,
  SymbolKind,
  VectorClient,
} from './types/index.js';
export { DEFAULT_SCP_CONFIG, RelevanceTier } from './types/index.js';
