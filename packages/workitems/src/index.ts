import type { ExternalContext } from '@scp/core';
import type { WorkItem, WorkItemQuery } from './types.js';
import { toExternalContext } from './mapper.js';

// Re-export types for consumers
export type { WorkItem, WorkItemQuery } from './types.js';
export { toExternalContext } from './mapper.js';

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
