# Semantic Context Pruner (SCP)

Active Retrieval Engine for [SDL-MCP](https://github.com/anthropics/sdl-mcp). Prunes, downgrades, and re-ranks structurally connected but semantically irrelevant graph nodes to minimize LLM context-window token usage.

SCP sits as middleware between an AI agent and SDL-MCP's structural graph slices, transforming raw code graphs into lean, intent-focused payloads. It goes beyond static vector search by combining four intent-enhancement modes:

| Mode | Research basis | What it does |
|------|---------------|-------------|
| **Multi-facet scoring** | RichRAG, Multi-Query Retrieval | Decomposes the query into sub-intents, scores each node against its best match (`max`, not `avg`) |
| **Feedback drift** | Rocchio algorithm, VPRF | Shifts the scoring space toward used nodes and away from dismissed ones across rounds |
| **Negative exemplars** | A-MemGuard, Hard Negatives in RAG | Suppresses nodes too similar to explicitly rejected symbols |
| **Context payload** | IDE telemetry (Cursor/Copilot pattern) | Ingests Git, IDE, Agent, and External signals as hard boosts and synthetic facets |

## Packages

This is an npm workspaces monorepo with four packages:

| Package | npm name | Description |
|---------|----------|-------------|
| [`packages/core`](packages/core) | `@scp/core` | Scoring engine, types, pruner, intent tracker, vector utils |
| [`packages/git-collector`](packages/git-collector) | `@scp/git-collector` | Collects `GitContext` from local git repos |
| [`packages/workitems`](packages/workitems) | `@scp/workitems` | Collects `ExternalContext` from Jira, Azure DevOps, GitHub Issues |
| [`packages/vscode`](packages/vscode) | `scp-vscode` | VS Code extension — IDE collector + orchestrator |

### Dependency graph

```
                    @scp/core
                (types + scoring engine)
                  ▲       ▲       ▲
                  │       │       │
    ┌─────────────┤       │       ├──────────────┐
    │             │       │       │              │
@scp/git-collector  @scp/workitems         scp-vscode
  (git signals)    (Jira, ADO, GitHub)   (IDE + orchestrator)
                                              │
                              ┌───────────────┤
                              │               │
                        uses git-collector  uses workitems
```

## Installation

```bash
npm install @scp/core
```

For git signal collection:
```bash
npm install @scp/git-collector
```

For work item integration (Jira, ADO, GitHub):
```bash
npm install @scp/workitems
```

## Quick start

```typescript
import {
  SCPMiddleware,
  IntentTracker,
  InMemoryVectorStore,
  createLocalEmbedder,
  createHeuristicExpander,
} from '@scp/core';

// 1. Set up infrastructure
const vectorDb = new InMemoryVectorStore();
const embed    = createLocalEmbedder();   // swap for OpenAI / Sentence-Transformers in production
const scp      = new SCPMiddleware(vectorDb, embed);

// 2. Create an IntentTracker for multi-turn sessions
const tracker = new IntentTracker(embed, vectorDb, createHeuristicExpander());
await tracker.initialise('Fix the JWT token expiration bug and update the logging format');

// 3. Intercept an SDL-MCP slice
const result = await scp.intercept(tracker.getContext(), rawGraphSlice);

console.log(result.stats);
// { inputNodeCount: 120, outputNodeCount: 23, fullCount: 8,
//   skeletonCount: 15, prunedCount: 97, estimatedTokenSavingPct: 81.2 }

// 4. After the agent reads the slice, record feedback
tracker.recordFeedback({
  usedNodeIds: ['auth-service', 'jwt-validator'],
  dismissedNodeIds: ['legacy-auth-v1'],
});

// 5. Next round automatically benefits from the drift
const round2 = await scp.intercept(tracker.getContext(), nextSlice);
```

### With git and work item context

```typescript
import { collectGitContext } from '@scp/git-collector';
import { collectWorkItemContext, createJiraProvider } from '@scp/workitems';

// Collect git signals
const git = await collectGitContext({ repoPath: '/path/to/repo' });

// Collect work item context (uses branch name to find the active issue)
const external = await collectWorkItemContext(
  { providers: [createJiraProvider({ baseUrl: '...', email: '...', apiToken: '...' })] },
  { branch: git.branch },
);

// Pass as context payload
const result = await scp.intercept({
  ...tracker.getContext(),
  contextPayload: { git, external },
}, rawSlice);
```

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │             IntentTracker                 │
                    │                                          │
                    │  query ──► QueryExpander ──► facets[]    │
                    │  feedback[] ──► drift centroids           │
                    │  negativeExemplarIds[]                    │
                    │  contextPayload { ide, git, agent, ext } │
                    └────────────────┬─────────────────────────┘
                                     │ IntentContext
                    ┌────────────────▼─────────────────────────┐
                    │           SCPMiddleware                   │
                    │                                          │
                    │  ┌──────────────────────────────────┐    │
                    │  │    SemanticContextPruner          │    │
                    │  │                                   │    │
                    │  │  1. Embed all facets               │    │
                    │  │  2. Batch-fetch node vectors       │    │
                    │  │  3. Compute drift centroids        │    │
                    │  │  4. Fetch negative exemplar vecs   │    │
                    │  │  5. Score each node:               │    │
                    │  │     max(facet·weight) × drift      │    │
                    │  │     × exemplar_penalty             │    │
                    │  │     × payload_boost                │    │
                    │  │  6. Composite: α·sem + β·struct    │    │
                    │  │  7. Tier: Full / Skeleton / Pruned │    │
                    │  │  8. Repair dangling edges          │    │
                    │  └──────────────────────────────────┘    │
                    └────────────────┬─────────────────────────┘
                                     │ InterceptResult
                                     ▼
                              { optimisedSlice, scored, stats }
```

## Core concepts

### IntentContext

Every call to `optimizeSlice` or `intercept` requires an `IntentContext`:

```typescript
interface IntentContext {
  query: string;                        // Original user prompt
  facets: IntentFacet[];                // Decomposed sub-intents
  priorFeedback: RoundFeedback[];       // Used/dismissed node history
  negativeExemplarIds: string[];        // Hard-negative node IDs
  contextPayload?: ContextPayload;      // IDE, Git, Agent, External signals
}
```

### Multi-facet scoring

Instead of embedding the user query as a single vector, SCP decomposes it into multiple weighted facets. Each node is scored against its **best-matching facet** (max, not average), preventing the "averaging problem" where a compound query like "fix JWT + add Redis cache" misses both concepts.

```typescript
// The QueryExpander decomposes queries automatically
const expand = createHeuristicExpander();
const facets = await expand('Fix the auth bug and update the logging format');
// [
//   { text: 'Fix the auth bug and update the logging format', weight: 1.0 },
//   { text: 'Fix the auth bug',     weight: 0.8 },
//   { text: 'update the logging format', weight: 0.8 },
// ]
```

For stronger decomposition, use `createLLMExpander()` with your LLM of choice:

```typescript
const expand = createLLMExpander(async (query) => {
  const response = await llm.chat({
    messages: [
      { role: 'system', content: 'Decompose into 3-5 sub-intents. Return JSON: [{text, weight}]' },
      { role: 'user', content: query },
    ],
  });
  return JSON.parse(response);
});
```

### Feedback drift (Rocchio shift)

After each round, tell the tracker which nodes the agent actually used vs. ignored:

```typescript
tracker.recordFeedback({
  usedNodeIds: ['auth-service', 'jwt-utils'],
  dismissedNodeIds: ['legacy-auth-v1', 'test-helpers'],
});
```

The pruner computes **positive and negative drift centroids** from the feedback vectors. On the next round, nodes similar to used nodes get a `feedbackBoost` multiplier (default 1.25x), while nodes similar to dismissed ones get a `feedbackPenalty` (default 0.5x).

### Negative exemplars

For hard suppression of entire code regions (deprecated modules, V1 code, irrelevant test fixtures):

```typescript
tracker.addNegativeExemplar('legacy-auth-v1-module');

// Nodes whose cosine similarity to the exemplar exceeds
// negativeExemplarCeiling (default 0.85) get multiplicatively penalised.
```

Nodes dismissed 2+ times are auto-promoted to negative exemplars.

### Context payload

The richest signal source. Pass environmental telemetry from the IDE, Git, agent reasoning, and external tools:

```typescript
const result = await scp.intercept({
  query: 'Fix the token bug',
  facets: [{ text: 'Fix the token bug', weight: 1.0 }],
  priorFeedback: [],
  negativeExemplarIds: [],
  contextPayload: {
    ide: {
      activeNodeId: 'symbol_auth_service',          // Hard pin (2x boost)
      openTabNodeIds: ['symbol_jwt_utils'],          // Soft pin (1.4x boost)
      breakpointNodeIds: ['symbol_token_validator'], // Hard pin (2x boost)
      diagnostics: [{
        nodeId: 'symbol_user_model',
        message: 'TS2339: Property does not exist on type User',
      }],
    },
    git: {
      branch: 'bugfix/token-refresh-loop',           // Becomes synthetic facet
      dirtyFiles: ['src/auth/validator.ts'],          // File-path boost (2x)
      recentlyChangedFiles: ['src/auth/service.ts'],  // File-path boost (1.4x)
    },
    agent: {
      currentPlanStep: 'Diagnose token refresh loop', // Synthetic facet (0.85w)
      lastToolError: 'TypeError: token.exp is not a function', // Synthetic facet (0.95w)
    },
    external: {
      issueDescription: 'Token refresh fails after 24h', // Synthetic facet (0.8w)
      failingTestNames: ['test_token_refresh_timeout'],   // Synthetic facet (0.9w)
    },
  },
}, rawSlice);
```

#### Signal processing summary

| Source | Hard boosts (by node ID) | Synthetic facets | File-path boosts |
|--------|-------------------------|-----------------|-----------------|
| **IDE** | `activeNodeId` (2x), `breakpointNodeIds` (2x), `diagnostics[].nodeId` (2x) | `diagnostics[].message` (0.9w) | -- |
| **IDE** | `openTabNodeIds` (1.4x) | -- | -- |
| **Git** | -- | `branch` name cleaned (0.7w) | `dirtyFiles` (2x), `conflictFiles` (2x), `recentlyChangedFiles` (1.4x) |
| **Agent** | -- | `lastToolError` (0.95w), `currentPlanStep` (0.85w) | -- |
| **External** | -- | `issueDescription` (0.8w), `failingTestNames` (0.9w each) | -- |

Pinned nodes (those receiving hard boosts) also:
- Get a minimum score floor even without embeddings in the vector store
- Bypass the utility-blackhole heuristic

## Scoring formula

For each node `N`:

```
semantic = max(cosine(facet_i, N) × weight_i)    // best-matching facet
         × driftAdjustment                        // Rocchio boost/penalty
         × exemplarPenalty                        // negative exemplar suppression
         × payloadMultiplier                      // context payload boost

composite = α × semantic + β × structural         // structural = avg neighbour score

tier = Full     if composite >= fullThreshold      (default 0.75)
     | Skeleton if composite >= skeletonThreshold  (default 0.40)
     | Pruned   otherwise
```

## Configuration

All parameters are optional. Pass a `Partial<SCPConfig>` to the constructor:

```typescript
const scp = new SCPMiddleware(vectorDb, embed, {
  alpha: 0.7,                    // Semantic similarity weight
  beta: 0.3,                     // Structural centrality weight
  fullThreshold: 0.75,           // Keep full source above this
  skeletonThreshold: 0.40,       // Keep skeleton above this
  utilityIndegreeCap: 50,        // Blackhole nodes with indegree > this...
  utilitySemanticCeiling: 0.2,   // ...if their semantic score is below this
  feedbackBoost: 1.25,           // Multiplier for positive drift
  feedbackPenalty: 0.5,          // Multiplier for negative drift
  negativeExemplarCeiling: 0.85, // Similarity threshold for exemplar penalty
  contextPayloadBoost: 2.0,      // Multiplier for pinned nodes (active, breakpoints, dirty)
  contextTabBoost: 1.4,          // Multiplier for open-tab nodes
});
```

## Background indexing

SCP needs node embeddings in the vector store. The `SCPIndexer` pulls symbols from the SDL-MCP SQLite ledger and keeps embeddings in sync:

```typescript
import { SCPIndexer } from '@scp/core';

const indexer = new SCPIndexer(ledgerReader, vectorDb, embed);

// Run periodically or on ledger change
const indexed = await indexer.sync();
console.log(`Indexed ${indexed} symbols`);
```

## Embedding

The built-in `createLocalEmbedder()` uses deterministic character-level hashing for zero-dependency testing. For production, implement the `EmbedFn` contract with a real model:

```typescript
import OpenAI from 'openai';

const openai = new OpenAI();

const embed: EmbedFn = async (text: string) => {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
};
```

## Vector store

The built-in `InMemoryVectorStore` works for local/testing use. For production, implement the `VectorClient` interface with Chroma, Qdrant, FAISS, or any vector database:

```typescript
interface VectorClient {
  upsert(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void>;
  get(id: string): Promise<number[] | null>;
  getBatch(ids: string[]): Promise<(number[] | null)[]>;
  delete(id: string): Promise<void>;
}
```

## API reference

### Classes

| Class | Description |
|-------|------------|
| `SemanticContextPruner` | Core scoring engine. Call `optimizeSlice(intent, nodes)`. |
| `SCPMiddleware` | High-level wrapper with stats. Call `intercept(intent, nodes)`. |
| `IntentTracker` | Stateful session object. Manages facets, feedback, and negative exemplars across rounds. |
| `SCPIndexer` | Background sync from SDL-MCP ledger to vector store. |
| `InMemoryVectorStore` | Zero-dependency in-memory `VectorClient` for testing. |

### Functions

| Function | Description |
|----------|------------|
| `createHeuristicExpander()` | Returns an `ExpandFn` that decomposes queries using lightweight heuristics (quoted strings, CamelCase, dot-paths, conjunction splitting). |
| `createLLMExpander(llmCall)` | Returns an `ExpandFn` that delegates decomposition to your LLM. |
| `createLocalEmbedder(dims?)` | Returns an `EmbedFn` using deterministic hashing. Test-only. |
| `buildEmbeddingInput(...)` | Builds the text blob for embedding a symbol (summary + signature). |
| `cosineSimilarity(a, b)` | Cosine similarity between two vectors. |

### Types

| Type | Description |
|------|------------|
| `IntentContext` | Full intent specification: query, facets, feedback, negative exemplars, context payload. |
| `IntentFacet` | A single decomposed sub-intent with text and weight. |
| `RoundFeedback` | Used/dismissed node IDs from a previous round. |
| `ContextPayload` | Environmental signals: `IDEContext`, `GitContext`, `AgentContext`, `ExternalContext`. |
| `GraphNode` | A node in the SDL-MCP structural graph slice. |
| `ScoredNode` | A node with its semantic, structural, and composite scores. |
| `SCPConfig` | All tunable parameters. |
| `EmbedFn` | `(text: string) => Promise<number[]>` |
| `VectorClient` | Vector store contract. |
| `RelevanceTier` | `Full` / `Skeleton` / `Pruned` enum. |

## Development

```bash
npm install                                    # install all workspace dependencies
npm run build                                  # tsc -b (builds all packages in order)
npm test                                       # run tests across all packages
npm run test --workspace=packages/core         # test a single package
npm run build --workspace=packages/git-collector  # build a single package
```

## License

MIT
