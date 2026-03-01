import type { IntentContext } from '../src/types/index.js';

/**
 * Build a minimal IntentContext from a query string.
 * Test-only convenience — production callers must construct the full object.
 */
export function intent(
  query: string,
  overrides: Partial<IntentContext> = {},
): IntentContext {
  return {
    query,
    facets: [{ text: query, weight: 1.0 }],
    priorFeedback: [],
    negativeExemplarIds: [],
    ...overrides,
  };
}
