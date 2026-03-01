import type { ExternalContext } from '@scp/core';
import type { WorkItemQuery, WorkItemsConfig } from './types.js';
import { toExternalContext } from './mapper.js';

// Re-export types for consumers
export type { WorkItem, WorkItemQuery, WorkItemProvider, WorkItemsConfig } from './types.js';
export { toExternalContext } from './mapper.js';

// Re-export provider factories and configs
export { createJiraProvider } from './providers/jira.js';
export type { JiraConfig } from './providers/jira.js';
export { createAdoProvider } from './providers/ado.js';
export type { AdoConfig } from './providers/ado.js';
export { createGitHubProvider } from './providers/github.js';
export type { GitHubConfig } from './providers/github.js';

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
