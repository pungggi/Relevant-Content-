import type { IntentFacet } from '../types/index.js';

/**
 * Contract for a facet extractor.
 *
 * In production you would implement this with an LLM call
 * ("decompose this task into independent sub-intents") or a
 * keyword-extraction model.  The default implementation uses
 * lightweight heuristics that work without any external API.
 */
export type ExpandFn = (query: string) => Promise<IntentFacet[]>;

/**
 * Heuristic query expander — no external dependencies.
 *
 * Decomposes a user prompt into multiple facets by:
 *   1. Keeping the original query as the primary facet (weight 1.0).
 *   2. Extracting noun-phrase-like chunks as secondary facets.
 *   3. Isolating quoted strings, CamelCase identifiers, and
 *      dot-separated paths as high-signal facets.
 *
 * This is intentionally simple.  Swap in an LLM-backed expander
 * via the `ExpandFn` contract for stronger decomposition.
 */
export function createHeuristicExpander(): ExpandFn {
  return async (query: string): Promise<IntentFacet[]> => {
    const facets: IntentFacet[] = [];

    // ── Facet 0: the raw query is always the primary facet ─────────
    facets.push({ text: query, weight: 1.0 });

    // ── Facet group 1: quoted strings ─────────────────────────────
    const quoted = query.match(/"([^"]+)"|'([^']+)'/g);
    if (quoted) {
      for (const q of quoted) {
        const inner = q.slice(1, -1);
        if (inner.length > 2) {
          facets.push({ text: inner, weight: 0.95 });
        }
      }
    }

    // ── Facet group 2: CamelCase / PascalCase identifiers ─────────
    const identifiers = query.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
    if (identifiers) {
      for (const id of new Set(identifiers)) {
        // Expand CamelCase → space-separated words for embedding
        const expanded = id.replace(/([a-z])([A-Z])/g, '$1 $2');
        facets.push({ text: expanded, weight: 0.9 });
      }
    }

    // ── Facet group 3: dot-paths (e.g. auth.service.verify) ───────
    const dotPaths = query.match(/\b[\w]+(?:\.[\w]+){1,}\b/g);
    if (dotPaths) {
      for (const dp of new Set(dotPaths)) {
        facets.push({ text: dp.replace(/\./g, ' '), weight: 0.85 });
      }
    }

    // ── Facet group 4: clause splitting on conjunctions ───────────
    // "fix the auth bug and update the expiration logic"
    //   → "fix the auth bug", "update the expiration logic"
    const clauses = query
      .split(/\b(?:and|but|then|also|while|after|before)\b/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 5 && s !== query);

    for (const clause of clauses) {
      facets.push({ text: clause, weight: 0.8 });
    }

    return dedup(facets);
  };
}

/**
 * LLM-backed expander contract.
 *
 * Pass a function that calls your LLM of choice with a system prompt
 * like "Decompose this user task into 3–5 independent sub-intents.
 * Return JSON array of { text, weight }."
 */
export function createLLMExpander(
  llmCall: (prompt: string) => Promise<IntentFacet[]>,
): ExpandFn {
  return async (query: string): Promise<IntentFacet[]> => {
    const llmFacets = await llmCall(query);
    // Always include the raw query as primary facet
    return dedup([{ text: query, weight: 1.0 }, ...llmFacets]);
  };
}

/** Remove facets whose text is a substring of another higher-weight facet. */
function dedup(facets: IntentFacet[]): IntentFacet[] {
  // Sort descending by weight so the most important survive.
  const sorted = [...facets].sort((a, b) => b.weight - a.weight);
  const seen = new Set<string>();
  const result: IntentFacet[] = [];

  for (const f of sorted) {
    const key = f.text.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(f);
    }
  }

  return result;
}
