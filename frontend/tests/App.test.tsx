import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App, { AuthenticatedBoard, type Task } from '../src/App';
import { sortTasksByPriority } from '../src/taskPriority';

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authenticated: true }),
    }));
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
});
