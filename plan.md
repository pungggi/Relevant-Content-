# SCP Monorepo Conversion Plan

> Convert the single-package `semantic-context-pruner` into an npm workspaces monorepo with four packages.

## Target Package Map

| Package | npm name | Purpose |
|---------|----------|---------|
| `packages/core` | `@scp/core` | Scoring engine, types, pruner, intent tracker, vector utils |
| `packages/git-collector` | `@scp/git-collector` | Collects `GitContext` from local git repos |
| `packages/workitems` | `@scp/workitems` | Collects `ExternalContext` from Jira, Azure DevOps, GitHub Issues |
| `packages/vscode` | `@scp/vscode` | VS Code extension — IDE collector + orchestrator |

### Dependency Graph

```
                    @scp/core
                (types + scoring engine)
                  ▲       ▲       ▲
                  │       │       │
    ┌─────────────┤       │       ├──────────────┐
    │             │       │       │              │
@scp/git-collector  @scp/workitems         @scp/vscode
  (git signals)    (Jira, ADO, GitHub)   (IDE + orchestrator)
                                              │
                              ┌───────────────┤
                              │               │
                        uses git-collector  uses workitems
```

All dependency arrows point **toward** `@scp/core`. The VS Code extension is the only package that depends on all three others.

---

## Phase 1 — Scaffold the monorepo root

### 1.1 Create root workspace config

npm workspaces are configured entirely via the `"workspaces"` field in the root `package.json` — no extra config files needed.

**`package.json`** (replace current root):
```json
{
  "name": "scp-monorepo",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "clean": "npm run clean --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  },
  "engines": {
    "node": ">=20"
  }
}
```

> **Note:** `--if-present` prevents npm from failing when a workspace doesn't define that script (e.g. `@scp/vscode` has no `test` script).

### 1.2 Create shared tsconfig base

**`tsconfig.base.json`** (new at root):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

### 1.3 Update `.gitignore`

```gitignore
node_modules/
dist/
*.tsbuildinfo
```

---

## Phase 2 — Move existing code into `packages/core`

### 2.1 Create directory and move files

```powershell
mkdir packages\core
move src packages\core\src
move tests packages\core\tests
move vitest.config.ts packages\core\vitest.config.ts
```

### 2.2 `packages/core/package.json`

```json
{
  "name": "@scp/core",
  "version": "0.1.0",
  "description": "Semantic Context Pruner — scoring engine, types, and pruning middleware for SDL-MCP.",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit",
    "clean": "rimraf dist *.tsbuildinfo"
  },
  "keywords": ["sdl-mcp", "semantic-pruning", "context", "llm", "graph"],
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.11.0"
  }
}
```

### 2.3 `packages/core/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 2.4 `packages/core/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

### 2.5 Delete old root files

Remove the old root-level files that are now replaced:
- `tsconfig.json` (will be replaced by references-only version in Phase 6)
- `vitest.config.ts` (moved into `packages/core/`)

> **IMPORTANT:** After this phase, run `npm install && npm run build && npm run test` to verify nothing broke. All 10 existing test files must pass.

> **TIP:** Commit here. Then proceed with Phases 3–5 as separate commits so you can bisect if anything breaks.

---

## Phase 3 — Create `packages/git-collector`

### 3.1 Directory structure

```
packages/git-collector/
├── src/
│   ├── index.ts          ← public API: collectGitContext(), re-exports
│   ├── executor.ts       ← shell exec helper (runs git commands)
│   └── parsers.ts        ← parse git output into GitContext fields
├── tests/
│   ├── collector.test.ts
│   └── parsers.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 3.2 `packages/git-collector/package.json`

```json
{
  "name": "@scp/git-collector",
  "version": "0.1.0",
  "description": "Git signal collector for SCP — extracts branch, dirty files, recent changes into GitContext.",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "lint": "tsc --noEmit",
    "clean": "rimraf dist *.tsbuildinfo"
  },
  "license": "MIT",
  "dependencies": {
    "@scp/core": "*"
  },
  "devDependencies": {
    "@types/node": "^20.11.0"
  }
}
```

> **Note:** `"@scp/core": "*"` — npm workspaces will automatically resolve this to the local `packages/core` package via symlink. No registry lookups.

### 3.3 `packages/git-collector/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "references": [
    { "path": "../core" }
  ],
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 3.4 Public API design

