import { describe, it, expect } from 'vitest';
import { collectGitContext } from '../src/index.js';
import path from 'node:path';

// These tests run against the actual git repo we're in.
// They verify that collectGitContext integrates correctly with real git.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('collectGitContext (integration)', () => {
  it('returns a branch name', async () => {
    const ctx = await collectGitContext({ repoPath: REPO_ROOT });
    expect(typeof ctx.branch).toBe('string');
    expect(ctx.branch.length).toBeGreaterThan(0);
  });

  it('returns dirtyFiles as an array', async () => {
    const ctx = await collectGitContext({ repoPath: REPO_ROOT });
    expect(Array.isArray(ctx.dirtyFiles)).toBe(true);
  });

  it('returns recentlyChangedFiles as an array', async () => {
    const ctx = await collectGitContext({ repoPath: REPO_ROOT });
    expect(Array.isArray(ctx.recentlyChangedFiles)).toBe(true);
  });

  it('includes conflict detection by default', async () => {
    const ctx = await collectGitContext({ repoPath: REPO_ROOT });
    expect(typeof ctx.isMergeConflict).toBe('boolean');
    expect(Array.isArray(ctx.conflictFiles)).toBe(true);
  });

  it('skips conflict detection when detectConflicts is false', async () => {
    const ctx = await collectGitContext({
      repoPath: REPO_ROOT,
      detectConflicts: false,
    });
    expect(ctx.isMergeConflict).toBeUndefined();
    expect(ctx.conflictFiles).toBeUndefined();
  });

  it('respects recentCommitCount option', async () => {
    const ctx1 = await collectGitContext({
      repoPath: REPO_ROOT,
      recentCommitCount: 1,
    });
    const ctx5 = await collectGitContext({
      repoPath: REPO_ROOT,
      recentCommitCount: 5,
    });
    // With more commits, we should have at least as many (or more) changed files
    expect(ctx5.recentlyChangedFiles.length).toBeGreaterThanOrEqual(
      ctx1.recentlyChangedFiles.length,
    );
  });
});
