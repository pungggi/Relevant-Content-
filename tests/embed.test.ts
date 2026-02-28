import { describe, expect, it } from 'vitest';
import { buildEmbeddingInput, createLocalEmbedder } from '../src/utils/embed.js';
import { cosineSimilarity } from '../src/vector/similarity.js';

describe('buildEmbeddingInput', () => {
  it('includes kind and name', () => {
    const result = buildEmbeddingInput('doStuff', 'function');
    expect(result).toBe('function doStuff');
  });

  it('appends signature and summary when present', () => {
    const result = buildEmbeddingInput(
      'AuthService',
      'class',
      'class AuthService { verifyToken(t: string): boolean }',
      'Handles JWT token verification and session management',
    );
    expect(result).toContain('class AuthService');
    expect(result).toContain('verifyToken');
    expect(result).toContain('JWT token');
  });
});

describe('createLocalEmbedder', () => {
  const embed = createLocalEmbedder(64);

  it('produces a vector of the requested dimension', async () => {
    const vec = await embed('hello world');
    expect(vec).toHaveLength(64);
  });

  it('produces unit vectors (L2 norm ≈ 1)', async () => {
    const vec = await embed('some text');
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1, 5);
  });

  it('texts sharing character structure are more similar than unrelated ones', async () => {
    // The local embedder uses character-level hashing, so we test
    // structural similarity (shared characters/prefixes), not semantics.
    const a = await embed('function verifyToken(jwt: string)');
    const b = await embed('function verifyToken(token: string)');
    const c = await embed('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');

    const simAB = cosineSimilarity(a, b);
    const simAC = cosineSimilarity(a, c);
    expect(simAB).toBeGreaterThan(simAC);
  });

  it('identical texts produce similarity of 1', async () => {
    const a = await embed('exactly the same');
    const b = await embed('exactly the same');
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });
});
