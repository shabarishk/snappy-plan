import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App, { AuthenticatedBoard } from '../src/App';
import type { Task } from '../src/App';
import type { Initiative } from '../src/api';
import { Column } from '../src/TaskBoard';
import { TaskDetailsOverlay } from '../src/TaskOverlays';
import { sortTasksByCompleteByAndPriority, sortTasksByPriority } from '../src/taskPriority';

import { taskResponse, boardList, mockBoardReads } from './appTestUtils';

const taskPageFetch = () => {
  const defaultFetch = mockBoardReads();
  return vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/tasks?board_id=board-1') {
      return {
        ok: true,
        json: async () => [taskResponse({
          id: 'task-1',
          title: 'Task page sample',
          description: 'Task page description',
          state: 'ToDo',
          assigned_to_id: 'user-1',
        })],
      };
    }
    if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
    if (url === '/api/tasks/task-1/comments') return { ok: true, json: async () => [] };
    if (url === '/api/tasks/task-1' && options?.method === 'PATCH') {
      const body = JSON.parse(String(options.body)) as { state: string };
      return {
        ok: true,
        json: async () => taskResponse({
          id: 'task-1',
          title: 'Task page sample',
          description: 'Task page description',
          state: body.state,
          assigned_to_id: 'user-1',
        }),
      };
    }
    return defaultFetch(url);
  });
};