```typescript
// src/index.ts
import type { GitContext } from '@scp/core';

export interface GitCollectorOptions {
  /** Absolute path to the git repository root. */
  repoPath: string;
  /** Number of recent commits to scan for changed files (default: 3). */
  recentCommitCount?: number;
  /** Include conflict detection (default: true). */
  detectConflicts?: boolean;
}

/**
 * Collect git signals from a local repository.
 *
 * Shells out to `git` — requires git to be on PATH.
 * Returns a fully populated GitContext ready for SCP's ContextPayload.
 */
export async function collectGitContext(
  opts: GitCollectorOptions,
): Promise<GitContext> {
  const branch = await getBranch(opts.repoPath);
  const dirtyFiles = await getDirtyFiles(opts.repoPath);
  const recentlyChangedFiles = await getRecentlyChanged(
    opts.repoPath,
    opts.recentCommitCount ?? 3,
  );

  const result: GitContext = { branch, dirtyFiles, recentlyChangedFiles };

  if (opts.detectConflicts !== false) {
    const { isMergeConflict, conflictFiles } = await getConflictState(opts.repoPath);
    result.isMergeConflict = isMergeConflict;
    result.conflictFiles = conflictFiles;
  }

  return result;
}
```

### 3.5 Signals to collect

| Signal | Git command | Maps to |
|--------|-----------|---------|
| Branch name | `git rev-parse --abbrev-ref HEAD` | `GitContext.branch` |
| Dirty files (unstaged) | `git diff --name-only` | `GitContext.dirtyFiles` |
| Dirty files (staged) | `git diff --cached --name-only` | `GitContext.dirtyFiles` (merged) |
| Recently changed | `git log -N --name-only --format=""` | `GitContext.recentlyChangedFiles` |
| Merge conflict state | `git ls-files --unmerged` | `GitContext.isMergeConflict` |
| Conflict files | parse unmerged output (unique file paths) | `GitContext.conflictFiles` |

### 3.6 Internal modules

**`executor.ts`** — thin wrapper around `child_process.execFile`:
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Execute a git command and return trimmed stdout.
 * Throws on non-zero exit code.
 */
export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}
```

**`parsers.ts`** — pure functions that parse git output:
```typescript
/** Split newline-separated output into unique non-empty file paths. */
export function parseFileList(output: string): string[] {
  return [...new Set(
    output.split('\n').map(l => l.trim()).filter(Boolean)
  )];
}

/** Parse `git ls-files --unmerged` output into conflict file paths. */
export function parseUnmergedFiles(output: string): string[] {
  // Each line: <mode> <hash> <stage>\t<path>
  const paths = output
    .split('\n')
    .filter(Boolean)
    .map(line => line.split('\t')[1])
    .filter((p): p is string => p !== undefined);
  return [...new Set(paths)];
}
```

---

## Phase 4 — Create `packages/workitems`

### 4.1 Directory structure

```
packages/workitems/
├── src/
│   ├── index.ts              ← public API + WorkItemProvider interface
│   ├── types.ts              ← WorkItem, WorkItemQuery
│   ├── providers/
│   │   ├── jira.ts           ← JiraProvider implements WorkItemProvider
│   │   ├── ado.ts            ← AdoProvider  implements WorkItemProvider
│   │   └── github.ts         ← GitHubProvider implements WorkItemProvider
│   └── mapper.ts             ← maps WorkItem → ExternalContext
├── tests/
│   ├── mapper.test.ts
│   ├── jira.test.ts
│   ├── ado.test.ts
│   └── github.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 4.2 `packages/workitems/package.json`

