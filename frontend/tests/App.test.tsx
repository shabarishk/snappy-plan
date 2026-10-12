import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

vi.mock('@dnd-kit/core', async () => {
  const React = await import('react');
  type TaskData = { type: string; task?: { id: string; columnId: string; title: string } };
  type DragEvent = {
    active: { id: string; data: { current?: TaskData } };
    over?: { id: string; data: { current?: TaskData } } | null;
  };
  type DndProps = {
    children: React.ReactNode;
    onDragStart: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDragEnd: (event: DragEvent) => void;
  };
  const task = { id: '1', columnId: 'backlog', title: 'Setup Unraid Docker' };
  const active = { id: task.id, data: { current: { type: 'Task', task } } };
  const taskOver = { id: '2', data: { current: { type: 'Task' } } };

  return {
    DndContext: ({ children, onDragStart, onDragOver, onDragEnd }: DndProps) =>
      React.createElement(React.Fragment, null,
        children,
        React.createElement('button', { onClick: () => onDragStart({ active }) }, 'Start drag'),
        React.createElement('button', { onClick: () => onDragOver({ active, over: taskOver }) }, 'Drag over task'),
        React.createElement('button', {
          onClick: () => onDragOver({ active, over: { id: 'complete', data: { current: { type: 'Column' } } } }),
        }, 'Drag over column'),
        React.createElement('button', {
          onClick: () => onDragOver({ active: { id: 'unknown', data: { current: { type: 'Other' } } }, over: taskOver }),
        }, 'Drag non-task'),
        React.createElement('button', { onClick: () => onDragOver({ active, over: null }) }, 'Drag without target'),
        React.createElement('button', {
          onClick: () => onDragOver({ active, over: { id: active.id, data: { current: { type: 'Task' } } } }),
        }, 'Drag over itself'),
        React.createElement('button', { onClick: () => onDragEnd({ active, over: taskOver }) }, 'End drag over task'),
        React.createElement('button', { onClick: () => onDragEnd({ active, over: null }) }, 'End drag without target'),
      ),
    DragOverlay: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    closestCorners: vi.fn(),
    KeyboardSensor: vi.fn(),
    PointerSensor: vi.fn(),
    useSensor: () => ({}),
    useSensors: (...sensors: object[]) => sensors,
  };
});

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  arrayMove: <T,>(items: T[], from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    if (item !== undefined) next.splice(to, 0, item);
    return next;
  },
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App board', () => {
  it('requires auth before rendering the board', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ setup_required: false }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Backlog' })).toBeNull();
  });

  it('renders columns and supports task drag state and column moves after authentication', async () => {
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
    expect(screen.getAllByText('1 tasks')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Kanban board columns' }).getAttribute('style'))
      .toContain('repeat(3, minmax(0, 1fr))');

    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
    expect(screen.getByRole('heading', { name: 'Backlog' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Backlog tasks' }).getAttribute('style'))
      .toContain('minmax(0, 1fr)');
    expect(screen.getByText('Setup Unraid Docker')).toBeTruthy();
    expect(screen.getByText('Configure and verify the production container.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move to To Do' }));
    expect(screen.getByText('0 tasks')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Kanban board' }));
    expect(screen.getByRole('heading', { name: 'To Do' })).toBeTruthy();
    expect(screen.getByText('Setup Unraid Docker')).toBeTruthy();
    expect(screen.getByText('2 tasks')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start drag' }));
    expect(screen.getAllByText('Setup Unraid Docker')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Drag over task' }));
    expect(screen.getByText('To Do')).toBeTruthy();
    expect(screen.getByText('2 tasks')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Drag over column' }));
    expect(screen.getByText('Complete')).toBeTruthy();
    expect(screen.getAllByText('1 tasks')).toHaveLength(3);
    expect(screen.getByText('Completed', { exact: false })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Drag over task' }));
    expect(screen.queryByText('Completed', { exact: false })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Drag non-task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Drag without target' }));
    fireEvent.click(screen.getByRole('button', { name: 'Drag over itself' }));
    fireEvent.click(screen.getByRole('button', { name: 'End drag over task' }));
    fireEvent.click(screen.getByRole('button', { name: 'End drag without target' }));
  });
});
