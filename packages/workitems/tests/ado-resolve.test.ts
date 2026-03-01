import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdoProvider } from '../src/providers/ado.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('createAdoProvider — resolve()', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const config = {
    orgUrl: 'https://dev.azure.com/myorg',
    project: 'MyProject',
    pat: 'ado-pat-token',
  };

  it('resolves a work item by explicit itemId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 456,
        fields: {
          'System.Title': 'Fix pipeline',
          'System.Description': '<p>Pipeline fails on main</p>',
          'System.State': 'Active',
          'System.Tags': 'bug;pipeline;urgent',
          'System.AssignedTo': { displayName: 'Bob' },
        },
      }),
    });

    const provider = createAdoProvider(config);
    const item = await provider.resolve({ itemId: '456' });

    expect(item).not.toBeNull();
    expect(item!.id).toBe('456');
    expect(item!.provider).toBe('ado');
    expect(item!.title).toBe('Fix pipeline');
    expect(item!.description).toBe('<p>Pipeline fails on main</p>');
    expect(item!.status).toBe('Active');
    expect(item!.labels).toEqual(['bug', 'pipeline', 'urgent']);
    expect(item!.assignee).toBe('Bob');

    // Verify URL construction
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://dev.azure.com/myorg/MyProject/_apis/wit/workitems/456?api-version=7.1',
    );
    expect(opts.headers.Authorization).toMatch(/^Basic /);
  });

  it('resolves from branch name with AB# pattern', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 789,
        fields: {
          'System.Title': 'From branch',
          'System.State': 'New',
        },
      }),
    });

    const provider = createAdoProvider(config);
    const item = await provider.resolve({ branch: 'feature/AB#789-something' });

    expect(item).not.toBeNull();
    expect(item!.id).toBe('789');
  });

  it('returns null on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const provider = createAdoProvider(config);
    const item = await provider.resolve({ itemId: '999' });

    expect(item).toBeNull();
  });

  it('returns null when no ID can be extracted from branch', async () => {
    const provider = createAdoProvider(config);
    const item = await provider.resolve({ branch: 'main' });

    expect(item).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when query is empty', async () => {
    const provider = createAdoProvider(config);
    const item = await provider.resolve({});

    expect(item).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles missing optional fields (no tags, no assignee, no description)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 100,
        fields: {
          'System.Title': 'Minimal item',
          'System.State': 'Done',
        },
      }),
    });

    const provider = createAdoProvider(config);
    const item = await provider.resolve({ itemId: '100' });

    expect(item).not.toBeNull();
    expect(item!.labels).toEqual([]);
    expect(item!.assignee).toBeUndefined();
    expect(item!.description).toBeUndefined();
  });

  it('splits System.Tags by semicolon and trims whitespace', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 200,
        fields: {
          'System.Title': 'Tags test',
          'System.State': 'Active',
          'System.Tags': ' frontend ; backend ; ; api ',
        },
      }),
    });

    const provider = createAdoProvider(config);
    const item = await provider.resolve({ itemId: '200' });

    expect(item!.labels).toEqual(['frontend', 'backend', 'api']);
  });

  it('constructs Basic auth with :pat format', () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    const provider = createAdoProvider(config);
    provider.resolve({ itemId: '1' });

    const expected = Buffer.from(':ado-pat-token').toString('base64');
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe(`Basic ${expected}`);
  });
});
