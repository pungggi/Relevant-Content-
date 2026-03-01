import { describe, it, expect } from 'vitest';
import { toExternalContext } from '../src/mapper.js';
import type { WorkItem } from '../src/types.js';

describe('toExternalContext', () => {
  it('maps title + description into issueDescription', () => {
    const item: WorkItem = {
      id: 'PROJ-123',
      provider: 'jira',
      title: 'Fix auth bug',
      description: 'Token refresh fails after 24h',
      status: 'In Progress',
      labels: [],
    };

    const ctx = toExternalContext(item);
    expect(ctx.issueDescription).toBe('Fix auth bug: Token refresh fails after 24h');
  });

  it('uses title only when description is absent', () => {
    const item: WorkItem = {
      id: 'PROJ-456',
      provider: 'jira',
      title: 'Add caching layer',
      status: 'Open',
      labels: [],
    };

    const ctx = toExternalContext(item);
    expect(ctx.issueDescription).toBe('Add caching layer');
  });

  it('maps linkedTests to failingTestNames', () => {
    const item: WorkItem = {
      id: '#789',
      provider: 'github',
      title: 'Fix test failure',
      status: 'open',
      labels: [],
      linkedTests: ['test_auth_refresh', 'test_token_expiry'],
    };

    const ctx = toExternalContext(item);
    expect(ctx.failingTestNames).toEqual(['test_auth_refresh', 'test_token_expiry']);
  });

  it('returns undefined failingTestNames when no linkedTests', () => {
    const item: WorkItem = {
      id: '100',
      provider: 'ado',
      title: 'Some task',
      status: 'Active',
      labels: [],
    };

    const ctx = toExternalContext(item);
    expect(ctx.failingTestNames).toBeUndefined();
  });
});