```json
{
  "name": "@scp/workitems",
  "version": "0.1.0",
  "description": "Work item collector for SCP — pulls issues/tasks from Jira, Azure DevOps, and GitHub into ExternalContext.",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "lint": "tsc --noEmit",
    "clean": "rimraf dist *.tsbuildinfo"
  },
  "license": "MIT",
  "dependencies": {
    "@scp/core": "*"
  },
  "devDependencies": {
    "@types/node": "^20.11.0"
  }
}
```

> **Note:** No hard dependency on Jira/ADO/GitHub SDKs — each provider uses plain `fetch()` against their REST APIs to keep the package lightweight. Users only configure the providers they use.

### 4.3 `packages/workitems/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "references": [
    { "path": "../core" }
  ],
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 4.4 Core abstractions

**`src/types.ts`** — normalised work item model:
```typescript
/** Normalised work item across all providers. */
export interface WorkItem {
  /** Provider-specific ID (e.g. "PROJ-123", "456", "#789"). */
  id: string;
  /** Which provider resolved this item. */
  provider: 'jira' | 'ado' | 'github';
  /** Issue/task title. */
  title: string;
  /** Full description or body text (may be truncated). */
  description?: string;
  /** Current status (e.g. "In Progress", "Active", "open"). */
  status: string;
  /** Tags / labels attached to the item. */
  labels: string[];
  /** Assigned user (display name). */
  assignee?: string;
  /** Linked test names or test plan references (if available). */
  linkedTests?: string[];
}

/** Query to find the active work item(s) for the current context. */
export interface WorkItemQuery {
  /** Git branch name — providers will try to extract an item ID from it.
   *  e.g. "feat/PROJ-123-add-caching" → extracts "PROJ-123" for Jira. */
  branch?: string;
  /** Explicit work item ID (e.g. "PROJ-123", "AB#456", "#789"). */
  itemId?: string;
}
```

**`src/index.ts`** — public API surface:
```typescript
import type { ExternalContext } from '@scp/core';
import type { WorkItem, WorkItemQuery } from './types.js';
import { toExternalContext } from './mapper.js';

// Re-export types for consumers
export type { WorkItem, WorkItemQuery } from './types.js';

/**
 * Contract every work item provider must satisfy.
 * Each provider handles auth and API differences internally.
 */
export interface WorkItemProvider {
  readonly name: 'jira' | 'ado' | 'github';

  /**
   * Attempt to resolve the active work item from contextual hints.
   * Returns null if no matching item is found.
   */
  resolve(query: WorkItemQuery): Promise<WorkItem | null>;
}

/** Configuration for the work item collector. */
export interface WorkItemsConfig {
  /** Providers to try, in priority order. First match wins. */
  providers: WorkItemProvider[];
}

/**
 * Collect work item context from configured providers.
 *
 * Tries each provider in order with the given query.
 * Returns the first successful match mapped to ExternalContext.
 * Returns an empty ExternalContext if no provider resolves.
 */
export async function collectWorkItemContext(
  config: WorkItemsConfig,
  query: WorkItemQuery,
): Promise<ExternalContext> {
  for (const provider of config.providers) {
    const item = await provider.resolve(query);
    if (item) {
      return toExternalContext(item);
    }
  }
  return {};
}
```

### 4.5 Provider configurations and factories

