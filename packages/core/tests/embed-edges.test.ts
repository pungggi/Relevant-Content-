import { describe, it, expect } from 'vitest';
import { buildEmbeddingInput, createLocalEmbedder } from '../src/utils/embed.js';

describe('buildEmbeddingInput — edge cases', () => {
  it('returns kind + name when no signature or summary', () => {
    const result = buildEmbeddingInput('myFunc', 'function');
    expect(result).toBe('function myFunc');
  });

  it('handles empty string signature (falsy — excluded)', () => {
    const result = buildEmbeddingInput('myFunc', 'function', '', 'A summary');
    expect(result).toBe('function myFunc\nA summary');
  });

  it('handles empty string summary (falsy — excluded)', () => {
    const result = buildEmbeddingInput('myFunc', 'function', 'sig(): void', '');
    expect(result).toBe('function myFunc\nsig(): void');
  });

  it('includes both signature and summary when present', () => {
    const result = buildEmbeddingInput(
      'myFunc',
      'function',
      'function myFunc(x: number): boolean',
      'Checks if x is positive',
    );
    expect(result).toBe(
      'function myFunc\nfunction myFunc(x: number): boolean\nChecks if x is positive',
    );
  });

  it('handles newlines in signature and summary', () => {
    const result = buildEmbeddingInput(
      'complex',
      'class',
      'class Complex {\n  constructor()\n}',
      'A class that\ndoes things',
    );
    expect(result).toContain('class Complex {\n  constructor()\n}');
    expect(result).toContain('A class that\ndoes things');
  });
});

describe('createLocalEmbedder — edge cases', () => {
  it('produces vectors of the requested dimension', async () => {
    const embed32 = createLocalEmbedder(32);
    const vec = await embed32('test');
    expect(vec.length).toBe(32);

    const embed256 = createLocalEmbedder(256);
    const vec256 = await embed256('test');
    expect(vec256.length).toBe(256);
  });

  it('handles empty string input', async () => {
    const embed = createLocalEmbedder(64);
    const vec = await embed('');

    // Empty string → zero vector (no character contributions, mag is 0)
    // The normalisation check: if mag > 0 normalise, else leave as zeros
    expect(vec.length).toBe(64);
    const allZero = vec.every((v) => v === 0);
    expect(allZero).toBe(true);
  });

  it('handles single character input', async () => {
    const embed = createLocalEmbedder(64);
    const vec = await embed('x');
    expect(vec.length).toBe(64);

    // Should still produce a unit vector (not all zeros)
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1, 5);
  });

  it('different texts produce different vectors', async () => {
    const embed = createLocalEmbedder(128);
    const v1 = await embed('authentication service');
    const v2 = await embed('css grid layout');

    // They should not be identical
    const same = v1.every((val, i) => val === v2[i]);
    expect(same).toBe(false);
  });

  it('is deterministic (same input always yields same output)', async () => {
    const embed = createLocalEmbedder(64);
    const v1 = await embed('deterministic test');
    const v2 = await embed('deterministic test');

    expect(v1).toEqual(v2);
  });
});
