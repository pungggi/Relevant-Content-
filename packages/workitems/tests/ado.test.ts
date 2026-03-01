import { describe, it, expect } from 'vitest';
import { extractAdoId } from '../src/providers/ado.js';

describe('extractAdoId', () => {
  it('extracts from AB# pattern', () => {
    expect(extractAdoId('feature/AB#456-fix-login')).toBe('456');
  });

  it('is case-insensitive for AB# pattern', () => {
    expect(extractAdoId('bugfix/ab#789-stuff')).toBe('789');
  });

  it('extracts numeric ID after feature/ prefix', () => {
    expect(extractAdoId('feature/123-add-caching')).toBe('123');
  });

  it('extracts numeric ID after bugfix/ prefix', () => {
    expect(extractAdoId('bugfix/999-hotfix')).toBe('999');
  });

  it('extracts numeric ID after task/ prefix', () => {
    expect(extractAdoId('task/42-update-docs')).toBe('42');
  });

  it('returns null for branch with no ID pattern', () => {
    expect(extractAdoId('main')).toBeNull();
    expect(extractAdoId('develop')).toBeNull();
    expect(extractAdoId('release/v2.0')).toBeNull();
  });

  it('prefers AB# pattern over prefix-based pattern', () => {
    expect(extractAdoId('feature/AB#100-thing')).toBe('100');
  });
});
