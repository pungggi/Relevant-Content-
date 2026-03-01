import type { WorkItemProvider, WorkItem, WorkItemQuery } from '../types.js';

export interface JiraConfig {
  /** Jira Cloud base URL (e.g. "https://myorg.atlassian.net"). */
  baseUrl: string;
  /** Jira account email for Basic auth. */
  email: string;
  /** Jira API token (https://id.atlassian.com/manage-profile/security/api-tokens). */
  apiToken: string;
  /** Project key (e.g. "PROJ") — helps extract issue ID from branch names. */
  projectKey?: string;
}

/** Extract a Jira issue key from a branch name (e.g. "feat/PROJ-123-foo" → "PROJ-123"). */
export function extractJiraKey(branch: string, projectKey?: string): string | null {
  if (projectKey) {
    const pattern = new RegExp(`(${projectKey}-\\d+)`, 'i');
    const match = branch.match(pattern);
    return match ? match[1].toUpperCase() : null;
  }
  // Fallback: any UPPERCASE-DIGITS pattern
  const match = branch.match(/([A-Z][A-Z0-9]+-\d+)/);
  return match ? match[1] : null;
}

/**
 * Create a Jira work item provider.
 *
 * Uses Jira REST API v3:
 *   GET /rest/api/3/issue/{issueIdOrKey}
 *
 * Branch name parsing: extracts patterns like "PROJ-123" using
 * the configured projectKey, or falls back to any UPPERCASE-DIGITS pattern.
 */
export function createJiraProvider(config: JiraConfig): WorkItemProvider {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');

  return {
    name: 'jira',

    async resolve(query: WorkItemQuery): Promise<WorkItem | null> {
      const issueKey =
        query.itemId ?? (query.branch ? extractJiraKey(query.branch, config.projectKey) : null);
      if (!issueKey) return null;

      const url = `${config.baseUrl}/rest/api/3/issue/${issueKey}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });

      if (!res.ok) return null;

      const data = await res.json() as {
        key: string;
        fields: {
          summary: string;
          description?: { content?: Array<{ content?: Array<{ text?: string }> }> };
          status: { name: string };
          labels: string[];
          assignee?: { displayName: string };
        };
      };

      return {
        id: data.key,
        provider: 'jira',
        title: data.fields.summary,
        description: data.fields.description?.content
          ?.flatMap(block => block.content ?? [])
          .map(inline => inline.text ?? '')
          .join(''),
        status: data.fields.status.name,
        labels: data.fields.labels,
        assignee: data.fields.assignee?.displayName,
      };
    },
  };
}
