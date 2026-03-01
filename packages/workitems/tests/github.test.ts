import { describe, it, expect } from 'vitest';
import { extractGitHubIssueNumber } from '../src/providers/github.js';

describe('extractGitHubIssueNumber', () => {
  it('extracts from #123 pattern', () => {
    expect(extractGitHubIssueNumber('fix/#42-login-bug')).toBe('42');
  });

  it('extracts from issue-123 pattern', () => {
    expect(extractGitHubIssueNumber('fix/issue-99-something')).toBe('99');
  });

  it('extracts from issue/123 pattern', () => {
    expect(extractGitHubIssueNumber('fix/issue/101')).toBe('101');
  });

  it('is case-insensitive for issue- pattern', () => {
    expect(extractGitHubIssueNumber('feat/Issue-55-feature')).toBe('55');
  });

  it('returns null for branches without issue references', () => {
    expect(extractGitHubIssueNumber('main')).toBeNull();
    expect(extractGitHubIssueNumber('feature/add-dark-mode')).toBeNull();
    expect(extractGitHubIssueNumber('release/v1.0')).toBeNull();
  });

  it('prefers # pattern over issue- pattern', () => {
    expect(extractGitHubIssueNumber('fix/#10-issue-20')).toBe('10');
  });
});
