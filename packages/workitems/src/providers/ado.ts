import type { WorkItemProvider, WorkItem, WorkItemQuery } from '../types.js';

export interface AdoConfig {
  /** Azure DevOps organisation URL (e.g. "https://dev.azure.com/myorg"). */
  orgUrl: string;
  /** Project name within the organisation. */
  project: string;
  /** Personal Access Token with "Work Items (Read)" scope. */
  pat: string;
}

/** Extract an ADO work item ID from a branch name (e.g. "feature/AB#456-fix" → "456"). */
export function extractAdoId(branch: string): string | null {
  // Match "AB#123" pattern
  const abMatch = branch.match(/AB#(\d+)/i);
  if (abMatch) return abMatch[1];
  // Fallback: numeric ID after common prefixes
  const prefixMatch = branch.match(/(?:feature|bugfix|hotfix|task)\/(\d+)/i);
  return prefixMatch ? prefixMatch[1] : null;
}

/**
 * Create an Azure DevOps work item provider.
 *
 * Uses ADO REST API:
 *   GET {orgUrl}/{project}/_apis/wit/workitems/{id}?api-version=7.1
 *
 * Branch name parsing: extracts "AB#123" patterns or plain
 * numeric IDs after common prefixes (feature/, bugfix/, etc.).
 */
export function createAdoProvider(config: AdoConfig): WorkItemProvider {
  const auth = Buffer.from(`:${config.pat}`).toString('base64');

  return {
    name: 'ado',

    async resolve(query: WorkItemQuery): Promise<WorkItem | null> {
      const itemId =
        query.itemId ?? (query.branch ? extractAdoId(query.branch) : null);
      if (!itemId) return null;

      const url = `${config.orgUrl}/${config.project}/_apis/wit/workitems/${itemId}?api-version=7.1`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });

      if (!res.ok) return null;

      const data = await res.json() as {
        id: number;
        fields: {
          'System.Title': string;
          'System.Description'?: string;
          'System.State': string;
          'System.Tags'?: string;
          'System.AssignedTo'?: { displayName: string };
        };
      };

      return {
        id: String(data.id),
        provider: 'ado',
        title: data.fields['System.Title'],
        description: data.fields['System.Description'],
        status: data.fields['System.State'],
        labels: data.fields['System.Tags']
          ? data.fields['System.Tags'].split(';').map(t => t.trim()).filter(Boolean)
          : [],
        assignee: data.fields['System.AssignedTo']?.displayName,
      };
    },
  };
}
