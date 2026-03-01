import { describe, it, expect } from 'vitest';
import { collectWorkItemContext } from '../src/index.js';
import type { WorkItemProvider } from '../src/index.js';
import type { WorkItem } from '../src/types.js';

function createMockProvider(
  name: WorkItemProvider['name'],
  result: WorkItem | null,
): WorkItemProvider {
  return {
    name,
    resolve: async () => result,
  };
}

describe('collectWorkItemContext', () => {
  it('returns first matching provider result mapped to ExternalContext', async () => {
    const jiraItem: WorkItem = {
      id: 'PROJ-123',
      provider: 'jira',
      title: 'Fix auth bug',
      description: 'Token expires too soon',
      status: 'In Progress',
      labels: [],
    };

    const ctx = await collectWorkItemContext(
      { providers: [createMockProvider('jira', jiraItem)] },
      { branch: 'feat/PROJ-123' },
    );

    expect(ctx.issueDescription).toBe('Fix auth bug: Token expires too soon');
  });

  it('skips providers that return null and tries the next', async () => {
    const ghItem: WorkItem = {
      id: '#42',
      provider: 'github',
      title: 'Add feature X',
      status: 'open',
      labels: ['enhancement'],
    };

    const ctx = await collectWorkItemContext(
      {
        providers: [
          createMockProvider('jira', null),
          createMockProvider('github', ghItem),
        ],
      },
      { branch: 'feat/#42-feature-x' },
    );

    expect(ctx.issueDescription).toBe('Add feature X');
  });

  it('returns empty ExternalContext when no providers match', async () => {
    const ctx = await collectWorkItemContext(
      {
        providers: [
          createMockProvider('jira', null),
          createMockProvider('ado', null),
        ],
      },
      { branch: 'main' },
    );

    expect(ctx).toEqual({});
  });

  it('works with empty providers list', async () => {
    const ctx = await collectWorkItemContext(
      { providers: [] },
      { branch: 'main' },
    );

    expect(ctx).toEqual({});
  });
});
