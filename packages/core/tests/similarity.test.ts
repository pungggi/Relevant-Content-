import { describe, expect, it } from 'vitest';
import { cosineSimilarity, normalise } from '../src/vector/similarity.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('returns 0 when either vector is zero', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [0, 0])).toBe(0);
  });

  it('throws when dimensions mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(RangeError);
  });
});

describe('normalise', () => {
  it('maps -1 → 0', () => {
    expect(normalise(-1)).toBe(0);
  });

  it('maps 0 → 0.5', () => {
    expect(normalise(0)).toBe(0.5);
  });

  it('maps 1 → 1', () => {
    expect(normalise(1)).toBe(1);
  });

  it('clamps values below -1', () => {
    expect(normalise(-2)).toBe(0);
  });

  it('clamps values above 1', () => {
    expect(normalise(2)).toBe(1);
  });
});
