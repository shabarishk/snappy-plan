import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkHealth, createBoard } from '../src/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API helpers', () => {
  it('returns the health response text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ text: async () => 'healthy' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkHealth()).resolves.toBe('healthy');
    expect(fetchMock).toHaveBeenCalledWith('/api/health');
  });

  it('creates a board and returns the decoded response', async () => {
    const board = { id: 'board-1', title: 'Home', owner_id: 'user-1' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => board });
    vi.stubGlobal('fetch', fetchMock);

    await expect(createBoard('Home', ['user-1'])).resolves.toEqual(board);
    expect(fetchMock).toHaveBeenCalledWith('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ title: 'Home', user_ids: ['user-1'] }),
    });
  });

  it('reports a failed board creation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await expect(createBoard('Home', ['user-1'])).rejects.toThrow();
  });
});
