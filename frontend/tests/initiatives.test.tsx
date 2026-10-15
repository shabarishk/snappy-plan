import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';

const initiativeResponse = {
  id: 'initiative-1',
  title: 'Launch planning',
  description: 'Coordinate launch work',
  complete_by: '2026-12-01T00:00:00Z',
  assigned_to_id: 'boardowner',
  created_by_id: 'boardowner',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const taskResponse = {
  id: 'task-1',
  title: 'Prepare release notes',
  description: null,
  column_id: 'column-1',
  state: 'Complete',
  priority: 'Medium',
  assigned_to_id: null,
  complete_by: null,
  completed_at: null,
};

describe('Initiatives', () => {
  it('creates an initiative, opens it, and adds an existing task', async () => {
    let linked = false;
    let created = false;
    let updated = false;
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/initiatives' && options?.method === 'POST') {
        created = true;
        return { ok: true, status: 201, json: async () => initiativeResponse };
      }
      if (url === '/api/initiatives') {
        return {
          ok: true,
          json: async () => created ? [{
            ...initiativeResponse,
            title: updated ? 'Release launch' : initiativeResponse.title,
            task_count: linked ? 1 : 0,
            completed_task_count: linked ? 1 : 0,
          }] : [],
        };
      }
      if (url === '/api/initiatives/initiative-1' && (!options?.method || options.method === 'GET')) {
        return { ok: true, json: async () => ({ initiative: initiativeResponse, tasks: linked ? [taskResponse] : [] }) };
      }
      if (url === '/api/initiatives/initiative-1' && options?.method === 'PUT') {
        updated = true;
        return { ok: true, json: async () => ({ ...initiativeResponse, title: 'Release launch' }) };
      }
      if (url === '/api/initiatives/initiative-1/tasks' && options?.method === 'POST') {
        linked = true;
        return { ok: true, status: 204 };
      }
      if (url.startsWith('/api/initiatives/initiative-1/tasks/') && options?.method === 'DELETE') {
        linked = false;
        return { ok: true, status: 204 };
      }
      if (url === '/api/tasks') return { ok: true, json: async () => [taskResponse] };
      if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
      if (url === '/api/boards') return { ok: true, json: async () => [{ id: 'board-1', title: 'Board Owner', owner_id: 'boardowner' }] };
      if (url === '/api/users') return { ok: true, json: async () => [{ id: 'boardowner', full_name: 'Board Owner' }] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByRole('button', { name: 'Current board: Board Owner' });
    fireEvent.click(screen.getByRole('button', { name: 'Initiatives' }));
    fireEvent.click(screen.getByRole('button', { name: '+ New initiative' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Launch planning' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Coordinate launch work' } });
    fireEvent.change(screen.getByLabelText('Complete by'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'boardowner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create initiative' }));

    expect(await screen.findByRole('button', { name: /Launch planning/ })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/initiatives', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        title: 'Launch planning',
        description: 'Coordinate launch work',
        complete_by: '2026-12-01',
        assigned_to_id: 'boardowner',
      }),
    }));

    fireEvent.click(screen.getByRole('button', { name: /Launch planning/ }));
    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Task to add' }), { target: { value: 'task-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByText('Prepare release notes')).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/initiatives/initiative-1/tasks', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ task_id: 'task-1' }),
    })));
    expect(window.location.pathname).toBe('/initiatives/initiative-1');

    fireEvent.click(screen.getByRole('button', { name: 'Edit initiative' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Release launch' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated launch details' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { name: 'Release launch' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/initiatives/initiative-1', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        title: 'Release launch',
        description: 'Updated launch details',
        complete_by: '2026-12-01',
        assigned_to_id: 'boardowner',
      }),
    }));

    fireEvent.click(screen.getByRole('button', { name: '← All initiatives' }));
    expect(await screen.findByText('100%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Release launch/ }));
    expect(await screen.findByText('Prepare release notes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const initiativeTasks = screen.getByRole('list', { name: 'Initiative tasks' });
    await waitFor(() => expect(within(initiativeTasks).queryByText('Prepare release notes')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/initiatives/initiative-1/tasks/task-1', expect.objectContaining({
      method: 'DELETE',
    }));
  });
});
