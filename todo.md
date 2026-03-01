# SCP Project — Comprehensive TODO

## Current state

**4 packages**, **196 passing tests**, monorepo with npm workspaces.

| Package | Status | Tests |
|---------|--------|-------|
| `@scp/core` | Feature-complete (local/test mode) | 126 |
| `@scp/git-collector` | Feature-complete | 14 |
| `@scp/workitems` | Feature-complete | 56 |
| `scp-vscode` | Scaffolded, compiles, no tests | 0 |

---

## 1. Production embedding & vector store

The two biggest "swap in production" items. Everything currently runs on local-only placeholders.

- [ ] **Real embedding adapter** — Implement `EmbedFn` wrapper for OpenAI `text-embedding-3-small` (or Sentence-Transformers / Cohere). The current `createLocalEmbedder()` uses deterministic character hashing — usable for tests only.
- [ ] **Persistent vector store** — Implement `VectorClient` adapter for Chroma, Qdrant, FAISS, or Pinecone. The current `InMemoryVectorStore` loses all data on restart and can't handle large codebases.
- [ ] **Embedding cache / batching** — The pruner calls `embed()` per-facet on every `optimizeSlice`. Add a cache layer to avoid re-embedding identical strings, and batch embedding API calls where possible.

## 2. SDL-MCP ledger integration

The `SCPIndexer` is wired up but has no real data source.

- [ ] **SQLite ledger reader** — Implement `LedgerReader` that reads from the actual SDL-MCP SQLite database (`sdl.slice.build` output). Currently uses a mock interface.
- [ ] **Background sync loop** — Wire `SCPIndexer.sync()` into a periodic timer or file-watcher so embeddings stay current as the codebase changes.
- [ ] **Incremental vs full re-index strategy** — The watermark approach works for appends but doesn't handle deleted/renamed symbols. Add a tombstone or diff-based reconciliation step.

## 3. VS Code extension (`scp-vscode`)

Scaffolded and compiles, but needs significant work before it's usable.

- [ ] **Tests** — Zero test coverage. Add unit tests for `ide-collector.ts`, `config.ts`, `orchestrator.ts` (mock `vscode` API).
- [ ] **End-to-end wiring** — The extension collects a `ContextPayload` and logs it to an output channel. It doesn't actually run the pruner or intercept SDL-MCP slices. Wire it to `SCPMiddleware.intercept()`.
- [ ] **Node ID mapping** — `filePathToNodeId()` currently returns the relative file path. This needs to map to actual SDL-MCP symbol IDs (e.g., `class:AuthService` not `src/auth/service.ts`). Requires access to the SDL-MCP ledger's file-to-symbol index.
- [ ] **Secret management UX** — API tokens (Jira, ADO, GitHub) are stored in VS Code's `SecretStorage`, but there's no UI for entering them. Add commands like `scp.setJiraToken` that prompt the user and persist via `secrets.store()`.
- [ ] **Status bar** — Add a status bar item showing SCP state (active/inactive, last prune stats, token savings).
- [ ] **Configuration validation** — `loadWorkItemsConfig()` silently returns an empty provider list if config is incomplete. Add warnings when a provider is selected but required fields are missing.
- [ ] **VSIX packaging** — No `vsce` build script or `.vsixmanifest`. Add `vsce package` to scripts and CI.

## 4. Error handling & resilience

Most modules propagate errors unhandled. For a production middleware this needs hardening.

- [ ] **Provider error isolation** — `collectWorkItemContext()` lets a single throwing provider crash the entire collection. Wrap each `provider.resolve()` in try/catch, log the error, and continue to the next provider.
- [ ] **Git command failures** — `collectGitContext()` will throw if any git command fails (e.g., not a git repo, git not installed, detached HEAD). Add graceful degradation that returns a partial `GitContext`.
- [ ] **Embedding failures** — If the embedding API is down, `optimizeSlice()` throws. Add a fallback strategy (e.g., skip scoring, use structural score only, return unpruned slice with a warning).
- [ ] **Timeout handling** — No timeouts on any API call (Jira, ADO, GitHub `fetch()`, embedding API). Add configurable timeouts with `AbortController`.

## 5. Testing gaps

