import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App, { AuthenticatedBoard } from '../src/App';
import type { Task } from '../src/App';
import type { Initiative } from '../src/api';
import { Column } from '../src/TaskBoard';
import { sortTasksByCompleteByAndPriority, sortTasksByPriority } from '../src/taskPriority';

import { taskResponse, boardList, mockBoardReads } from './appTestUtils';

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
      expect(screen.getByText('Task details')).toBeTruthy();
  
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
    const boardFilter = screen.getByLabelText('Filter by board') as HTMLSelectElement;
    const initiativeFilter = screen.getByLabelText('Filter by initiative') as HTMLSelectElement;
    const assigneeFilter = screen.getByLabelText('Filter by assignee') as HTMLSelectElement;
    expect(await screen.findByRole('option', { name: 'Launch Initiative' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Unassigned' })).toBeTruthy();

    fireEvent.change(boardFilter, { target: { value: 'board-2' } });
    fireEvent.change(initiativeFilter, { target: { value: 'initiative-1' } });
    expect(screen.queryByText('Second board task')).toBeNull();
    expect(screen.queryByText('Linked task')).toBeNull();
    fireEvent.change(boardFilter, { target: { value: 'board-1' } });
    expect(await screen.findByText('Linked task')).toBeTruthy();
    expect(screen.queryByText('Second board task')).toBeNull();
    fireEvent.change(assigneeFilter, { target: { value: 'assignee:user-1' } });
    expect(screen.getByText('Linked task')).toBeTruthy();
    expect(screen.queryByText('Second board task')).toBeNull();
    fireEvent.change(assigneeFilter, { target: { value: 'unassigned' } });
    expect(screen.queryByText('Linked task')).toBeNull();
    fireEvent.change(initiativeFilter, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
    expect(await screen.findByText('Unlinked backlog task')).toBeTruthy();
    expect(screen.queryByText('Linked task')).toBeNull();
    fireEvent.change(assigneeFilter, { target: { value: 'all' } });
    fireEvent.change(initiativeFilter, { target: { value: 'initiative-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Active' }));

    fireEvent.change(screen.getByLabelText('Group tasks by'), { target: { value: 'assignee' } });
    expect(boardFilter.value).toBe('board-1');
    expect(initiativeFilter.value).toBe('initiative-1');
    expect(assigneeFilter.value).toBe('all');
    expect(screen.getByLabelText('Filter by board')).toBeTruthy();
    expect(screen.getByLabelText('Filter by initiative')).toBeTruthy();
    expect(screen.getByLabelText('Filter by assignee')).toBeTruthy();
    expect(screen.getByText('Linked task')).toBeTruthy();
    expect(screen.queryByText('Second board task')).toBeNull();
    fireEvent.change(boardFilter, { target: { value: '' } });
    fireEvent.change(initiativeFilter, { target: { value: '' } });

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
  
      expect(await screen.findByText('Review the garden plan')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Backlog' })).toBeNull();
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
});
