import type { ContextPayload } from '@scp/core';
import type { WorkItemsConfig } from '@scp/workitems';
import { collectGitContext } from '@scp/git-collector';
import { collectWorkItemContext } from '@scp/workitems';
import { collectIDEContext } from './ide-collector.js';

/**
 * Build a complete ContextPayload by composing all collectors.
 *
 * This is the single composition point — git and IDE signals are
 * collected in parallel, then the git branch is used to resolve
 * the active work item.
 */
export async function buildContextPayload(
  workspaceRoot: string,
  workItemsConfig: WorkItemsConfig,
): Promise<ContextPayload> {
  // Collect git and IDE signals in parallel
  const [git, ide] = await Promise.all([
    collectGitContext({ repoPath: workspaceRoot }),
    Promise.resolve(collectIDEContext()),
  ]);

  // Use the branch from git to resolve the work item
  const external = await collectWorkItemContext(
    workItemsConfig,
    { branch: git.branch },
  );

  return { ide, git, external };
}