196 tests is a good base, but several areas lack coverage.

- [ ] **VS Code extension tests** — 0 tests. Needs mocked `vscode` API.
- [ ] **Integration tests** — No end-to-end test that wires `IntentTracker` → `SCPMiddleware` → feedback loop across multiple rounds with a realistic graph.
- [ ] **Provider API integration tests** — The `resolve()` tests mock `fetch()`. Add optional integration tests (skipped in CI by default) that hit real Jira/ADO/GitHub sandboxes.
- [ ] **Performance benchmarks** — No benchmarks for large graphs (1000+ nodes). The `O(nodes × facets)` scoring loop and `getBatch()` could become bottlenecks.
- [ ] **Concurrency tests** — No tests for concurrent `sync()` or `intercept()` calls. Could cause watermark races or vector store corruption.

## 6. CI/CD

No CI pipeline exists.

- [ ] **GitHub Actions workflow** — Add `.github/workflows/ci.yml` with: install, build, lint (`tsc --noEmit`), test (`vitest run`), across Node 20+.
- [ ] **PR checks** — Run tests on every PR. Block merge on failure.
- [ ] **npm publish** — Add publish workflow for `@scp/core`, `@scp/git-collector`, `@scp/workitems` to npm.
- [ ] **VSIX publish** — Add publish workflow for the VS Code extension to the marketplace.
- [ ] **Code coverage reporting** — Add `vitest --coverage` and upload to Codecov or similar.

## 7. Performance & scalability

- [ ] **Scoring hot path optimization** — The inner scoring loop does `O(nodes × facets × dims)` work. For large graphs, consider pre-computing facet-node similarities in batches and using SIMD-friendly operations.
- [ ] **Streaming / chunked pruning** — For very large slices (10K+ nodes), process in chunks to avoid blocking the event loop.
- [ ] **Vector store similarity search** — Currently does brute-force `getBatch()` + `cosineSimilarity()`. For production-scale codebases, use approximate nearest neighbor (ANN) search from the vector store directly.
- [ ] **LRU cache for embeddings** — Facet texts repeat across rounds. Cache the `embed()` results.

## 8. API & developer experience

- [ ] **Logging** — No structured logging anywhere. Add a configurable logger (e.g., `debug`, `pino`, or a simple callback) so consumers can observe scoring decisions, cache hits, and API calls.
- [ ] **Scoring explainability** — `ScoredNode` has the composite score but doesn't explain _why_. Add optional detail fields: which facet matched, drift adjustment amount, payload boost source.
- [ ] **Configuration validation** — `SCPConfig` accepts any partial override silently. Validate that thresholds are in [0, 1], alpha + beta = 1, etc.
- [ ] **Telemetry / metrics** — Expose metrics (scoring latency, cache hit rate, prune ratio) for monitoring in production.

## 9. Documentation

- [ ] **CLAUDE.md** — Add a project-level `CLAUDE.md` with build/test commands, architecture notes, and contribution guidelines for AI-assisted development.
- [ ] **Per-package READMEs** — `packages/core`, `packages/git-collector`, `packages/workitems` have no individual README files.
- [ ] **API docs generation** — Add `typedoc` or similar for auto-generated API reference from TSDoc comments.
- [ ] **Architecture decision records** — Document key design choices: why max-score over average, why Rocchio, why the specific default thresholds.

## 10. Future features

- [ ] **Linear provider** — Add a `createLinearProvider()` for Linear issue tracking (common in modern teams).
- [ ] **Agent context auto-capture** — The `AgentContext` (plan step, tool error, scratchpad) requires manual wiring. Build an adapter for common agent frameworks (LangChain, AutoGPT, Claude tool-use).
- [ ] **Adaptive thresholds** — Auto-tune `fullThreshold` and `skeletonThreshold` based on slice size and token budget (e.g., "fit the pruned slice into 8K tokens").
- [ ] **Multi-language embedding** — The heuristic expander is English-centric (conjunction splitting on "and", "but", etc.). Support other languages or use a language-agnostic model.
- [ ] **Persistent feedback** — `IntentTracker` state is in-memory and per-session. Persist feedback history across sessions for long-running tasks.
