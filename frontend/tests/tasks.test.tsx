import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App, { AuthenticatedBoard } from '../src/App';
import type { Task } from '../src/App';
import { sortTasksByPriority } from '../src/taskPriority';

import { taskResponse, boardList, mockBoardReads } from './appTestUtils';

describe('Tasks', () => {
  it('orders tasks from highest to lowest priority', () => {
      const tasks = [
        { id: 'low', columnId: 'todo' as const, state: 'ToDo' as const, priority: 'Low' as const, title: 'Low priority' },
        { id: 'high', columnId: 'todo' as const, state: 'ToDo' as const, priority: 'High' as const, title: 'High priority' },
        { id: 'medium', columnId: 'todo' as const, state: 'ToDo' as const, priority: 'Medium' as const, title: 'Medium priority' },
      ];
  
      expect(sortTasksByPriority(tasks).map((task) => task.id)).toEqual(['high', 'medium', 'low']);
    });
  
  it('moves backlog tasks between lanes and displays their priority and completion time', () => {
      vi.stubGlobal('fetch', mockBoardReads());
      const task: Task = {
        id: 'task-1',
        columnId: 'backlog',
        state: 'Backlog',
        priority: 'High',
        title: 'Test task',
        description: 'Task details',
      };
      const setTasks = vi.fn((update: React.SetStateAction<Task[]>) => {
        tasks = typeof update === 'function' ? update(tasks) : update;
      });
      let tasks = [task];
  
      const { rerender } = render(<AuthenticatedBoard tasks={tasks} setTasks={setTasks} />);
      fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
      expect(screen.getByText('Priority: High')).toBeTruthy();
      expect(screen.getByText('Task details')).toBeTruthy();
  
      fireEvent.click(screen.getByRole('button', { name: 'Move to To Do' }));
      expect(setTasks).toHaveBeenCalled();
      rerender(<AuthenticatedBoard tasks={tasks} setTasks={setTasks} />);
      expect(screen.getByRole('region', { name: 'Backlog tasks' }).textContent).toContain('0 tasks');
      expect(screen.getByRole('button', { name: 'Kanban board' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Kanban board' }));
  
      fireEvent.click(screen.getByRole('button', { name: 'Mock drag start' }));
      expect(screen.getAllByText('Test task')).toHaveLength(2);
      fireEvent.click(screen.getByRole('button', { name: 'Mock drag without target' }));
      fireEvent.click(screen.getByRole('button', { name: 'Mock drag over Complete' }));
      rerender(<AuthenticatedBoard tasks={tasks} setTasks={setTasks} />);
      expect(screen.queryByText('Completed', { exact: false })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Mock drag end' }));
      rerender(<AuthenticatedBoard tasks={tasks} setTasks={setTasks} />);
      expect(screen.getByText('Completed', { exact: false })).toBeTruthy();
      expect(screen.getAllByText('Test task')).toHaveLength(1);
    });
  
  it('persists a drag-and-drop state change to the backend', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        if (url === '/api/boards') return { ok: true, json: async () => boardList };
        if (url === '/api/tasks' && options?.method === 'PATCH') {
          return { ok: true, json: async () => taskResponse({
            id: 'task-1',
            state: 'InProgress',
          }) };
        }
        if (url.startsWith('/api/tasks?board_id=')) return {
          ok: true,
          json: async () => [taskResponse({
            id: 'task-1',
            state: 'ToDo',
            title: 'Move into progress',
          })],
        };
        if (url === '/api/users') return { ok: true, json: async () => [] };
        if (url === '/api/profile') return {
          ok: true,
          json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
        };
        return { ok: true, json: async () => ({ authenticated: true }) };
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<App />);
  
      await screen.findByText('Move into progress');
      fireEvent.click(screen.getByRole('button', { name: 'Mock drag start' }));
      fireEvent.click(screen.getByRole('button', { name: 'Mock drag over In Progress' }));
      fireEvent.click(screen.getByRole('button', { name: 'Mock drag end' }));
  
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        '/api/tasks/task-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ state: 'InProgress' }),
        }),
      ));
    });
  
  it('opens task details and persists edited fields to the backend', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        if (url === '/api/boards') return { ok: true, json: async () => boardList };
        if (url === '/api/tasks/task-1' && options?.method === 'PUT') {
          return {
            ok: true,
            json: async () => taskResponse({
              id: 'task-1',
              title: 'Updated task title',
              description: 'Updated details',
              state: 'InProgress',
              priority: 'High',
              assigned_to_id: 'user-2',
              complete_by: '2026-10-20T16:30:00.000Z',
            }),
          };
        }
        if (url.startsWith('/api/tasks?board_id=')) {
          return {
            ok: true,
            json: async () => [taskResponse({
              id: 'task-1',
              title: 'Editable task',
              description: 'Original details',
              state: 'ToDo',
              priority: 'Low',
              complete_by: null,
            })],
          };
        }
        if (url === '/api/users') return {
          ok: true,
          json: async () => [
            { id: 'user-1', full_name: 'First user' },
            { id: 'user-2', full_name: 'Second user' },
          ],
        };
        if (url === '/api/profile') return {
          ok: true,
          json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
        };
        return { ok: true, json: async () => ({ authenticated: true }) };
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<App />);
  
      fireEvent.click(await screen.findByText('Editable task'));
      expect(screen.getByRole('dialog', { name: 'Task details' })).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated task title' } });
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated details' } });
      fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'user-2' } });
      fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'High' } });
      fireEvent.change(screen.getByLabelText('State'), { target: { value: 'InProgress' } });
      fireEvent.change(screen.getByLabelText('Complete by'), { target: { value: '2026-10-20T09:30' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  
      expect(await screen.findByText('Updated task title')).toBeTruthy();
      expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          board_id: 'board-1',
          title: 'Updated task title',
          description: 'Updated details',
          priority: 'High',
          state: 'InProgress',
          assigned_to_id: 'user-2',
          complete_by: new Date('2026-10-20T09:30').toISOString(),
        }),
      }));
    });

  it('moves a task to the selected board from the details overlay', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        if (url === '/api/boards') return { ok: true, json: async () => boardList };
        if (url === '/api/tasks/task-1' && options?.method === 'PUT') {
          return { ok: true, json: async () => taskResponse({
            id: 'task-1',
            title: 'Board transfer task',
            state: 'ToDo',
          }) };
        }
        if (url.startsWith('/api/tasks?board_id=')) return {
          ok: true,
          json: async () => [taskResponse({
            id: 'task-1',
            title: 'Board transfer task',
            state: 'ToDo',
          })],
        };
        if (url === '/api/users') return { ok: true, json: async () => [] };
        if (url === '/api/profile') return {
          ok: true,
          json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
        };
        return { ok: true, json: async () => ({ authenticated: true }) };
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<App />);

      fireEvent.click(await screen.findByText('Board transfer task'));
      fireEvent.change(screen.getByLabelText('Board'), { target: { value: 'board-2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull());
      expect(screen.queryByText('Board transfer task')).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1', expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"board_id":"board-2"'),
      }));
    });
  
  it('closes task details using the close button or by clicking outside', () => {
      vi.stubGlobal('fetch', mockBoardReads());
      const task: Task = {
        id: 'task-1',
        columnId: 'todo',
        state: 'ToDo',
        priority: 'Medium',
        title: 'Closeable task',
      };
      render(<AuthenticatedBoard tasks={[task]} setTasks={vi.fn()} />);
  
      fireEvent.click(screen.getByText('Closeable task'));
      fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));
      expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull();
  
      fireEvent.click(screen.getByText('Closeable task'));
      const reopenedDialog = screen.getByRole('dialog', { name: 'Task details' });
      fireEvent.click(reopenedDialog.parentElement!);
      expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull();
    });
  
  it('creates and displays a task from the overlay form', async () => {
      const fetchMock = mockBoardReads();
      fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url === '/api/boards') return { ok: true, json: async () => boardList };
        if (url === '/api/tasks' && options?.method === 'POST') {
          return { ok: true, json: async () => taskResponse({
            title: 'Book a campsite',
            description: 'Check the lake sites',
            state: 'ToDo',
            priority: 'High',
            assigned_to_id: 'user-1',
            complete_by: '2026-10-20T09:30:00.000Z',
          }) };
        }
        if (url.startsWith('/api/tasks?board_id=')) return {
          ok: true,
          json: async () => url.endsWith('board-2') ? [taskResponse({
            title: 'Book a campsite',
            description: 'Check the lake sites',
            state: 'ToDo',
            priority: 'High',
            assigned_to_id: 'user-1',
            complete_by: '2026-10-20T09:30:00.000Z',
          })] : [],
        };
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
      vi.stubGlobal('fetch', fetchMock);
      render(<App />);
  
      await screen.findByRole('button', { name: 'Current board: Board Owner' });
      fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Task' }));
      const dialog = screen.getByRole('dialog', { name: 'Create task' });
      expect((screen.getByLabelText('Current state') as HTMLSelectElement).value).toBe('Backlog');
      expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('Medium');
      expect((screen.getByLabelText('Title') as HTMLInputElement).required).toBe(true);
  
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Book a campsite' } });
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Check the lake sites' } });
      fireEvent.change(screen.getByLabelText('Board'), { target: { value: 'board-2' } });
      fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'user-1' } });
      fireEvent.change(screen.getByLabelText('Current state'), { target: { value: 'ToDo' } });
      fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'High' } });
      fireEvent.change(screen.getByLabelText('Complete by'), { target: { value: '2026-10-20T02:30' } });
      fireEvent.submit(dialog.querySelector('form')!);
  
      expect(await screen.findByText('Book a campsite')).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          board_id: 'board-2',
          title: 'Book a campsite',
          description: 'Check the lake sites',
          assigned_to_id: 'user-1',
          state: 'ToDo',
          priority: 'High',
          complete_by: new Date('2026-10-20T02:30').toISOString(),
        }),
      }));
      expect(screen.getByText('Priority: High')).toBeTruthy();
    });
  
  it('creates a default task in Backlog with Medium priority', async () => {
      const fetchMock = mockBoardReads();
      fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
        if (url === '/api/boards') return { ok: true, json: async () => boardList };
        if (url === '/api/tasks' && options?.method === 'POST') {
          const request = JSON.parse(options.body as string) as { board_id: string; title: string; state: string; priority: string };
          return { ok: true, json: async () => taskResponse(request) };
        }
        if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
        if (url === '/api/users') return { ok: true, json: async () => [] };
        if (url === '/api/initiatives') return { ok: true, json: async () => [] };
        if (url === '/api/profile') return {
          ok: true,
          json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
        };
        return { ok: true, json: async () => ({ authenticated: true }) };
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<App />);
  
      await screen.findByRole('button', { name: 'Current board: Board Owner' });
      fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Task' }));
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Review the garden plan' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Task' }));
  
      expect(await screen.findByText('Review the garden plan')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Backlog' })).toBeTruthy();
      expect(screen.getByText('Priority: Medium')).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          board_id: 'board-1',
          title: 'Review the garden plan',
          description: '',
          assigned_to_id: '',
          state: 'Backlog',
          priority: 'Medium',
          complete_by: null,
        }),
      }));
    });

  it('searches tasks across boards and opens their details from non-board pages', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url === '/api/tasks?board_id=board-2') return {
        ok: true,
        json: async () => [taskResponse({
          id: 'shared-task',
          title: 'Prepare launch report',
          description: 'Summarize project progress',
          state: 'ToDo',
        })],
      };
      if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
      if (url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/initiatives') return { ok: true, json: async () => [] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByRole('button', { name: 'Current board: Board Owner' });
    const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Initiatives' }));
    const search = screen.getByRole('searchbox', { name: 'Search tasks' });
    fireEvent.change(search, { target: { value: 'launch' } });

    fireEvent.click(await screen.findByRole('option', { name: 'Prepare launch report — Project Board' }));
    await screen.findByRole('dialog', { name: 'Task details' });
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Prepare launch report');
    expect((screen.getByLabelText('Board') as HTMLSelectElement).value).toBe('board-2');
    fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));

    fireEvent.click(screen.getByRole('button', { name: 'User menu for boardowner' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));
    expect(screen.queryByRole('searchbox', { name: 'Search tasks' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'User menu for boardowner' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(screen.queryByRole('searchbox', { name: 'Search tasks' })).toBeNull();
  });

  it('opens each create overlay from the shared create menu', async () => {
    vi.stubGlobal('fetch', mockBoardReads());
    render(<App />);

    await screen.findByRole('button', { name: 'Current board: Board Owner' });
    fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
    expect(screen.getByRole('menuitem', { name: 'Task' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Board' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Initiative' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Task' }));
    expect(screen.getByRole('dialog', { name: 'Create task' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close create task form' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Board' }));
    expect(screen.getByRole('dialog', { name: 'Create a new board' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close create board form' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Initiative' }));
    expect(screen.getByRole('dialog', { name: 'Create initiative' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close create initiative form' }));
  });
});
