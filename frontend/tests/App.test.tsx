import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { sortTasksByPriority } from '../src/taskPriority';

vi.mock('@dnd-kit/core', async () => {
  const React = await import('react');

  return {
    DndContext: ({ children }: { children: React.ReactNode }) => children,
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
});
