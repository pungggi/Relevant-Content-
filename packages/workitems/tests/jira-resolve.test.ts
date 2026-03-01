import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createJiraProvider } from '../src/providers/jira.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('createJiraProvider — resolve()', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const config = {
    baseUrl: 'https://myorg.atlassian.net',
    email: 'dev@example.com',
    apiToken: 'tok-123',
    projectKey: 'PROJ',
  };

  it('resolves an issue by explicit itemId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        key: 'PROJ-42',
        fields: {
          summary: 'Fix login timeout',
          description: {
            content: [
              {
                content: [{ text: 'Users get logged out after 5 min' }],
              },
            ],
          },
          status: { name: 'In Progress' },
          labels: ['bug', 'auth'],
          assignee: { displayName: 'Alice' },
        },
      }),
    });

    const provider = createJiraProvider(config);
    const item = await provider.resolve({ itemId: 'PROJ-42' });

    expect(item).not.toBeNull();
    expect(item!.id).toBe('PROJ-42');
    expect(item!.provider).toBe('jira');
    expect(item!.title).toBe('Fix login timeout');
    expect(item!.description).toBe('Users get logged out after 5 min');
    expect(item!.status).toBe('In Progress');
    expect(item!.labels).toEqual(['bug', 'auth']);
    expect(item!.assignee).toBe('Alice');

    // Verify URL and auth header
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://myorg.atlassian.net/rest/api/3/issue/PROJ-42');
    expect(opts.headers.Authorization).toMatch(/^Basic /);
    expect(opts.headers.Accept).toBe('application/json');
  });

  it('resolves an issue from branch name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        key: 'PROJ-99',
        fields: {
          summary: 'Refactor cache',
          status: { name: 'Open' },
          labels: [],
        },
      }),
    });

    const provider = createJiraProvider(config);
    const item = await provider.resolve({ branch: 'feat/PROJ-99-refactor-cache' });

    expect(item).not.toBeNull();
    expect(item!.id).toBe('PROJ-99');
    expect(item!.title).toBe('Refactor cache');
  });

  it('returns null when API responds with non-200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const provider = createJiraProvider(config);
    const item = await provider.resolve({ itemId: 'PROJ-999' });

    expect(item).toBeNull();
  });

  it('returns null when no issue key can be extracted from branch', async () => {
    const provider = createJiraProvider(config);
    const item = await provider.resolve({ branch: 'main' });

    expect(item).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when neither itemId nor branch are provided', async () => {
    const provider = createJiraProvider(config);
    const item = await provider.resolve({});

    expect(item).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles missing optional fields in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        key: 'PROJ-10',
        fields: {
          summary: 'Minimal issue',
          status: { name: 'Done' },
          labels: [],
        },
      }),
    });

    const provider = createJiraProvider(config);
    const item = await provider.resolve({ itemId: 'PROJ-10' });

    expect(item).not.toBeNull();
    expect(item!.description).toBeUndefined();
    expect(item!.assignee).toBeUndefined();
  });

  it('parses multi-block Jira ADF description', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        key: 'PROJ-7',
        fields: {
          summary: 'Complex description',
          description: {
            content: [
              { content: [{ text: 'First paragraph.' }] },
              { content: [{ text: ' Second paragraph.' }] },
            ],
          },
          status: { name: 'Open' },
          labels: [],
        },
      }),
    });

    const provider = createJiraProvider(config);
    const item = await provider.resolve({ itemId: 'PROJ-7' });

    expect(item!.description).toBe('First paragraph. Second paragraph.');
  });

  it('constructs Basic auth header from email:apiToken', () => {
    const provider = createJiraProvider(config);
    // Trigger a call so we can inspect the header
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    provider.resolve({ itemId: 'X-1' });

    const expected = Buffer.from('dev@example.com:tok-123').toString('base64');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe(`Basic ${expected}`);
  });

  it('prefers itemId over branch when both are given', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        key: 'PROJ-1',
        fields: {
          summary: 'From itemId',
          status: { name: 'Open' },
          labels: [],
        },
      }),
    });

    const provider = createJiraProvider(config);
    await provider.resolve({ itemId: 'PROJ-1', branch: 'feat/PROJ-999-other' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/PROJ-1');
  });
});
