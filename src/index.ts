// ── Public API ──────────────────────────────────────────────────────
//
// Semantic Context Pruner (SCP) for SDL-MCP
//
// Usage:
//   import { SCPMiddleware, InMemoryVectorStore, createLocalEmbedder } from 'semantic-context-pruner';
//
//   const vectorDb = new InMemoryVectorStore();
//   const embed    = createLocalEmbedder();
//   const scp      = new SCPMiddleware(vectorDb, embed);
//
//   const result   = await scp.intercept(userQuery, rawGraphSlice);
//

// Core pruner
export { SemanticContextPruner } from './core/pruner.js';

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
  EmbedFn,
  GraphNode,
  LedgerSymbol,
  SCPConfig,
  ScoredNode,
  SymbolKind,
  VectorClient,
} from './types/index.js';
export { DEFAULT_SCP_CONFIG, RelevanceTier } from './types/index.js';
