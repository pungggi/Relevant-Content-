import { describe, expect, it } from 'vitest';
import { createHeuristicExpander, createLLMExpander } from '../src/core/query-expander.js';

describe('createHeuristicExpander', () => {
  const expand = createHeuristicExpander();

  it('always includes the original query as primary facet', async () => {
    const facets = await expand('fix the login bug');
    expect(facets[0]).toEqual({ text: 'fix the login bug', weight: 1.0 });
  });

  it('extracts quoted strings as high-weight facets', async () => {
    const facets = await expand('search for "token validator" in auth');
    const quoted = facets.find((f) => f.text === 'token validator');
    expect(quoted).toBeDefined();
    expect(quoted!.weight).toBe(0.95);
  });

  it('extracts CamelCase identifiers as facets', async () => {
    const facets = await expand('update the JwtTokenValidator class');
    const camelFacet = facets.find((f) => f.text === 'Jwt Token Validator');
    expect(camelFacet).toBeDefined();
    expect(camelFacet!.weight).toBe(0.9);
  });

  it('extracts dot-paths as space-separated facets', async () => {
    const facets = await expand('call auth.service.verify to check');
    const dotFacet = facets.find((f) => f.text === 'auth service verify');
    expect(dotFacet).toBeDefined();
    expect(dotFacet!.weight).toBe(0.85);
  });

  it('splits on conjunctions to create clause facets', async () => {
    const facets = await expand('fix the auth bug and update the logging format');
    const clauseFacets = facets.filter((f) => f.weight === 0.8);
    expect(clauseFacets.length).toBeGreaterThanOrEqual(1);
    // One clause should be about auth, the other about logging
    const texts = clauseFacets.map((f) => f.text);
    expect(texts.some((t) => t.includes('auth'))).toBe(true);
  });

  it('deduplicates facets with the same text', async () => {
    const facets = await expand('fix the bug');
    const unique = new Set(facets.map((f) => f.text.toLowerCase().trim()));
    expect(unique.size).toBe(facets.length);
  });

  it('returns only the primary facet for a short simple query', async () => {
    const facets = await expand('hello');
    expect(facets).toEqual([{ text: 'hello', weight: 1.0 }]);
  });
});

describe('createLLMExpander', () => {
  it('wraps an LLM call and prepends the raw query', async () => {
    const mockLLM = async (_prompt: string) => [
      { text: 'sub-intent A', weight: 0.9 },
      { text: 'sub-intent B', weight: 0.8 },
    ];

    const expand = createLLMExpander(mockLLM);
    const facets = await expand('fix the auth bug');

    expect(facets[0]).toEqual({ text: 'fix the auth bug', weight: 1.0 });
    expect(facets).toHaveLength(3);
    expect(facets[1].text).toBe('sub-intent A');
    expect(facets[2].text).toBe('sub-intent B');
  });
});
