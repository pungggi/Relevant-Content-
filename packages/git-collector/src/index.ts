import type { GitContext } from '@scp/core';
import { git } from './executor.js';
import { parseFileList, parseUnmergedFiles } from './parsers.js';

export interface GitCollectorOptions {
  /** Absolute path to the git repository root. */
  repoPath: string;
  /** Number of recent commits to scan for changed files (default: 3). */
  recentCommitCount?: number;
  /** Include conflict detection (default: true). */
  detectConflicts?: boolean;
}

/**
 * Collect git signals from a local repository.
 *
 * Shells out to `git` — requires git to be on PATH.
 * Returns a fully populated GitContext ready for SCP's ContextPayload.
 */
export async function collectGitContext(
  opts: GitCollectorOptions,
): Promise<GitContext> {
  const branch = await getBranch(opts.repoPath);
  const dirtyFiles = await getDirtyFiles(opts.repoPath);
  const recentlyChangedFiles = await getRecentlyChanged(
    opts.repoPath,
    opts.recentCommitCount ?? 3,
  );

  const result: GitContext = { branch, dirtyFiles, recentlyChangedFiles };

  if (opts.detectConflicts !== false) {
    const { isMergeConflict, conflictFiles } = await getConflictState(opts.repoPath);
    result.isMergeConflict = isMergeConflict;
    result.conflictFiles = conflictFiles;
  }

  return result;
}

async function getBranch(cwd: string): Promise<string> {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

async function getDirtyFiles(cwd: string): Promise<string[]> {
  const [unstaged, staged] = await Promise.all([
    git(['diff', '--name-only'], cwd),
    git(['diff', '--cached', '--name-only'], cwd),
  ]);
  return parseFileList(`${unstaged}\n${staged}`);
}

async function getRecentlyChanged(cwd: string, commitCount: number): Promise<string[]> {
  const output = await git(
    ['log', `-${commitCount}`, '--name-only', '--format='],
    cwd,
  );
  return parseFileList(output);
}

async function getConflictState(cwd: string): Promise<{
  isMergeConflict: boolean;
  conflictFiles: string[];
}> {
  const output = await git(['ls-files', '--unmerged'], cwd);
  const conflictFiles = parseUnmergedFiles(output);
  return {
    isMergeConflict: conflictFiles.length > 0,
    conflictFiles,
  };
}

// Re-export parsers for direct use
export { parseFileList, parseUnmergedFiles } from './parsers.js';
export { git } from './executor.js';
