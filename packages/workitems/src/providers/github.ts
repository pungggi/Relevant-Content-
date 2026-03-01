import type { WorkItemProvider, WorkItem, WorkItemQuery } from '../types.js';

export interface GitHubConfig {
  /** Repository owner (user or organisation). */
  owner: string;
  /** Repository name. */
  repo: string;
  /** GitHub PAT or fine-grained token with "Issues: Read" permission. */
  token: string;
}

/** Extract a GitHub issue number from a branch name (e.g. "fix/issue-42-login" → "42"). */
export function extractGitHubIssueNumber(branch: string): string | null {
  // Match "#123" or "issue-123" patterns
  const hashMatch = branch.match(/#(\d+)/);
  if (hashMatch) return hashMatch[1];
  const issueMatch = branch.match(/issue[/-](\d+)/i);
  return issueMatch ? issueMatch[1] : null;
}

/**
 * Create a GitHub Issues work item provider.
 *
 * Uses GitHub REST API:
 *   GET /repos/{owner}/{repo}/issues/{issue_number}
 *
 * Branch name parsing: extracts "#123" or "issue-123" patterns.
 */
export function createGitHubProvider(config: GitHubConfig): WorkItemProvider {
  return {
    name: 'github',

    async resolve(query: WorkItemQuery): Promise<WorkItem | null> {
      const issueNumber =
        query.itemId ?? (query.branch ? extractGitHubIssueNumber(query.branch) : null);
      if (!issueNumber) return null;

      const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${issueNumber}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!res.ok) return null;

      const data = await res.json() as {
        number: number;
        title: string;
        body?: string;
        state: string;
        labels: Array<{ name: string }>;
        assignee?: { login: string };
      };

      return {
        id: `#${data.number}`,
        provider: 'github',
        title: data.title,
        description: data.body ?? undefined,
        status: data.state,
        labels: data.labels.map(l => l.name),
        assignee: data.assignee?.login,
      };
    },
  };
}
