import { describe, it, expect } from 'vitest';
import { createHeuristicExpander, createLLMExpander } from '../src/core/query-expander.js';

describe('Heuristic expander — edge cases', () => {
  const expand = createHeuristicExpander();

  it('handles empty string query', async () => {
    const facets = await expand('');
    expect(facets.length).toBeGreaterThanOrEqual(1);
    expect(facets[0].text).toBe('');
  });

  it('handles single-word query (no conjunctions, no identifiers)', async () => {
    const facets = await expand('bug');
    expect(facets).toHaveLength(1);
    expect(facets[0].text).toBe('bug');
    expect(facets[0].weight).toBe(1.0);
  });

  it('does not split conjunctions inside quoted strings', async () => {
    const facets = await expand('"before and after" should remain intact');
    const quotedFacet = facets.find((f) => f.text === 'before and after');
    expect(quotedFacet).toBeDefined();
    expect(quotedFacet!.weight).toBe(0.95);
  });

  it('extracts single-quoted strings', async () => {
    const facets = await expand("fix the 'user authentication' flow");
    const singleQuoted = facets.find((f) => f.text === 'user authentication');
    expect(singleQuoted).toBeDefined();
    expect(singleQuoted!.weight).toBe(0.95);
  });

  it('ignores very short quoted strings (<= 2 chars)', async () => {
    const facets = await expand('fix "ab" in the code');
    const shortQuoted = facets.find((f) => f.text === 'ab');
    expect(shortQuoted).toBeUndefined();
  });

  it('extracts multiple CamelCase identifiers and deduplicates', async () => {
    const facets = await expand(
      'Update AuthService and AuthService handler with UserProfile',
    );
    const authFacets = facets.filter((f) => f.text === 'Auth Service');
    expect(authFacets.length).toBe(1); // deduplicated
    const userFacet = facets.find((f) => f.text === 'User Profile');
    expect(userFacet).toBeDefined();
  });

  it('extracts dot-paths with multiple segments', async () => {
    const facets = await expand('look at auth.service.verify.token');
    const dotFacet = facets.find((f) => f.text === 'auth service verify token');
    expect(dotFacet).toBeDefined();
    expect(dotFacet!.weight).toBe(0.85);
  });

  it('splits on multiple conjunctions', async () => {
    const facets = await expand(
      'fix the auth bug and update the cache then deploy to staging',
    );
    const clauses = facets.filter((f) => f.weight === 0.8);
    expect(clauses.length).toBeGreaterThanOrEqual(2);
  });

  it('conjunction at start of query still produces valid clauses', async () => {
    const facets = await expand('and update the authentication module');
    // The first clause before "and" would be empty/short and filtered out
    const clauses = facets.filter((f) => f.weight === 0.8);
    expect(clauses.length).toBeGreaterThanOrEqual(1);
    expect(clauses[0].text).toContain('update the authentication module');
  });

  it('deduplicates facets with same text (case-insensitive)', async () => {
    const facets = await expand('"Fix Auth" fix auth');
    const texts = facets.map((f) => f.text.toLowerCase().trim());
    const unique = new Set(texts);
    expect(texts.length).toBe(unique.size);
  });
});

describe('LLM expander — edge cases', () => {
  it('always includes the raw query as primary facet', async () => {
    const llmCall = async () => [
      { text: 'sub-intent A', weight: 0.9 },
      { text: 'sub-intent B', weight: 0.8 },
    ];

    const expand = createLLMExpander(llmCall);
    const facets = await expand('fix the auth bug');

    expect(facets[0].text).toBe('fix the auth bug');
    expect(facets[0].weight).toBe(1.0);
    expect(facets.length).toBe(3);
  });

  it('deduplicates LLM facets that match the raw query', async () => {
    const llmCall = async () => [
      { text: 'fix the auth bug', weight: 0.9 }, // same as query
      { text: 'authentication error', weight: 0.7 },
    ];

    const expand = createLLMExpander(llmCall);
    const facets = await expand('fix the auth bug');

    const queryFacets = facets.filter(
      (f) => f.text.toLowerCase() === 'fix the auth bug',
    );
    expect(queryFacets.length).toBe(1);
  });

  it('propagates LLM call errors', async () => {
    const llmCall = async () => {
      throw new Error('LLM API timeout');
    };

    const expand = createLLMExpander(llmCall);
    await expect(expand('query')).rejects.toThrow('LLM API timeout');
  });
});
