import { describe, it, expect } from 'vitest';
import { collectWorkItemContext } from '../src/index.js';
import type { WorkItemProvider } from '../src/types.js';

describe('collectWorkItemContext — error handling', () => {
  it('propagates provider.resolve() errors (does not swallow them)', async () => {
    const failing: WorkItemProvider = {
      name: 'jira',
      resolve: async () => {
        throw new Error('Network timeout');
      },
    };

    await expect(
      collectWorkItemContext({ providers: [failing] }, { branch: 'main' }),
    ).rejects.toThrow('Network timeout');
  });

  it('does not reach later providers if an earlier one throws', async () => {
    let called = false;
    const failing: WorkItemProvider = {
      name: 'jira',
      resolve: async () => {
        throw new Error('Boom');
      },
    };
    const second: WorkItemProvider = {
      name: 'github',
      resolve: async () => {
        called = true;
        return null;
      },
    };

    await expect(
      collectWorkItemContext({ providers: [failing, second] }, { branch: 'x' }),
    ).rejects.toThrow();

    expect(called).toBe(false);
  });
});
