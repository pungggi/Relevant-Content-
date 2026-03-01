import { describe, it, expect } from 'vitest';
import { extractJiraKey } from '../src/providers/jira.js';

describe('extractJiraKey', () => {
  it('extracts key with known project prefix', () => {
    expect(extractJiraKey('feat/PROJ-123-add-caching', 'PROJ')).toBe('PROJ-123');
  });

  it('is case-insensitive with known project prefix', () => {
    expect(extractJiraKey('bugfix/proj-456-fix', 'PROJ')).toBe('PROJ-456');
  });

  it('extracts any UPPERCASE-DIGITS pattern without project key', () => {
    expect(extractJiraKey('feat/ABC-789-some-thing')).toBe('ABC-789');
  });

  it('returns null for branch with no issue key', () => {
    expect(extractJiraKey('main')).toBeNull();
    expect(extractJiraKey('develop')).toBeNull();
    expect(extractJiraKey('feature/add-logging')).toBeNull();
  });

  it('returns null for lowercase-only patterns without project key', () => {
    expect(extractJiraKey('fix/abc-123')).toBeNull();
  });

  it('handles key at start of branch name', () => {
    expect(extractJiraKey('PROJ-42')).toBe('PROJ-42');
  });

  it('handles branch with multiple potential keys — returns first', () => {
    expect(extractJiraKey('feat/PROJ-100-relates-to-PROJ-200', 'PROJ')).toBe('PROJ-100');
  });
});