```typescript
// ── Jira ─────────────────────────────────────────────
// src/providers/jira.ts

export interface JiraConfig {
  /** Jira Cloud base URL (e.g. "https://myorg.atlassian.net"). */
  baseUrl: string;
  /** Jira account email for Basic auth. */
  email: string;
  /** Jira API token (https://id.atlassian.com/manage-profile/security/api-tokens). */
  apiToken: string;
  /** Project key (e.g. "PROJ") — helps extract issue ID from branch names. */
  projectKey?: string;
}

/**
 * Create a Jira work item provider.
 *
 * Uses Jira REST API v3:
 *   GET /rest/api/3/issue/{issueIdOrKey}
 *
 * Branch name parsing: extracts patterns like "PROJ-123" using
 * the configured projectKey, or falls back to any UPPERCASE-DIGITS pattern.
 */
export function createJiraProvider(config: JiraConfig): WorkItemProvider;


// ── Azure DevOps ─────────────────────────────────────
// src/providers/ado.ts

export interface AdoConfig {
  /** Azure DevOps organisation URL (e.g. "https://dev.azure.com/myorg"). */
  orgUrl: string;
  /** Project name within the organisation. */
  project: string;
  /** Personal Access Token with "Work Items (Read)" scope. */
  pat: string;
}

/**
 * Create an Azure DevOps work item provider.
 *
 * Uses ADO REST API:
 *   GET {orgUrl}/{project}/_apis/wit/workitems/{id}?api-version=7.1
 *
 * Branch name parsing: extracts "AB#123" patterns or plain
 * numeric IDs after common prefixes (feature/, bugfix/, etc.).
 */
export function createAdoProvider(config: AdoConfig): WorkItemProvider;


// ── GitHub Issues ────────────────────────────────────
// src/providers/github.ts

export interface GitHubConfig {
  /** Repository owner (user or organisation). */
  owner: string;
  /** Repository name. */
  repo: string;
  /** GitHub PAT or fine-grained token with "Issues: Read" permission. */
  token: string;
}

/**
 * Create a GitHub Issues work item provider.
 *
 * Uses GitHub REST API:
 *   GET /repos/{owner}/{repo}/issues/{issue_number}
 *
 * Branch name parsing: extracts "#123" or "issue-123" patterns.
 */
export function createGitHubProvider(config: GitHubConfig): WorkItemProvider;
```

### 4.6 Mapping: WorkItem → ExternalContext

```typescript
// src/mapper.ts
import type { ExternalContext } from '@scp/core';
import type { WorkItem } from './types.js';

/**
 * Convert a resolved WorkItem into SCP's ExternalContext.
 *
 * Mapping:
 *   - title + description → issueDescription (becomes synthetic facet @ 0.8w in pruner)
 *   - linkedTests         → failingTestNames  (becomes synthetic facets @ 0.9w each)
 */
export function toExternalContext(item: WorkItem): ExternalContext {
  return {
    issueDescription: item.description
      ? `${item.title}: ${item.description}`
      : item.title,
    failingTestNames: item.linkedTests,
  };
}
```

---

## Phase 5 — Create `packages/vscode`

### 5.1 Directory structure

```
packages/vscode/
├── src/
│   ├── extension.ts          ← activate() / deactivate()
│   ├── ide-collector.ts      ← collectIDEContext() using vscode API
│   ├── orchestrator.ts       ← composes all signals, calls scp.intercept()
│   └── config.ts             ← reads extension settings (tokens, URLs)
├── package.json              ← VS Code extension manifest
├── tsconfig.json
└── .vscodeignore
```

### 5.2 `packages/vscode/package.json` (VS Code extension manifest)

