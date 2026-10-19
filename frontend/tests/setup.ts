import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

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
      onDragEnd,
    }: {
      children: React.ReactNode;
      onDragStart: (event: never) => void;
      onDragEnd: (event: never) => void;
    }) => {
      const [over, setOver] = React.useState<{ id: string; data: { current: { type: string; columnId?: string } } } | null>(null);
      const active = { id: task.id, data: { current: { type: 'Task', task } } };

      return React.createElement(React.Fragment, null,
        children,
        React.createElement('button', {
          onClick: () => onDragStart({
          active: { id: task.id, data: { current: { type: 'Task', task } } },
          } as never),
        }, 'Mock drag start'),
        React.createElement('button', {
          onClick: () => {
            const destination = { id: 'complete', data: { current: { type: 'Column', columnId: 'complete' } } };
            setOver(destination);
          },
        }, 'Mock drag over Complete'),
        React.createElement('button', {
          onClick: () => {
            const destination = { id: 'in-progress', data: { current: { type: 'Column', columnId: 'in-progress' } } };
            setOver(destination);
          },
        }, 'Mock drag over In Progress'),
        React.createElement('button', {
          onClick: () => {
            setOver(null);
          },
        }, 'Mock drag without target'),
        React.createElement('button', {
          onClick: () => onDragEnd({ active, over } as never),
        }, 'Mock drag end'),
      );
    },
    DragOverlay: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    closestCorners: vi.fn(),
    KeyboardSensor: vi.fn(),
    PointerSensor: vi.fn(),
    useSensor: () => ({}),
    useSensors: (...sensors: object[]) => sensors,
    useDraggable: vi.fn(() => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      isDragging: false,
    })),
    useDroppable: () => ({ setNodeRef: vi.fn() }),
  };
});

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  window.localStorage.removeItem('snappy-plan-selected-board');
  vi.unstubAllGlobals();
});
