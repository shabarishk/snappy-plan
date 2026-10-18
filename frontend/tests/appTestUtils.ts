import { vi } from 'vitest';

export const taskResponse = (overrides: Record<string, unknown> = {}) => ({
  id: 'saved-task',
  title: 'Persisted task',
  description: null,
  column_id: 'column-1',
  state: 'Backlog',
  priority: 'Medium',
  assigned_to_id: null,
  complete_by: null,
  completed_at: null,
  ...overrides,
});

export const boardList = [
  { id: 'board-1', title: 'Board Owner', owner_id: 'boardowner' },
  { id: 'board-2', title: 'Project Board', owner_id: 'teammate' },
];

export const mockBoardReads = () => vi.fn().mockImplementation(async (url: string) => {
  if (url === '/api/notifications') return { ok: true, json: async () => [] };
  if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
  if (url === '/api/initiatives') return { ok: true, json: async () => [] };
  if (url === '/api/boards') return { ok: true, json: async () => boardList };
  if (url === '/api/users') return {
    ok: true,
    json: async () => [{ id: 'user-1', full_name: 'Board Owner' }],
  };
  if (url === '/api/profile') return {
    ok: true,
    json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
  };
  return { ok: true, json: async () => ({ authenticated: true }) };
});