```json
{
  "name": "scp-vscode",
  "displayName": "SCP — Semantic Context Pruner",
  "version": "0.1.0",
  "description": "VS Code extension that feeds IDE, Git, and work item signals into SCP for intelligent context pruning.",
  "publisher": "scp",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "dist/extension.js",
  "scripts": {
    "build": "tsc -b",
    "lint": "tsc --noEmit",
    "package": "vsce package",
    "clean": "rimraf dist *.tsbuildinfo"
  },
  "dependencies": {
    "@scp/core": "*",
    "@scp/git-collector": "*",
    "@scp/workitems": "*"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^20.11.0"
  },
  "contributes": {
    "configuration": {
      "title": "SCP",
      "properties": {
        "scp.workitems.provider": {
          "type": "string",
          "enum": ["jira", "ado", "github", "none"],
          "default": "none",
          "description": "Which work item provider to use."
        },
        "scp.workitems.jira.baseUrl": {
          "type": "string",
          "description": "Jira base URL (e.g. https://myorg.atlassian.net)"
        },
        "scp.workitems.jira.email": {
          "type": "string",
          "description": "Jira account email"
        },
        "scp.workitems.ado.orgUrl": {
          "type": "string",
          "description": "Azure DevOps org URL"
        },
        "scp.workitems.ado.project": {
          "type": "string",
          "description": "Azure DevOps project name"
        },
        "scp.workitems.github.owner": {
          "type": "string",
          "description": "GitHub repository owner"
        },
        "scp.workitems.github.repo": {
          "type": "string",
          "description": "GitHub repository name"
        }
      }
    }
  }
}
```

> **Note:** Secrets (API tokens, PATs) should be stored via VS Code's `SecretStorage` API, NOT in settings. The extension's `config.ts` module should handle reading tokens from `context.secrets.get(...)`.

### 5.3 `packages/vscode/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "references": [
    { "path": "../core" },
    { "path": "../git-collector" },
    { "path": "../workitems" }
  ],
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### 5.4 IDE collector — signals to gather

| Signal | VS Code API | Maps to |
|--------|------------|---------|
| Active file symbol | `vscode.window.activeTextEditor` | `IDEContext.activeNodeId` |
| Open tabs | `vscode.window.tabGroups.all` | `IDEContext.openTabNodeIds` |
| Breakpoints | `vscode.debug.breakpoints` | `IDEContext.breakpointNodeIds` |
| Visible lines | `editor.visibleRanges` | `IDEContext.visibleFiles` |
| Diagnostics | `vscode.languages.getDiagnostics()` | `IDEContext.diagnostics` |

```typescript
// src/ide-collector.ts
import * as vscode from 'vscode';
import type { IDEContext } from '@scp/core';

/**
 * Collect IDE telemetry signals from the current VS Code state.
 *
 * This function is synchronous — all data comes from VS Code's
 * in-memory state, no async IO needed.
 */
export function collectIDEContext(): IDEContext {
  const editor = vscode.window.activeTextEditor;

  // Active file → activeNodeId
  const activeNodeId = editor
    ? filePathToNodeId(editor.document.uri.fsPath)
    : undefined;

  // Open tabs → openTabNodeIds
  const openTabNodeIds = vscode.window.tabGroups.all
    .flatMap(group => group.tabs)
    .map(tab => {
      const uri = (tab.input as { uri?: vscode.Uri })?.uri;
      return uri ? filePathToNodeId(uri.fsPath) : null;
    })
    .filter((id): id is string => id !== null);

  // Breakpoints → breakpointNodeIds
  const breakpointNodeIds = vscode.debug.breakpoints
    .filter((bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint)
    .map(bp => filePathToNodeId(bp.location.uri.fsPath));

  // Visible files
  const visibleFiles = vscode.window.visibleTextEditors
    .map(e => e.document.uri.fsPath);

  // Diagnostics (errors and warnings only)
  const diagnostics = vscode.languages.getDiagnostics()
    .flatMap(([uri, diags]) =>
      diags
        .filter(d => d.severity <= vscode.DiagnosticSeverity.Warning)
        .map(d => ({
          nodeId: filePathToNodeId(uri.fsPath),
          message: d.message,
        }))
    );

  return { activeNodeId, openTabNodeIds, breakpointNodeIds, visibleFiles, diagnostics };
}

/** Convert a file path to an SDL-MCP node ID format. */
function filePathToNodeId(fsPath: string): string {
  // TODO: map file paths to SDL-MCP symbol IDs via the ledger
  // For now, use the workspace-relative path as a placeholder
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    return vscode.workspace.asRelativePath(fsPath);
  }
  return fsPath;
}
```

