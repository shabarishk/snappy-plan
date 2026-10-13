import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App, { AuthenticatedBoard, type Task } from '../src/App';
import { sortTasksByPriority } from '../src/taskPriority';

const taskResponse = (overrides: Record<string, unknown> = {}) => ({
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

const mockBoardReads = () => vi.fn().mockImplementation(async (url: string) => {
  if (url === '/api/tasks') return { ok: true, json: async () => [] };
  if (url === '/api/users') return {
    ok: true,
    json: async () => [{ id: 'user-1', full_name: 'Board Owner' }],
  };
  return { ok: true, json: async () => ({ authenticated: true }) };
});

vi.mock('@dnd-kit/core', async () => {
  const React = await import('react');
  const task = {
    id: 'task-1',
    columnId: 'backlog',
    state: 'Backlog',
    priority: 'High',
    title: 'Test task',
  };

  return {
    DndContext: ({
      children,
      onDragStart,
      onDragOver,
      onDragEnd,
    }: {
      children: React.ReactNode;
      onDragStart: (event: never) => void;
      onDragOver: (event: never) => void;
      onDragEnd: () => void;
    }) => React.createElement(React.Fragment, null,
      children,
      React.createElement('button', {
        onClick: () => onDragStart({
          active: { id: task.id, data: { current: { type: 'Task', task } } },
        } as never),
      }, 'Mock drag start'),
      React.createElement('button', {
        onClick: () => onDragOver({
          active: { id: task.id, data: { current: { type: 'Task', task } } },
          over: { id: 'complete', data: { current: { type: 'Column' } } },
        } as never),
      }, 'Mock drag over Complete'),
      React.createElement('button', {
        onClick: () => onDragOver({
          active: { id: task.id, data: { current: { type: 'Task', task } } },
          over: { id: 'in-progress', data: { current: { type: 'Column' } } },
        } as never),
      }, 'Mock drag over In Progress'),
      React.createElement('button', {
        onClick: () => onDragOver({
          active: { id: task.id, data: { current: { type: 'Task', task } } },
          over: null,
        } as never),
      }, 'Mock drag without target'),
      React.createElement('button', { onClick: onDragEnd }, 'Mock drag end'),
    ),
    DragOverlay: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    closestCorners: vi.fn(),
    KeyboardSensor: vi.fn(),
    PointerSensor: vi.fn(),
    useSensor: () => ({}),
    useSensors: (...sensors: object[]) => sensors,
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      isDragging: false,
    }),
    useDroppable: () => ({ setNodeRef: vi.fn() }),
  };
});

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App board', () => {
  it('orders tasks from highest to lowest priority', () => {
    const tasks = [
      { id: 'low', columnId: 'todo' as const, state: 'ToDo' as const, priority: 'Low' as const, title: 'Low priority' },
      { id: 'high', columnId: 'todo' as const, state: 'ToDo' as const, priority: 'High' as const, title: 'High priority' },
      { id: 'medium', columnId: 'todo' as const, state: 'ToDo' as const, priority: 'Medium' as const, title: 'Medium priority' },
    ];

    expect(sortTasksByPriority(tasks).map((task) => task.id)).toEqual(['high', 'medium', 'low']);
  });

  it('requires auth before rendering the board', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ setup_required: false }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Backlog' })).toBeNull();
  });

  it('renders an empty board after authentication', async () => {
    vi.stubGlobal('fetch', mockBoardReads());
    render(<App />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Snappy Plan' })).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'To Do' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'In Progress' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Complete' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Backlog' })).toBeNull();
    expect(screen.getAllByText('0 tasks')).toHaveLength(3);
    expect(screen.queryByText('Setup Unraid Docker')).toBeNull();
    expect(screen.queryByText('Configure iOS PWA settings')).toBeNull();
    expect(screen.queryByText('Build React UI')).toBeNull();
    expect(screen.getByRole('region', { name: 'Kanban board columns' }).getAttribute('style'))
      .toContain('repeat(3, minmax(0, 1fr))');

    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
    expect(screen.getByRole('heading', { name: 'Backlog' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Backlog tasks' }).getAttribute('style'))
      .toContain('minmax(0, 1fr)');
    expect(screen.getByText('0 tasks')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Kanban board' }));
    expect(screen.getByRole('heading', { name: 'To Do' })).toBeTruthy();
    expect(screen.getAllByText('0 tasks')).toHaveLength(3);
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
    expect(screen.getByText('Completed', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mock drag end' }));
    rerender(<AuthenticatedBoard tasks={tasks} setTasks={setTasks} />);
    expect(screen.getAllByText('Test task')).toHaveLength(1);
  });

  it('persists a drag-and-drop state change to the backend', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/tasks' && options?.method === 'PATCH') {
        return { ok: true, json: async () => taskResponse({
          id: 'task-1',
          state: 'InProgress',
        }) };
      }
      if (url === '/api/tasks') return {
        ok: true,
        json: async () => [taskResponse({
          id: 'task-1',
          state: 'ToDo',
          title: 'Move into progress',
        })],
      };
      if (url === '/api/users') return { ok: true, json: async () => [] };
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
      if (url === '/api/tasks/task-1' && options?.method === 'PUT') {
        return {
          ok: true,
          json: async () => taskResponse({
            id: 'task-1',
            title: 'Updated task title',
            description: 'Updated details',
            state: 'InProgress',
            priority: 'High',
            complete_by: '2026-10-20T16:30:00.000Z',
          }),
        };
      }
      if (url === '/api/tasks') {
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
      if (url === '/api/users') return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByText('Editable task'));
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated task title' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated details' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'High' } });
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'InProgress' } });
    fireEvent.change(screen.getByLabelText('Complete by'), { target: { value: '2026-10-20T09:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Updated task title')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        title: 'Updated task title',
        description: 'Updated details',
        priority: 'High',
        state: 'InProgress',
        complete_by: new Date('2026-10-20T09:30').toISOString(),
      }),
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
      if (url === '/api/tasks') return { ok: true, json: async () => [] };
      if (url === '/api/users') return {
        ok: true,
        json: async () => [{ id: 'user-1', full_name: 'Board Owner' }],
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByRole('heading', { name: 'Snappy Plan' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    const dialog = screen.getByRole('dialog', { name: 'Create task' });
    expect((screen.getByLabelText('Current state') as HTMLSelectElement).value).toBe('Backlog');
    expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('Medium');
    expect((screen.getByLabelText('Title') as HTMLInputElement).required).toBe(true);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Book a campsite' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Check the lake sites' } });
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
      if (url === '/api/tasks' && options?.method === 'POST') {
        const request = JSON.parse(options.body as string) as { title: string; state: string; priority: string };
        return { ok: true, json: async () => taskResponse(request) };
      }
      if (url === '/api/tasks') return { ok: true, json: async () => [] };
      if (url === '/api/users') return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByRole('heading', { name: 'Snappy Plan' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Review the garden plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Task' }));

    expect(await screen.findByText('Review the garden plan')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Backlog' })).toBeTruthy();
    expect(screen.getByText('Priority: Medium')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        title: 'Review the garden plan',
        description: '',
        assigned_to_id: '',
        state: 'Backlog',
        priority: 'Medium',
        complete_by: null,
      }),
    }));
  });
});