describe('Tasks', () => {
  it('renders a column without grouped drag identifiers', () => {
    const task: Task = {
      id: 'standalone-task',
      columnId: 'todo',
      state: 'ToDo',
      priority: 'Medium',
      title: 'Standalone task',
    };
    const onSelectTask = vi.fn();

    render(<Column column={{ id: 'todo', title: 'To Do' }} tasks={[task]} onSelectTask={onSelectTask} />);
    fireEvent.click(screen.getByText('Standalone task'));

    expect(screen.getByRole('heading', { name: 'To Do' })).toBeTruthy();
    expect(onSelectTask).toHaveBeenCalledWith(task);
  });

  it('renders backlog tasks by due date and priority when requested', () => {
    const tasks: Task[] = [
      { id: 'later', columnId: 'backlog', state: 'Backlog', priority: 'High', title: 'Later due', completeBy: '2026-11-02T00:00:00Z' },
      { id: 'earlier', columnId: 'backlog', state: 'Backlog', priority: 'Low', title: 'Earlier due', completeBy: '2026-10-20T00:00:00Z' },
    ];

    const { container } = render(
      <Column
        column={{ id: 'backlog', title: 'Backlog' }}
        tasks={tasks}
        onSelectTask={vi.fn()}
        sortByCompleteBy
      />
    );

    const renderedTaskTitles = Array.from(container.querySelector('.board-column-tasks')!.children)
      .map((card) => card.querySelector('p')?.textContent);
    expect(renderedTaskTitles).toEqual(['Earlier due', 'Later due']);
  });

  it('orders tasks from highest to lowest priority', () => {
      const tasks = [
        { id: 'low', columnId: 'todo' as const, state: 'ToDo' as const, priority: 'Low' as const, title: 'Low priority' },
        { id: 'high', columnId: 'todo' as const, state: 'ToDo' as const, priority: 'High' as const, title: 'High priority' },
        { id: 'medium', columnId: 'todo' as const, state: 'ToDo' as const, priority: 'Medium' as const, title: 'Medium priority' },
      ];
  
      expect(sortTasksByPriority(tasks).map((task) => task.id)).toEqual(['high', 'medium', 'low']);
    });

  it('orders backlog tasks by due date and uses priority to break ties', () => {
    const tasks = [
      { id: 'undated-low', priority: 'Low' as const },
      { id: 'later-high', completeBy: '2026-11-02T00:00:00Z', priority: 'High' as const },
      { id: 'earlier-low', completeBy: '2026-10-20T00:00:00Z', priority: 'Low' as const },
      { id: 'earlier-high', completeBy: '2026-10-20T00:00:00Z', priority: 'High' as const },
      { id: 'undated-high', completeBy: 'invalid', priority: 'High' as const },
    ];

    expect(sortTasksByCompleteByAndPriority(tasks).map((task) => task.id)).toEqual([
      'earlier-high',
      'earlier-low',
      'later-high',
      'undated-high',
      'undated-low',
    ]);
  });

  it('only displays the five most recently completed tasks on each board', async () => {
    const currentTime = Date.now();
    const completedTasks: Task[] = Array.from({ length: 6 }, (_, index) => ({
      id: `completed-${index + 1}`,
      boardId: 'board-1',
      columnId: 'complete',
      state: 'Complete',
      priority: 'Medium',
      title: `Completed task ${index + 1}`,
      completedAt: new Date(currentTime - (6 - index) * 60_000).toISOString(),
    }));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
      if (url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      if (url === '/api/initiatives') return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({ authenticated: true }) };
    }));
    const setTasks = vi.fn();

    render(<AuthenticatedBoard tasks={completedTasks} setTasks={setTasks} />);

    expect(await screen.findByText('Completed task 6')).toBeTruthy();
    expect(screen.queryByText('Completed task 1')).toBeNull();
    for (let index = 2; index <= 5; index += 1) {
      expect(screen.getByText(`Completed task ${index}`)).toBeTruthy();
    }
  });
  
  it('moves backlog tasks between lanes and displays their priority and completion time', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
        if (url === '/api/boards') return { ok: true, json: async () => boardList };
        if (url === '/api/tasks?board_id=board-1') return {
          ok: true,
          json: async () => [taskResponse({
            id: 'task-1',
            state: 'Backlog',
            priority: 'High',
            title: 'Test task',
            description: 'Task details',
          })],
        };
        if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
        if (url === '/api/users') return { ok: true, json: async () => [] };
        if (url === '/api/profile') return {
          ok: true,
          json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
        };
        return { ok: true, json: async () => ({ authenticated: true }) };
      }));
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
      await screen.findByText('Test task');
      expect(screen.getByText('Priority: High')).toBeTruthy();
      expect(screen.queryByText('Task details')).toBeNull();
  
      fireEvent.click(screen.getByRole('button', { name: 'Move to To Do' }));
      expect(setTasks).toHaveBeenCalled();
      rerender(<AuthenticatedBoard tasks={tasks} setTasks={setTasks} />);
      expect(screen.getByRole('region', { name: 'Backlog tasks' }).textContent).toContain('0 tasks');
      expect(screen.getByRole('button', { name: 'Active' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Active' }));
  
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
        if (url === '/api/tasks?board_id=board-1') return {
          ok: true,
          json: async () => [taskResponse({
            id: 'task-1',
            state: 'ToDo',
            title: 'Move into progress',
          })],
        };
        if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
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
        if (url === '/api/tasks?board_id=board-1') {
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
        if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
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

  it('expands the task details overlay into a dedicated task page', async () => {
    vi.stubGlobal('fetch', taskPageFetch());
    render(<App />);

    fireEvent.click(await screen.findByText('Task page sample'));
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open task page' }));

    expect(window.location.pathname).toBe('/tasks/task-1');
    expect(await screen.findByRole('region', { name: 'Task details' })).toBeTruthy();
    expect(screen.getByLabelText('Title')).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Comments' })).toBeTruthy();
  });

  it('loads a task page directly from its URL', async () => {
    window.history.replaceState({}, '', '/tasks/task-1');
    vi.stubGlobal('fetch', taskPageFetch());
    render(<App />);

    expect(await screen.findByRole('region', { name: 'Task details' })).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Task page sample');
  });

  it('opens task pages directly on mobile with progression and assignment actions', async () => {
    const mobileMediaQuery = {
      matches: true,
      media: '(max-width: 767px), (orientation: portrait) and (max-width: 1024px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const fetchMock = taskPageFetch();
    vi.stubGlobal('matchMedia', vi.fn(() => mobileMediaQuery));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByText('Task page sample'));
    expect(window.location.pathname).toBe('/tasks/task-1');
    expect(await screen.findByRole('region', { name: 'Task details' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to tasks' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Move task' }));
    expect(screen.getByRole('menuitem', { name: 'In Progress' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Forward|Backward/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'In Progress' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ state: 'InProgress' }),
    })));

    fireEvent.click(screen.getByRole('button', { name: 'Move task' }));
    expect(screen.getByRole('menuitem', { name: 'Complete' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'To Do' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ state: 'ToDo' }),
    })));

    fireEvent.click(screen.getByRole('button', { name: 'View assignments' }));
    const assignments = screen.getByRole('dialog', { name: 'Task assignments' });
    expect(within(assignments).getByLabelText('Board')).toBeTruthy();
    expect(within(assignments).getByLabelText('Initiatives')).toBeTruthy();
    expect(within(assignments).getByLabelText('Assigned to')).toBeTruthy();
    expect(within(assignments).getByLabelText('Complete by')).toBeTruthy();
    fireEvent.click(within(assignments).getByRole('button', { name: 'Close assignments' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to tasks' }));
    expect(window.location.pathname).toBe('/');
  });

  it('searches initiatives and assigns the selected initiative from task details', async () => {
    const initiative = {
      id: 'initiative-1',
      title: 'Launch planning',
      description: null,
      complete_by: null,
      assigned_to_id: null,
      created_by_id: 'boardowner',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };
    let assignmentAttempts = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url === '/api/tasks?board_id=board-1') return {
        ok: true,
        json: async () => [taskResponse({
          id: 'task-1',
          title: 'Plan launch work',
          state: 'ToDo',
        })],
      };
      if (url === '/api/tasks/task-1' && options?.method === 'PUT') {
        return { ok: true, json: async () => taskResponse({
          id: 'task-1',
          title: 'Plan launch work',
          state: 'ToDo',
        }) };
      }
      if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
      if (url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      if (url === '/api/initiatives') return { ok: true, json: async () => [initiative] };
      if (url === '/api/initiatives/initiative-1') {
        return { ok: true, json: async () => ({ initiative, tasks: [] }) };
      }
      if (url === '/api/initiatives/initiative-1/tasks' && options?.method === 'POST') {
        assignmentAttempts += 1;
        return assignmentAttempts === 1
          ? { ok: false, status: 500, text: async () => 'Assignment failed' }
          : { ok: true, status: 204 };
      }
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByText('Plan launch work'));
    const taskDialog = screen.getByRole('dialog', { name: 'Task details' });
    const initiativeCombo = within(taskDialog).getByRole('combobox', { name: 'Initiatives' });
    fireEvent.change(initiativeCombo, { target: { value: 'launch' } });
    expect(await within(taskDialog).findByRole('option', { name: 'Launch planning' })).toBeTruthy();
    fireEvent.click(within(taskDialog).getByRole('option', { name: 'Launch planning' }));
    expect((initiativeCombo as HTMLInputElement).value).toBe('Launch planning');
    fireEvent.click(within(taskDialog).getByRole('button', { name: 'Save changes' }));
    expect((await within(taskDialog).findByRole('alert')).textContent).toContain('Assignment failed');
    fireEvent.click(within(taskDialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/initiatives/initiative-1/tasks', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ task_id: 'task-1' }),
    }));
  });

  it('restores the assigned initiative when leaving an unselected search', async () => {
    const initiative = {
      id: 'initiative-1',
      title: 'Launch planning',
      description: null,
      complete_by: null,
      assigned_to_id: null,
      created_by_id: 'boardowner',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };
    const linkedTask = taskResponse({ id: 'task-1', title: 'Plan launch work', state: 'ToDo' });
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url === '/api/tasks?board_id=board-1') return { ok: true, json: async () => [linkedTask] };
      if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
      if (url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      if (url === '/api/initiatives') return { ok: true, json: async () => [initiative] };
      if (url === '/api/initiatives/initiative-1') {
        return { ok: true, json: async () => ({ initiative, tasks: [linkedTask] }) };
      }
      if (url === '/api/tasks/task-1' && options?.method === 'PUT') {
        return { ok: true, json: async () => linkedTask };
      }
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByText('Plan launch work'));
    const taskDialog = screen.getByRole('dialog', { name: 'Task details' });
    const initiativeCombo = within(taskDialog).getByRole('combobox', { name: 'Initiatives' }) as HTMLInputElement;
    await waitFor(() => expect(initiativeCombo.value).toBe('Launch planning'));
    fireEvent.click(initiativeCombo);
    expect(initiativeCombo.selectionStart).toBe(0);
    expect(initiativeCombo.selectionEnd).toBe('Launch planning'.length);
    fireEvent.change(initiativeCombo, { target: { value: 'Other initiative' } });
    fireEvent.blur(initiativeCombo);
    expect(initiativeCombo.value).toBe('Launch planning');
    fireEvent.click(within(taskDialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull());
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/initiatives/initiative-1/tasks/task-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('unassigns a task from its initiative when the initiative field is cleared', async () => {
    const initiative = {
      id: 'initiative-1',
      title: 'Launch planning',
      description: null,
      complete_by: null,
      assigned_to_id: null,
      created_by_id: 'boardowner',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };
    const linkedTask = taskResponse({ id: 'task-1', title: 'Plan launch work', state: 'ToDo' });
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url === '/api/tasks?board_id=board-1') return { ok: true, json: async () => [linkedTask] };
      if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
      if (url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      if (url === '/api/initiatives') return { ok: true, json: async () => [initiative] };
      if (url === '/api/initiatives/initiative-1') {
        return { ok: true, json: async () => ({ initiative, tasks: [linkedTask] }) };
      }
      if (url === '/api/tasks/task-1' && options?.method === 'PUT') {
        return { ok: true, json: async () => linkedTask };
      }
      if (url === '/api/initiatives/initiative-1/tasks/task-1' && options?.method === 'DELETE') {
        return { ok: true, status: 204 };
      }
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByText('Plan launch work'));
    const taskDialog = screen.getByRole('dialog', { name: 'Task details' });
    const initiativeCombo = within(taskDialog).getByRole('combobox', { name: 'Initiatives' }) as HTMLInputElement;
    await waitFor(() => expect(initiativeCombo.value).toBe('Launch planning'));
    fireEvent.click(initiativeCombo);
    fireEvent.change(initiativeCombo, { target: { value: '' } });
    fireEvent.blur(initiativeCombo);
    expect(initiativeCombo.value).toBe('');
    fireEvent.click(within(taskDialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/initiatives/initiative-1/tasks/task-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
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
        if (url === '/api/tasks?board_id=board-1') return {
          ok: true,
          json: async () => [taskResponse({
            id: 'task-1',
            title: 'Board transfer task',
            state: 'ToDo',
          })],
        };
        if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
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
      fireEvent.change(within(screen.getByRole('dialog', { name: 'Task details' })).getByLabelText('Board'), { target: { value: 'board-2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull());
      expect(within(screen.getByRole('region', { name: 'Project Board tasks' })).getByText('Board transfer task')).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1', expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"board_id":"board-2"'),
      }));
    });
  
  it('closes task details using the close button or by clicking outside', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
        if (url === '/api/boards') return { ok: true, json: async () => boardList };
        if (url === '/api/tasks?board_id=board-1') return {
          ok: true,
          json: async () => [taskResponse({
            id: 'task-1',
            title: 'Closeable task',
            state: 'ToDo',
          })],
        };
        if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
        if (url === '/api/users') return { ok: true, json: async () => [] };
        if (url === '/api/profile') return {
          ok: true,
          json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
        };
        return { ok: true, json: async () => ({ authenticated: true }) };
      }));
      const task: Task = {
        id: 'task-1',
        columnId: 'todo',
        state: 'ToDo',
        priority: 'Medium',
        title: 'Closeable task',
      };
      render(<AuthenticatedBoard tasks={[task]} setTasks={vi.fn()} />);
  
      fireEvent.click(await screen.findByText('Closeable task'));
      fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));
      expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull();
  
      fireEvent.click(await screen.findByText('Closeable task'));
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
  
      await screen.findByRole('heading', { name: 'Board Owner' });
      fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Task' }));
      const dialog = screen.getByRole('dialog', { name: 'Create task' });
      expect((screen.getByLabelText('Current state') as HTMLSelectElement).value).toBe('Backlog');
      expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('Medium');
      expect((screen.getByLabelText('Title') as HTMLInputElement).required).toBe(true);
  
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Book a campsite' } });
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Check the lake sites' } });
      fireEvent.change(within(dialog).getByLabelText('Board'), { target: { value: 'board-2' } });
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
      expect(await screen.findByText('Priority: High')).toBeTruthy();
    });

  it('groups cross-board tasks by initiative and assignee with ungrouped tasks last in backlog', async () => {
    const initiative: Initiative = {
      id: 'initiative-1',
      title: 'Launch Initiative',
      description: null,
      complete_by: null,
      assigned_to_id: null,
      created_by_id: 'boardowner',
      created_at: '',
      updated_at: '',
    };
    const linkedTask = taskResponse({
      id: 'linked-task',
      title: 'Linked task',
      state: 'ToDo',
      assigned_to_id: 'user-1',
    });
    const unlinkedTask = taskResponse({
      id: 'unlinked-task',
      title: 'Unlinked backlog task',
      state: 'Backlog',
      assigned_to_id: null,
    });
    const secondBoardTask = taskResponse({
      id: 'second-board-task',
      title: 'Second board task',
      state: 'ToDo',
      assigned_to_id: 'user-1',
    });
    const secondBoardBacklogTask = taskResponse({
      id: 'second-board-backlog-task',
      title: 'Second board backlog task',
      state: 'Backlog',
      assigned_to_id: 'user-1',
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url === '/api/tasks?board_id=board-1') return { ok: true, json: async () => [linkedTask, unlinkedTask] };
      if (url === '/api/tasks?board_id=board-2') return { ok: true, json: async () => [secondBoardTask, secondBoardBacklogTask] };
      if (url === '/api/users') return { ok: true, json: async () => [{ id: 'user-1', full_name: 'Board Owner' }] };
      if (url === '/api/initiatives') return { ok: true, json: async () => [initiative] };
      if (url === '/api/initiatives/initiative-1') {
        return { ok: true, json: async () => ({ initiative, tasks: [linkedTask] }) };
      }
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    }));
    render(<App />);

    expect(await screen.findByText('Second board task')).toBeTruthy();
    const boardFilter = screen.getByLabelText('Filter by board');
    const initiativeFilter = screen.getByLabelText('Filter by initiative');
    const assigneeFilter = screen.getByLabelText('Filter by assignee');
    const toggleHomeFilter = (filter: HTMLElement, optionName: string) => {
      if (filter.getAttribute('aria-expanded') !== 'true') fireEvent.click(filter);
      fireEvent.click(screen.getByRole('checkbox', { name: optionName }));
    };
    await waitFor(() => expect((initiativeFilter as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(boardFilter);
    fireEvent.click(initiativeFilter);
    fireEvent.click(assigneeFilter);
    expect(await screen.findByRole('checkbox', { name: 'Initiative: Launch Initiative' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Assignee: Unassigned' })).toBeTruthy();
    for (const allCheckbox of ['Board: All', 'Initiative: All', 'Assignee: All']) {
      expect((screen.getByRole('checkbox', { name: allCheckbox }) as HTMLInputElement).checked).toBe(true);
    }
    toggleHomeFilter(boardFilter, 'Board: Project Board');
    expect(screen.queryByText('Second board task')).toBeNull();
    expect(screen.getByText('Linked task')).toBeTruthy();
    toggleHomeFilter(boardFilter, 'Board: Project Board');
    expect(boardFilter.textContent).toContain('Board: All');
    expect((screen.getByRole('checkbox', { name: 'Board: All' }) as HTMLInputElement).checked).toBe(true);
    toggleHomeFilter(initiativeFilter, 'Initiative: Launch Initiative');
    expect(screen.queryByText('Linked task')).toBeNull();
    toggleHomeFilter(initiativeFilter, 'Initiative: Launch Initiative');
    expect(initiativeFilter.textContent).toContain('Initiative: All');
    toggleHomeFilter(assigneeFilter, 'Assignee: Unassigned');
    expect(screen.queryByText('Unlinked backlog task')).toBeNull();
    toggleHomeFilter(assigneeFilter, 'Assignee: Unassigned');
    expect(assigneeFilter.textContent).toContain('Assignee: All');

    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
    expect(await screen.findByText('Unlinked backlog task')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));

    fireEvent.change(screen.getByLabelText('Group tasks by'), { target: { value: 'assignee' } });
    expect(boardFilter.textContent).toContain('Board: All');
    expect(initiativeFilter.textContent).toContain('Initiative: All');
    expect(assigneeFilter.textContent).toContain('Assignee: All');
    expect(screen.getByLabelText('Filter by board')).toBeTruthy();
    expect(screen.getByLabelText('Filter by initiative')).toBeTruthy();
    expect(screen.getByLabelText('Filter by assignee')).toBeTruthy();
    expect(screen.getByText('Linked task')).toBeTruthy();
    expect(screen.getByText('Second board task')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Group tasks by'), { target: { value: 'initiative' } });
    const initiativeGroups = await screen.findAllByRole('region', { name: /^(Launch Initiative|No Initiative) tasks$/ });
    expect(screen.getByLabelText('Filter by board')).toBeTruthy();
    expect(screen.getByLabelText('Filter by initiative')).toBeTruthy();
    expect(screen.getByLabelText('Filter by assignee')).toBeTruthy();
    expect(initiativeGroups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Launch Initiative tasks',
      'No Initiative tasks',
    ]);
    expect(within(initiativeGroups[1]).getByText('Second board task')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Group tasks by'), { target: { value: 'assignee' } });
    const assigneeGroups = await screen.findAllByRole('region', { name: /^(Board Owner|No Assignee) tasks$/ });
    expect(screen.getByLabelText('Filter by board')).toBeTruthy();
    expect(screen.getByLabelText('Filter by initiative')).toBeTruthy();
    expect(screen.getByLabelText('Filter by assignee')).toBeTruthy();
    expect(assigneeGroups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Board Owner tasks',
      'No Assignee tasks',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
    const backlogGroups = await screen.findAllByRole('region', { name: /^(Board Owner|No Assignee) tasks$/ });
    expect(screen.getByLabelText('Filter by board')).toBeTruthy();
    expect(screen.getByLabelText('Filter by initiative')).toBeTruthy();
    expect(screen.getByLabelText('Filter by assignee')).toBeTruthy();
    expect(backlogGroups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Board Owner tasks',
      'No Assignee tasks',
    ]);
    expect(within(backlogGroups[0]).getByText('Second board backlog task')).toBeTruthy();
    expect(within(backlogGroups[1]).getByText('Unlinked backlog task')).toBeTruthy();
  });

  it('filters the home board by multiple boards, initiatives, and assignees', async () => {
    const initiatives: Initiative[] = [
      {
        id: 'initiative-1',
        title: 'Launch Initiative',
        description: null,
        complete_by: null,
        assigned_to_id: null,
        created_by_id: 'boardowner',
        created_at: '',
        updated_at: '',
      },
      {
        id: 'initiative-2',
        title: 'Growth Initiative',
        description: null,
        complete_by: null,
        assigned_to_id: null,
        created_by_id: 'boardowner',
        created_at: '',
        updated_at: '',
      },
      {
        id: 'initiative-3',
        title: 'Retention Initiative',
        description: null,
        complete_by: null,
        assigned_to_id: null,
        created_by_id: 'boardowner',
        created_at: '',
        updated_at: '',
      },
    ];
    const firstTask = taskResponse({
      id: 'home-task-1',
      title: 'Board one task',
      state: 'ToDo',
      assigned_to_id: 'user-1',
    });
    const secondTask = taskResponse({
      id: 'home-task-2',
      title: 'Board two task',
      state: 'ToDo',
      assigned_to_id: 'user-2',
    });
    const thirdTask = taskResponse({
      id: 'home-task-3',
      title: 'Board three task',
      state: 'ToDo',
      assigned_to_id: 'user-3',
    });
    const unassignedTask = taskResponse({
      id: 'home-task-unassigned',
      title: 'Unassigned task',
      state: 'ToDo',
      assigned_to_id: null,
    });
    const homeBoards = [...boardList, { id: 'board-3', title: 'Roadmap Board', owner_id: 'teammate' }];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/boards') return { ok: true, json: async () => homeBoards };
      if (url === '/api/tasks?board_id=board-1') return { ok: true, json: async () => [firstTask, unassignedTask] };
      if (url === '/api/tasks?board_id=board-2') return { ok: true, json: async () => [secondTask] };
      if (url === '/api/tasks?board_id=board-3') return { ok: true, json: async () => [thirdTask] };
      if (url === '/api/users') return {
        ok: true,
        json: async () => [
          { id: 'user-1', full_name: 'Board Owner' },
          { id: 'user-2', full_name: 'Teammate' },
          { id: 'user-3', full_name: 'Project Lead' },
        ],
      };
      if (url === '/api/initiatives') return { ok: true, json: async () => initiatives };
      if (url === '/api/initiatives/initiative-1') {
        return { ok: true, json: async () => ({ initiative: initiatives[0], tasks: [firstTask] }) };
      }
      if (url === '/api/initiatives/initiative-2') {
        return { ok: true, json: async () => ({ initiative: initiatives[1], tasks: [secondTask] }) };
      }
      if (url === '/api/initiatives/initiative-3') {
        return { ok: true, json: async () => ({ initiative: initiatives[2], tasks: [thirdTask] }) };
      }
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    }));
    render(<App />);

    expect(await screen.findByText('Board two task')).toBeTruthy();
    const boardFilter = screen.getByLabelText('Filter by board');
    const initiativeFilter = screen.getByLabelText('Filter by initiative');
    const assigneeFilter = screen.getByLabelText('Filter by assignee');
    const toggleHomeFilter = (filter: HTMLElement, optionName: string) => {
      if (filter.getAttribute('aria-expanded') !== 'true') fireEvent.click(filter);
      fireEvent.click(screen.getByRole('checkbox', { name: optionName }));
    };
    fireEvent.click(boardFilter);
    await waitFor(() => expect((initiativeFilter as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(initiativeFilter);
    fireEvent.click(assigneeFilter);
    expect(boardFilter.textContent).toContain('Board: All');
    expect(initiativeFilter.textContent).toContain('Initiative: All');
    expect(assigneeFilter.textContent).toContain('Assignee: All');
    expect((screen.getByRole('checkbox', { name: 'Board: All' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.pointerDown(screen.getByLabelText('Group tasks by'));
    expect(boardFilter.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('checkbox', { name: 'Board: All' })).toBeNull();

    toggleHomeFilter(boardFilter, 'Board: All');
    expect(boardFilter.textContent).toContain('Board: None');
    expect(screen.queryByText('Board one task')).toBeNull();
    expect(screen.queryByText('Board two task')).toBeNull();
    toggleHomeFilter(boardFilter, 'Board: Board Owner');
    expect(boardFilter.textContent).toContain('Board: Board Owner');
    expect(screen.getByText('Board one task')).toBeTruthy();
    toggleHomeFilter(boardFilter, 'Board: Project Board');
    expect(boardFilter.textContent).toContain('Board: Multiple');
    expect(screen.getByText('Board one task')).toBeTruthy();
    expect(screen.getByText('Board two task')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Board: All' }) as HTMLInputElement).checked).toBe(false);
    toggleHomeFilter(boardFilter, 'Board: Board Owner');
    expect(boardFilter.textContent).toContain('Board: Project Board');
    expect(screen.queryByText('Board one task')).toBeNull();
    expect(screen.getByText('Board two task')).toBeTruthy();
    toggleHomeFilter(boardFilter, 'Board: Board Owner');
    expect(boardFilter.textContent).toContain('Board: Multiple');
    toggleHomeFilter(boardFilter, 'Board: Roadmap Board');
    expect(boardFilter.textContent).toContain('Board: All');
    expect((screen.getByRole('checkbox', { name: 'Board: All' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Board three task')).toBeTruthy();
    toggleHomeFilter(boardFilter, 'Board: All');
    toggleHomeFilter(boardFilter, 'Board: All');
    expect(boardFilter.textContent).toContain('Board: All');
    expect(screen.getByText('Board one task')).toBeTruthy();

    fireEvent.click(initiativeFilter);
    expect(await screen.findByRole('checkbox', { name: 'Initiative: Growth Initiative' })).toBeTruthy();
    toggleHomeFilter(initiativeFilter, 'Initiative: All');
    expect(initiativeFilter.textContent).toContain('Initiative: None');
    expect(screen.queryByText('Board one task')).toBeNull();
    toggleHomeFilter(initiativeFilter, 'Initiative: Launch Initiative');
    expect(initiativeFilter.textContent).toContain('Initiative: Launch Initiative');
    expect(screen.getByText('Board one task')).toBeTruthy();
    toggleHomeFilter(initiativeFilter, 'Initiative: Growth Initiative');
    expect(initiativeFilter.textContent).toContain('Initiative: Multiple');
    expect(screen.getByText('Board two task')).toBeTruthy();
    expect(screen.queryByText('Board three task')).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Initiative: All' }) as HTMLInputElement).checked).toBe(false);
    toggleHomeFilter(initiativeFilter, 'Initiative: Retention Initiative');
    expect(initiativeFilter.textContent).toContain('Initiative: All');
    expect((screen.getByRole('checkbox', { name: 'Initiative: All' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Board three task')).toBeTruthy();
    toggleHomeFilter(initiativeFilter, 'Initiative: All');
    toggleHomeFilter(initiativeFilter, 'Initiative: All');
    expect(initiativeFilter.textContent).toContain('Initiative: All');

    toggleHomeFilter(assigneeFilter, 'Assignee: All');
    expect(assigneeFilter.textContent).toContain('Assignee: None');
    expect(screen.queryByText('Board one task')).toBeNull();
    toggleHomeFilter(assigneeFilter, 'Assignee: Board Owner');
    expect(assigneeFilter.textContent).toContain('Assignee: Board Owner');
    expect(screen.getByText('Board one task')).toBeTruthy();
    toggleHomeFilter(assigneeFilter, 'Assignee: Teammate');
    expect(assigneeFilter.textContent).toContain('Assignee: Multiple');
    expect(screen.getByText('Board two task')).toBeTruthy();
    expect(screen.queryByText('Unassigned task')).toBeNull();
    toggleHomeFilter(assigneeFilter, 'Assignee: Unassigned');
    expect(assigneeFilter.textContent).toContain('Assignee: Multiple');
    expect(screen.getByText('Unassigned task')).toBeTruthy();
    toggleHomeFilter(assigneeFilter, 'Assignee: Project Lead');
    expect(assigneeFilter.textContent).toContain('Assignee: All');
    expect((screen.getByRole('checkbox', { name: 'Assignee: All' }) as HTMLInputElement).checked).toBe(true);
    toggleHomeFilter(assigneeFilter, 'Assignee: All');
    toggleHomeFilter(assigneeFilter, 'Assignee: All');
    expect(assigneeFilter.textContent).toContain('Assignee: All');
  });

  it('lists all board tasks in state order with filters and selectable page sizes', async () => {
    const states = ['Complete', 'Backlog', 'ToDo', 'InProgress'] as const;
    const allTasks = Array.from({ length: 32 }, (_, index) => taskResponse({
      id: `task-${String(index).padStart(2, '0')}`,
      title: `Task ${String(index).padStart(2, '0')}`,
      state: states[index % states.length],
      assigned_to_id: index % 2 === 0 ? 'user-1' : null,
    }));
    const initiative: Initiative = {
      id: 'initiative-1',
      title: 'Launch Initiative',
      description: null,
      complete_by: null,
      assigned_to_id: null,
      created_by_id: 'boardowner',
      created_at: '',
      updated_at: '',
    };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url === '/api/tasks?board_id=board-1') return { ok: true, json: async () => allTasks.slice(0, 16) };
      if (url === '/api/tasks?board_id=board-2') return { ok: true, json: async () => allTasks.slice(16) };
      if (url === '/api/users') return { ok: true, json: async () => [{ id: 'user-1', full_name: 'Board Owner' }] };
      if (url === '/api/initiatives') return { ok: true, json: async () => [initiative] };
      if (url === '/api/initiatives/initiative-1') {
        return { ok: true, json: async () => ({ initiative, tasks: [allTasks[3]] }) };
      }
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    }));
    render(<App />);

    await screen.findByRole('heading', { name: 'Board Owner' });
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(window.location.pathname).toBe('/tasks');
    await screen.findByText('Task 03');
    expect(await screen.findByRole('option', { name: 'Launch Initiative' })).toBeTruthy();

    const taskRows = () => screen.getAllByRole('row').slice(1);
    expect(taskRows()).toHaveLength(25);
    const orderedStates = taskRows().map((row) => within(row).getAllByRole('cell')[1].textContent);
    expect(orderedStates.slice(0, 8)).toEqual(Array(8).fill('In Progress'));
    expect(orderedStates.slice(8, 16)).toEqual(Array(8).fill('To Do'));
    expect(orderedStates.slice(16, 24)).toEqual(Array(8).fill('Backlog'));
    expect(orderedStates[24]).toBe('Complete');
    expect(screen.getByText('Showing 1–25 of 32 tasks')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(taskRows()).toHaveLength(7);
    expect(screen.getByText('Showing 26–32 of 32 tasks')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Tasks per page'), { target: { value: '50' } });
    expect(taskRows()).toHaveLength(32);

    fireEvent.change(screen.getByLabelText('Filter by state'), { target: { value: 'InProgress' } });
    expect(taskRows()).toHaveLength(8);
    expect(taskRows().every((row) => within(row).getAllByRole('cell')[1].textContent === 'In Progress')).toBe(true);

    fireEvent.change(screen.getByLabelText('Filter by board'), { target: { value: 'board-2' } });
    expect(taskRows()).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Filter by state'), { target: { value: '' } });
    expect(taskRows()).toHaveLength(16);

    fireEvent.change(screen.getByLabelText('Filter by board'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter by initiative'), { target: { value: 'initiative-1' } });
    expect(taskRows()).toHaveLength(1);
    expect(within(taskRows()[0]).getByText('Task 03')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter by initiative'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter by assignee'), { target: { value: 'assignee:user-1' } });
    expect(taskRows()).toHaveLength(16);
    fireEvent.change(screen.getByLabelText('Filter by assignee'), { target: { value: 'unassigned' } });
    expect(taskRows()).toHaveLength(16);
  });

  it('uses compact task cards and the mobile filter drawer on portrait screens', async () => {
    const mobileMediaQuery = {
      matches: true,
      media: '(max-width: 767px), (orientation: portrait) and (max-width: 1024px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const defaultFetch = mockBoardReads();
    vi.stubGlobal('matchMedia', vi.fn(() => mobileMediaQuery));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/tasks?board_id=board-1') {
        return { ok: true, json: async () => [taskResponse({ id: 'portrait-1', title: 'Portrait task one', state: 'InProgress' })] };
      }
      if (url === '/api/tasks?board_id=board-2') {
        return { ok: true, json: async () => [taskResponse({ id: 'portrait-2', title: 'Portrait task two', board_id: 'board-2' })] };
      }
      return defaultFetch(url);
    }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open navigation menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(await screen.findByRole('list', { name: 'Tasks' })).toBeTruthy();
    expect(await screen.findByText('Portrait task one')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Create' }).parentElement?.className).toContain('mobile-create-menu');

    fireEvent.click(screen.getByRole('button', { name: 'Open filters' }));
    const filters = screen.getByRole('dialog', { name: 'Task filters' });
    fireEvent.change(within(filters).getByLabelText('Filter by board'), { target: { value: 'board-2' } });
    expect(screen.queryByText('Portrait task one')).toBeNull();
    expect(screen.getByText('Portrait task two')).toBeTruthy();
    fireEvent.click(within(filters).getByRole('button', { name: 'Close filters' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'User menu for boardowner' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));
    expect(window.location.pathname).toBe('/profile');
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Create' }).parentElement?.className).toContain('mobile-create-menu');

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'User menu for boardowner' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(window.location.pathname).toBe('/settings');
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Create' }).parentElement?.className).toContain('mobile-create-menu');
  });

  it('hides completed tasks from the home board after 24 hours', async () => {
    const completedTasks = [
      taskResponse({
        id: 'recent-complete',
        title: 'Recently completed',
        state: 'Complete',
        completed_at: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
      }),
      taskResponse({
        id: 'expired-complete',
        title: 'Expired completion',
        state: 'Complete',
        completed_at: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000).toISOString(),
      }),
      taskResponse({
        id: 'missing-completion-date',
        title: 'Completion date unavailable',
        state: 'Complete',
        completed_at: null,
      }),
    ];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url === '/api/tasks?board_id=board-1') return { ok: true, json: async () => completedTasks };
      if (url === '/api/tasks?board_id=board-2') return { ok: true, json: async () => [] };
      if (url === '/api/users') return { ok: true, json: async () => [{ id: 'user-1', full_name: 'Board Owner' }] };
      if (url === '/api/initiatives') return { ok: true, json: async () => [] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    }));
    render(<App />);

    const completeColumn = await screen.findByText('Recently completed');
    expect(completeColumn).toBeTruthy();
    expect(screen.getByText('Completion date unavailable')).toBeTruthy();
    expect(screen.queryByText('Expired completion')).toBeNull();
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
  
      await screen.findByRole('heading', { name: 'Board Owner' });
      fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Task' }));
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Review the garden plan' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Task' }));
      const confirmation = await screen.findByRole('alertdialog', { name: 'Create task without an assignee?' });
      const assignToMeButton = within(confirmation).getByRole('button', { name: 'Assign Task to me' });
      const leaveUnassignedButton = within(confirmation).getByRole('button', { name: 'Leave Task Unassigned' });
      expect(assignToMeButton.className).toContain('bg-blue-600');
      expect(leaveUnassignedButton.className).toContain('bg-white');
      expect(document.activeElement).toBe(assignToMeButton);
      fireEvent.click(leaveUnassignedButton);
  
      expect(screen.queryByRole('heading', { name: 'Backlog' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Active' }).getAttribute('aria-current')).toBe('page');
      expect(window.location.pathname).toBe('/');
      const backlogNotification = await screen.findByRole('status');
      expect(backlogNotification.textContent).toContain('Review the garden plan was added to Backlog.');
      fireEvent.click(within(backlogNotification).getByRole('button', { name: 'Show task on board' }));
      expect(screen.getByRole('button', { name: 'Backlog' }).getAttribute('aria-current')).toBe('page');
      expect(await screen.findByText('Review the garden plan')).toBeTruthy();
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

  it('assigns a newly created task to a selected initiative', async () => {
    const originalFetchMock = mockBoardReads();
    const initiative = {
      id: 'initiative-1',
      title: 'Launch planning',
      description: null,
      complete_by: null,
      assigned_to_id: null,
      created_by_id: 'boardowner',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/initiatives') return { ok: true, json: async () => [initiative] };
      if (url === '/api/tasks' && options?.method === 'POST') {
        return { ok: true, json: async () => taskResponse({ id: 'created-task', title: 'Plan launch' }) };
      }
      if (url === '/api/initiatives/initiative-1/tasks' && options?.method === 'POST') {
        return { ok: true, status: 204 };
      }
      return originalFetchMock(url);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByRole('heading', { name: 'Board Owner' });
    fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Task' }));
    const createTaskDialog = screen.getByRole('dialog', { name: 'Create task' });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Plan launch' } });
    const initiativeCombo = within(createTaskDialog).getByRole('combobox', { name: 'Initiative' });
    fireEvent.change(initiativeCombo, { target: { value: 'Launch' } });
    fireEvent.click(await within(createTaskDialog).findByRole('option', { name: 'Launch planning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Task' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Assign Task to me' }));

    expect((await screen.findByRole('status')).textContent).toContain('Plan launch was added to Backlog.');
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"assigned_to_id":"boardowner"'),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/initiatives/initiative-1/tasks', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ task_id: 'created-task' }),
    }));
  });

  it('suggests initiatives linked to the selected board in task pickers', async () => {
    const boardOneTask = taskResponse({
      id: 'task-board-one',
      title: 'Board one task',
      state: 'ToDo',
    });
    const boardTwoTask = taskResponse({
      id: 'task-board-two',
      title: 'Board two task',
      state: 'ToDo',
    });
    const initiativeOne = {
      id: 'initiative-one',
      title: 'Launch initiative',
      description: null,
      complete_by: null,
      assigned_to_id: null,
      created_by_id: 'boardowner',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };
    const initiativeTwo = {
      ...initiativeOne,
      id: 'initiative-two',
      title: 'Hiring initiative',
    };
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url === '/api/tasks?board_id=board-1') return { ok: true, json: async () => [boardOneTask] };
      if (url === '/api/tasks?board_id=board-2') return { ok: true, json: async () => [boardTwoTask] };
      if (url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      if (url === '/api/initiatives') return { ok: true, json: async () => [initiativeOne, initiativeTwo] };
      if (url === '/api/initiatives/initiative-one') {
        return { ok: true, json: async () => ({ initiative: initiativeOne, tasks: [boardOneTask] }) };
      }
      if (url === '/api/initiatives/initiative-two') {
        return { ok: true, json: async () => ({ initiative: initiativeTwo, tasks: [boardTwoTask] }) };
      }
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByRole('heading', { name: 'Board Owner' });
    fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Task' }));
    const createDialog = screen.getByRole('dialog', { name: 'Create task' });
    const createPicker = within(createDialog).getByRole('combobox', { name: 'Initiative' });
    fireEvent.click(createPicker);
    expect(await within(createDialog).findByRole('option', { name: 'Launch initiative' })).toBeTruthy();
    expect(within(createDialog).queryByRole('option', { name: 'Hiring initiative' })).toBeNull();

    fireEvent.change(within(createDialog).getByLabelText('Board'), { target: { value: 'board-2' } });
    expect(await within(createDialog).findByRole('option', { name: 'Hiring initiative' })).toBeTruthy();
    expect(within(createDialog).queryByRole('option', { name: 'Launch initiative' })).toBeNull();
    fireEvent.change(createPicker, { target: { value: 'Launch' } });
    expect(await within(createDialog).findByRole('option', { name: 'Launch initiative' })).toBeTruthy();

    fireEvent.click(within(createDialog).getByRole('button', { name: 'Close create task form' }));
    fireEvent.click(await screen.findByText('Board two task'));
    const detailsDialog = screen.getByRole('dialog', { name: 'Task details' });
    const detailsPicker = within(detailsDialog).getByRole('combobox', { name: 'Initiatives' });
    fireEvent.focus(detailsPicker);
    expect(await within(detailsDialog).findByRole('option', { name: 'Hiring initiative' })).toBeTruthy();
    expect(within(detailsDialog).queryByRole('option', { name: 'Launch initiative' })).toBeNull();
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

    await screen.findByRole('heading', { name: 'Board Owner' });
    const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Initiatives' }));
    const search = screen.getByRole('searchbox', { name: 'Search tasks' });
    fireEvent.change(search, { target: { value: 'launch' } });

    fireEvent.click(await screen.findByRole('option', { name: 'Prepare launch report — Project Board' }));
    await screen.findByRole('dialog', { name: 'Task details' });
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Prepare launch report');
    expect((within(screen.getByRole('dialog', { name: 'Task details' })).getByLabelText('Board') as HTMLSelectElement).value).toBe('board-2');
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

    await screen.findByRole('heading', { name: 'Board Owner' });
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

  it('loads task comments and lets users select and post a full-name user mention', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/tasks/task-1/comments' && options?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            id: 'comment-1',
            task_id: 'task-1',
            body: JSON.parse(String(options.body)).body,
            author_username: 'boardowner',
            author_name: 'Board Owner',
            created_at: '2026-10-18T18:00:00Z',
          }),
        };
      }
      if (url === '/api/tasks/task-1/comments') return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <TaskDetailsOverlay
        task={{ id: 'task-1', columnId: 'todo', state: 'ToDo', priority: 'Medium', title: 'Task title' }}
        boards={[{ id: 'board-1', title: 'Board', owner_id: 'boardowner', is_personal: true }]}
        assignees={[{ id: 'alex', full_name: 'Alex', legal_name: 'Alexander Smith' }]}
        initiatives={[]}
        boardInitiatives={[]}
        linkedInitiatives={[]}
        selectedBoardId="board-1"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onInitiativesChanged={vi.fn()}
      />
    );

    await screen.findByText('No comments yet.');
    const commentInput = screen.getByLabelText('Add a comment') as HTMLTextAreaElement;
    fireEvent.change(commentInput, { target: { value: 'Please ask @Alexander' } });
    fireEvent.click(screen.getByRole('option', { name: /Alexander Smith/ }));
    expect(commentInput.value).toBe('Please ask @alex ');
    fireEvent.change(commentInput, { target: { value: 'Please ask @alex to review this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect(await screen.findByText('Please ask @alex to review this')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1/comments', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ body: 'Please ask @alex to review this' }),
    }));
  });
});
