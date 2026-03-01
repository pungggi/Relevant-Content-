import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGitHubProvider } from '../src/providers/github.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('createGitHubProvider — resolve()', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const config = {
    owner: 'acme',
    repo: 'widgets',
    token: 'ghp_secret123',
  };

  it('resolves an issue by explicit itemId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        number: 42,
        title: 'Fix dark mode toggle',
        body: 'Toggle doesn\'t persist across page reloads',
        state: 'open',
        labels: [{ name: 'bug' }, { name: 'ui' }],
        assignee: { login: 'charlie' },
      }),
    });

    const provider = createGitHubProvider(config);
    const item = await provider.resolve({ itemId: '42' });

    expect(item).not.toBeNull();
    expect(item!.id).toBe('#42');
    expect(item!.provider).toBe('github');
    expect(item!.title).toBe('Fix dark mode toggle');
    expect(item!.description).toBe('Toggle doesn\'t persist across page reloads');
    expect(item!.status).toBe('open');
    expect(item!.labels).toEqual(['bug', 'ui']);
    expect(item!.assignee).toBe('charlie');

    // Verify URL and headers
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/acme/widgets/issues/42');
    expect(opts.headers.Authorization).toBe('Bearer ghp_secret123');
    expect(opts.headers.Accept).toBe('application/vnd.github+json');
    expect(opts.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('resolves from branch name with #N pattern', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        number: 99,
        title: 'From branch',
        state: 'open',
        labels: [],
      }),
    });

    const provider = createGitHubProvider(config);
    const item = await provider.resolve({ branch: 'fix/#99-login-bug' });

    expect(item).not.toBeNull();
    expect(item!.id).toBe('#99');
  });

  it('resolves from branch name with issue-N pattern', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        number: 7,
        title: 'Issue seven',
        state: 'closed',
        labels: [],
      }),
    });

    const provider = createGitHubProvider(config);
    const item = await provider.resolve({ branch: 'fix/issue-7-thing' });

    expect(item).not.toBeNull();
    expect(item!.id).toBe('#7');
  });

  it('returns null on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const provider = createGitHubProvider(config);
    const item = await provider.resolve({ itemId: '9999' });

    expect(item).toBeNull();
  });

  it('returns null when no issue number can be extracted from branch', async () => {
    const provider = createGitHubProvider(config);
    const item = await provider.resolve({ branch: 'feature/add-dark-mode' });

    expect(item).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when query is empty', async () => {
    const provider = createGitHubProvider(config);
    const item = await provider.resolve({});

    expect(item).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles missing optional fields (no body, no assignee)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        number: 5,
        title: 'Minimal issue',
        state: 'open',
        labels: [],
      }),
    });

    const provider = createGitHubProvider(config);
    const item = await provider.resolve({ itemId: '5' });

    expect(item).not.toBeNull();
    expect(item!.description).toBeUndefined();
    expect(item!.assignee).toBeUndefined();
  });

  it('maps labels array correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        number: 10,
        title: 'Label test',
        state: 'open',
        labels: [{ name: 'enhancement' }, { name: 'help wanted' }, { name: 'p1' }],
        assignee: null,
      }),
    });

    const provider = createGitHubProvider(config);
    const item = await provider.resolve({ itemId: '10' });

    expect(item!.labels).toEqual(['enhancement', 'help wanted', 'p1']);
    expect(item!.assignee).toBeUndefined();
  });

  it('prefers itemId over branch when both are given', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        number: 1,
        title: 'From itemId',
        state: 'open',
        labels: [],
      }),
    });

    const provider = createGitHubProvider(config);
    await provider.resolve({ itemId: '1', branch: 'fix/#999-other' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/issues/1');
  });
});
