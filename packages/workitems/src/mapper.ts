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
