import * as vscode from 'vscode';
import {
  createJiraProvider,
  createAdoProvider,
  createGitHubProvider,
} from '@scp/workitems';
import type { WorkItemProvider, WorkItemsConfig } from '@scp/workitems';

/**
 * Read the SCP extension configuration and build a WorkItemsConfig.
 *
 * Secrets (API tokens, PATs) are stored in VS Code's SecretStorage,
 * not in user-visible settings.
 */
export async function loadWorkItemsConfig(
  secrets: vscode.SecretStorage,
): Promise<WorkItemsConfig> {
  const cfg = vscode.workspace.getConfiguration('scp.workitems');
  const providerName = cfg.get<string>('provider', 'none');

  const providers: WorkItemProvider[] = [];

  if (providerName === 'jira') {
    const baseUrl = cfg.get<string>('jira.baseUrl');
    const email = cfg.get<string>('jira.email');
    const apiToken = await secrets.get('scp.jira.apiToken');
    if (baseUrl && email && apiToken) {
      providers.push(createJiraProvider({ baseUrl, email, apiToken }));
    }
  }

  if (providerName === 'ado') {
    const orgUrl = cfg.get<string>('ado.orgUrl');
    const project = cfg.get<string>('ado.project');
    const pat = await secrets.get('scp.ado.pat');
    if (orgUrl && project && pat) {
      providers.push(createAdoProvider({ orgUrl, project, pat }));
    }
  }

  if (providerName === 'github') {
    const owner = cfg.get<string>('github.owner');
    const repo = cfg.get<string>('github.repo');
    const token = await secrets.get('scp.github.token');
    if (owner && repo && token) {
      providers.push(createGitHubProvider({ owner, repo, token }));
    }
  }

  return { providers };
}
