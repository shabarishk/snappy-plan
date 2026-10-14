import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const boardList = [
  { id: 'board-1', title: 'Board Owner', owner_id: 'boardowner' },
  { id: 'board-2', title: 'Project Board', owner_id: 'boardowner' },
];

const mockBoardReads = () => vi.fn().mockImplementation(async (url: string) => {
  if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
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
  window.history.replaceState({}, '', '/');
  window.localStorage.removeItem('snappy-plan-selected-board');
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

    await waitFor(() => expect(screen.getByRole('button', { name: 'Current board: Board Owner' })).toBeTruthy());
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

  it('switches boards and creates a shared board', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/boards' && options?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'board-3', title: 'New Shared Board', owner_id: 'boardowner' }) };
      }
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
      if (url === '/api/users') return {
        ok: true,
        json: async () => [{ id: 'user-2', full_name: 'Teammate' }],
      };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Current board: Board Owner' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project Board' }));
    expect(await screen.findByRole('button', { name: 'Current board: Project Board' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks?board_id=board-2', { credentials: 'same-origin' });

    fireEvent.click(screen.getByRole('button', { name: 'Current board: Project Board' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '+ Create new board' }));
    const dialog = screen.getByRole('dialog', { name: 'Create a new board' });
    fireEvent.change(screen.getByLabelText('Board name'), { target: { value: 'New Shared Board' } });
    fireEvent.click(screen.getByLabelText('Teammate (user-2)'));
    fireEvent.submit(dialog.querySelector('form')!);

    expect(await screen.findByRole('button', { name: 'Current board: New Shared Board' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/boards', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ title: 'New Shared Board', user_ids: ['user-2'] }),
    }));
  });

  it('provides Home and a user menu with an editable profile', async () => {
    const fetchMock = mockBoardReads();
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url === '/api/profile/password' && options?.method === 'PUT') {
        return { ok: true, json: async () => ({ message: 'Password updated successfully' }) };
      }
      if (url === '/api/profile' && options?.method === 'PUT') {
        const body = JSON.parse(options.body as string) as { full_name: string; email: string };
        return { ok: true, json: async () => ({ username: 'boardowner', ...body }) };
      }
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

    await screen.findByRole('button', { name: 'Current board: Board Owner' });
    const userMenuButton = await screen.findByRole('button', { name: 'User menu for boardowner' });
    expect(userMenuButton.textContent).toBe('B');
    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
    expect(screen.getByRole('heading', { name: 'Backlog' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('heading', { name: 'To Do' })).toBeTruthy();

    fireEvent.click(userMenuButton);
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    expect(window.location.pathname).toBe('/settings');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Profile settings' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText('Re-enter new password'), { target: { value: 'different-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect((await screen.findByRole('alert')).textContent).toContain('New password and confirmation do not match.');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/profile/password', expect.anything());

    fireEvent.change(screen.getByLabelText('Re-enter new password'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect((await screen.findByRole('status')).textContent).toContain('Password updated successfully.');
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect(fetchMock).toHaveBeenCalledWith('/api/profile/password', expect.objectContaining({
      method: 'PUT',
      credentials: 'same-origin',
      body: JSON.stringify({
        current_password: 'old-password',
        new_password: 'new-password',
        confirm_password: 'new-password',
      }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'User menu for boardowner' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));

    expect(await screen.findByRole('heading', { name: 'Profile', level: 1 })).toBeTruthy();
    expect(window.location.pathname).toBe('/profile');
    expect(screen.getByRole('region', { name: 'Profile details' }).textContent).toContain('boardowner');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('Full name') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('owner@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Updated Owner' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'updated@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect((screen.getByLabelText('Full name') as HTMLInputElement).disabled).toBe(true));
    expect(screen.getByRole('heading', { name: 'Profile', level: 1 })).toBeTruthy();
    expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('Updated Owner');
    expect(fetchMock).toHaveBeenCalledWith('/api/profile', expect.objectContaining({
      method: 'PUT',
      credentials: 'same-origin',
      body: JSON.stringify({ full_name: 'Updated Owner', email: 'updated@example.com' }),
    }));
    expect(screen.getByRole('button', { name: 'User menu for boardowner' }).textContent).toBe('U');
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('heading', { name: 'To Do' })).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });

  it('logs out from the user menu and returns to the login screen', async () => {
    let authChecks = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/auth/status') {
        authChecks += 1;
        return { ok: true, json: async () => ({ authenticated: authChecks === 1 }) };
      }
      if (url === '/api/setup/status') return { ok: true, json: async () => ({ setup_required: false }) };
      if (url.startsWith('/api/tasks?board_id=') || url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({
          username: 'boardowner',
          full_name: 'Board Owner',
          email: 'owner@example.com',
          role: 'user',
        }),
      };
      if (url === '/api/logout') return { ok: true, status: 204 };
      return { ok: false, text: async () => 'Unexpected request' };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'User menu for boardowner' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    expect(window.location.pathname).toBe('/');
    expect(fetchMock).toHaveBeenCalledWith('/api/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(authChecks).toBe(2);
  });

  it('shows the admin tile to admins and supports creating and promoting users', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url === '/api/admin/boards') return {
        ok: true,
        json: async () => [
          { id: 'board-1', title: 'Admin Personal Board', owner_id: 'adminuser', owner_name: 'Admin User' },
          { id: 'board-2', title: 'Member Board', owner_id: 'member', owner_name: 'Member User' },
        ],
      };
      if (url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({
          username: 'adminuser',
          full_name: 'Admin User',
          email: 'admin@example.com',
          role: 'admin',
        }),
      };
      if (url === '/api/admin/users' && options?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            username: 'newuser',
            full_name: 'newuser',
            email: 'new@example.com',
            role: 'user',
          }),
        };
      }
      if (url === '/api/admin/users/member/role' && options?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({
            username: 'member',
            full_name: 'Member User',
            email: 'member@example.com',
            role: 'admin',
          }),
        };
      }
      if (url === '/api/admin/users') return {
        ok: true,
        json: async () => [{
          username: 'member',
          full_name: 'Member User',
          email: 'member@example.com',
          role: 'user',
        }],
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    const adminTile = await screen.findByRole('button', { name: 'Admin' });
    const userTile = await screen.findByRole('button', { name: 'User menu for adminuser' });
    expect(adminTile.compareDocumentPosition(userTile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(adminTile);
    expect(await screen.findByRole('heading', { name: 'Create user' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'User management' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'All boards' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Board management' }));
    expect(await screen.findByRole('heading', { name: 'All boards' })).toBeTruthy();
    expect(await screen.findByText('Member Board')).toBeTruthy();
    expect(screen.getByText('Owned by Member User (member)')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/boards', { credentials: 'same-origin' });
    expect(screen.queryByRole('heading', { name: 'Create user' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'User management' }));
    expect(await screen.findByRole('heading', { name: 'Create user' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newuser' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
    expect((await screen.findByRole('status')).textContent).toContain('User newuser created.');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ username: 'newuser', email: 'new@example.com', password: 'password123' }),
    }));

    const memberRow = screen.getByText('member').closest('tr');
    expect(memberRow).toBeTruthy();
    fireEvent.click(within(memberRow as HTMLElement).getByRole('button', { name: 'Make admin' }));
    expect((await screen.findByRole('status')).textContent).toContain('member is now an administrator.');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/users/member/role', expect.objectContaining({
      method: 'PATCH',
      credentials: 'same-origin',
      body: JSON.stringify({ role: 'admin' }),
    }));
    expect(screen.getAllByText('admin', { selector: 'td' })).toHaveLength(1);
  });

  it('opens the page selected by the current URL and follows browser history', async () => {
    window.history.replaceState({}, '', '/settings');
    vi.stubGlobal('fetch', mockBoardReads());
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    expect(screen.getByLabelText('Current password')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { name: 'To Do' })).toBeTruthy();

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe('/settings'));
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
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
      if (url === '/api/users') return { ok: true, json: async () => [] };
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
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
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
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByRole('button', { name: 'Current board: Board Owner' });
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
});