### 5.5 Orchestrator — the composition point

```typescript
// src/orchestrator.ts
import type { ContextPayload } from '@scp/core';
import type { WorkItemsConfig } from '@scp/workitems';
import { collectGitContext } from '@scp/git-collector';
import { collectWorkItemContext } from '@scp/workitems';
import { collectIDEContext } from './ide-collector.js';

/**
 * Build a complete ContextPayload by composing all collectors.
 *
 * This is the single composition point — git and IDE signals are
 * collected in parallel, then the git branch is used to resolve
 * the active work item.
 */
export async function buildContextPayload(
  workspaceRoot: string,
  workItemsConfig: WorkItemsConfig,
): Promise<ContextPayload> {
  // Collect git and IDE signals in parallel
  const [git, ide] = await Promise.all([
    collectGitContext({ repoPath: workspaceRoot }),
    Promise.resolve(collectIDEContext()),
  ]);

  // Use the branch from git to resolve the work item
  const external = await collectWorkItemContext(
    workItemsConfig,
    { branch: git.branch },
  );

  return { ide, git, external };
}
```

### 5.6 `.vscodeignore`

```
src/
tests/
tsconfig.json
tsconfig.base.json
*.tsbuildinfo
node_modules/
```

---

## Phase 6 — Wire it all up

### 6.1 Build order (managed by npm workspaces + `tsc -b`)

npm workspaces automatically resolve local packages by matching the `"name"` field. When you run `npm install` at the root, npm symlinks workspace packages into each other's `node_modules`.

```
@scp/core           ← builds first (no deps)
    ↓
@scp/git-collector   ← depends on core
@scp/workitems       ← depends on core
    ↓
@scp/vscode          ← depends on all three
```

Useful commands:
- Build everything: `npm run build`
- Build one package: `npm run build --workspace=packages/core`
- Test one package: `npm run test --workspace=packages/git-collector`
- Install: `npm install` (from root — handles all workspaces)

### 6.2 Root-level tsconfig for project references

**`tsconfig.json`** (root — references only, no compilation):
```json
{
  "files": [],
  "references": [
    { "path": "packages/core" },
    { "path": "packages/git-collector" },
    { "path": "packages/workitems" },
    { "path": "packages/vscode" }
  ]
}
```

This enables `tsc -b` from the root to build all packages in dependency order.

### 6.3 Update root `README.md`

Update the README to reflect the monorepo structure. Key changes:
- Installation section → explain workspace packages
- Quick start → import from `@scp/core`, `@scp/git-collector`, `@scp/workitems`
- Add a "Packages" section listing all four packages with links
- Development section → update commands to npm workspaces equivalents

---

## Execution Checklist

| # | Step | Risk | Verify |
|---|------|------|--------|
| 1 | Create root `package.json` with `"workspaces"` + `tsconfig.base.json` | Low | `npm install` succeeds |
| 2 | Move `src/` and `tests/` into `packages/core/` | **Medium** — paths break | All 10 tests pass |
| 3 | Delete root `package-lock.json`, `vitest.config.ts`, old `tsconfig.json` | Low | Clean root |
| 4 | Scaffold `packages/git-collector` with types + `collectGitContext()` | Low | Unit tests pass |
| 5 | Scaffold `packages/workitems` with provider interface + mapper | Low | Unit tests pass |
| 6 | Scaffold `packages/vscode` with extension manifest + IDE collector | **Medium** — vscode API | Extension loads |
| 7 | Verify cross-package imports (workspace symlinks) | Low | `npm run build` from root |
| 8 | Update root `README.md` to reflect monorepo structure | Low | — |

> **WARNING:** Step 2 is the highest-risk step. Moving files could break relative import paths. However, since all internal imports use `./` relative paths within `src/`, and we're moving the entire `src/` directory intact, **no import paths need to change inside `packages/core/`**. The only change is the `tsconfig.json` extending the new base.

> **TIP:** After Phase 2, commit. Then proceed with Phases 3–5 as separate commits so you can bisect if anything breaks.

---

## Final directory tree

```
Relevant-Content-/
├── .gitignore
├── README.md
├── package.json                 ← root workspace (private, "workspaces" field)
├── package-lock.json
├── tsconfig.base.json           ← shared compiler options
├── tsconfig.json                ← project references only
│
└── packages/
    ├── core/                    ← @scp/core
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── core/
    │   │   │   ├── pruner.ts
    │   │   │   ├── intent-tracker.ts
    │   │   │   └── query-expander.ts
    │   │   ├── middleware/
    │   │   │   └── interceptor.ts
    │   │   ├── indexer/
    │   │   │   └── sync.ts
    │   │   ├── types/
    │   │   │   └── index.ts
    │   │   ├── utils/
    │   │   │   └── embed.ts
    │   │   └── vector/
    │   │       ├── in-memory-store.ts
    │   │       └── similarity.ts
    │   ├── tests/               ← all 10 existing test files
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── vitest.config.ts
    │
    ├── git-collector/           ← @scp/git-collector
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── executor.ts
    │   │   └── parsers.ts
    │   ├── tests/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── vitest.config.ts
    │
    ├── workitems/               ← @scp/workitems
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── types.ts
    │   │   ├── mapper.ts
    │   │   └── providers/
    │   │       ├── jira.ts
    │   │       ├── ado.ts
    │   │       └── github.ts
    │   ├── tests/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── vitest.config.ts
    │
    └── vscode/                  ← scp-vscode (extension)
        ├── src/
        │   ├── extension.ts
        │   ├── ide-collector.ts
        │   ├── orchestrator.ts
        │   └── config.ts
        ├── package.json
        ├── tsconfig.json
        └── .vscodeignore
```

---

## Plan Review — Gaps, Errors & Edge Cases

### CRITICAL — Will break the build or tests

#### C1. `rimraf` not in any `devDependencies`
Every package's `"clean"` script uses `rimraf dist *.tsbuildinfo`, but `rimraf` is never listed as a dependency — not at root, not in any package.

**Fix:** Add `"rimraf": "^6.0.0"` to root `devDependencies`, or replace clean scripts with `rm -rf dist *.tsbuildinfo` (works on Windows via Git Bash / npm scripts).

#### C2. `npm run build --workspaces` doesn't guarantee build order
The root script `"build": "npm run build --workspaces"` runs all workspace build scripts, but **npm does not guarantee execution order**. `@scp/git-collector` and `@scp/workitems` may start building before `@scp/core` has emitted its `dist/`.

With `tsc -b`, each package's references *will* trigger core to build first — so it technically works, but core gets built multiple times redundantly. More importantly, the **test** and **lint** scripts have no such safety net.

**Fix:** Change root build script to `"build": "tsc -b"` (uses the root `tsconfig.json` project references from Phase 6.2, builds in correct dependency order, builds each package exactly once). Keep `--workspaces` for `test` and `lint` which are independent per-package.

#### C3. `package-lock.json` handling not in phase instructions
The checklist (step 3) says "Delete root `package-lock.json`" but the actual Phase instructions never mention it. After converting `package.json` to a workspace root, the old lockfile structure is incompatible. Running `npm install` without deleting it first can cause confusing resolution errors.

**Fix:** Add an explicit step in Phase 1 or Phase 2: delete `package-lock.json`, then run `npm install` to regenerate.

---

### HIGH — Won't break immediately but will cause problems

#### H1. VS Code extension needs bundling — workspace symlinks won't work in `.vsix`
`@scp/vscode` depends on `@scp/core`, `@scp/git-collector`, `@scp/workitems` via workspace symlinks. When you run `vsce package` to produce a `.vsix`, those symlinks won't resolve — the extension will fail at runtime.

**Fix:** Add `esbuild` bundling to `@scp/vscode`. Replace the build script with an esbuild step that bundles all workspace dependencies into a single file. Update `"main"` to point at the bundle. The plan's current `"package": "vsce package"` script needs a `prebuild` bundling step.

#### H2. No `"exports"` field in `@scp/core` (or any package)
With `"module": "Node16"` / `"moduleResolution": "Node16"`, TypeScript resolves packages using the `"exports"` field first, falling back to `"main"`. While `"main"` works, adding `"exports"` is recommended for:
- Proper encapsulation (prevents deep imports into `dist/core/pruner.js`)
- Correct dual CJS/ESM support in the future

**Fix:** Add to each package.json:
```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

#### H3. No `"type": "module"` consideration anywhere
The codebase uses `.js` extensions in all imports (ESM-style), but no `package.json` declares `"type": "module"`. With `"module": "Node16"`, TypeScript emits CJS when `"type"` is absent. This works today but:
- Vitest defaults to ESM — the current tests work because vitest transforms the code. If a future consumer uses native Node ESM, they'd hit CJS/ESM interop issues.
- The `.js` extension imports look like ESM but compile to `require()`.

**Fix (optional):** Decide explicitly: either add `"type": "module"` to all packages (and the code genuinely becomes ESM), or document that packages are CJS. Not a blocker, but should be a conscious decision.

---

### MEDIUM — Gaps and missing details

#### M1. Gap between deleting root `tsconfig.json` (Phase 2) and recreating it (Phase 6)
Phase 2.5 says delete root `tsconfig.json`. Phase 6.2 recreates it as a references-only file. Between Phases 2–5, there's no root tsconfig — IDE intellisense at root level won't work and `tsc -b` from root won't work.

**Fix:** Create the root references-only `tsconfig.json` in Phase 2 (just with `packages/core` initially), then add references as packages are created in Phases 3–5.

#### M2. `vitest` and `typescript` only in root `devDependencies` — relies on hoisting
The plan puts `vitest` and `typescript` only at root. Individual packages don't list them. This works via npm hoisting but if a package is ever extracted or published, it won't have its own `vitest`/`typescript`. Some tools (like `npx` in a subdirectory) may not find hoisted binaries.

#### M3. Final directory tree omits existing barrel files
The plan's Phase 2 moves `src/` and `tests/` wholesale. The existing barrel files (`src/core/index.ts`, `src/middleware/index.ts`, `src/vector/index.ts`, `src/utils/index.ts`, `src/indexer/index.ts`) move with them — no issue — but the "Final directory tree" section omits them, which is misleading.

#### M4. Shell commands use PowerShell syntax but environment is Git Bash
Phase 2.1 uses `mkdir packages\core` and `move src packages\core\src`. Should use Unix syntax: `mkdir -p packages/core && mv src packages/core/src`.

---

### LOW — Edge cases and nits

#### L1. `@scp/workitems` providers are stubs
`createJiraProvider`, `createAdoProvider`, `createGitHubProvider` show signatures only (no body). Should be explicitly marked as "stub — implement later".

#### L2. `.vscodeignore` references `tsconfig.base.json`
This file lives at monorepo root, not in `packages/vscode/`. The ignore entry won't match anything. Harmless but misleading.

#### L3. `@scp/vscode` has no `test` script
Handled by `--if-present` on the root test script. Fine for initial scaffold but worth noting.

---

### Review Summary

| Severity | Count | Action needed |
|----------|-------|---------------|
| CRITICAL | 3 | Must fix before executing |
| HIGH | 3 | Should fix, will cause real problems |
| MEDIUM | 4 | Nice to fix, prevents confusion |
| LOW | 3 | Nits, no action required |

> The plan is solid architecturally — the dependency graph, type ownership, and separation of concerns are well thought out. The issues are in **build tooling plumbing** (build order, bundling, missing deps) rather than in the design.
