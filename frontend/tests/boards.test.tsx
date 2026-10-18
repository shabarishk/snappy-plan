import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';

import { boardList } from './appTestUtils';

describe('Boards', () => {
  it('renames the protected personal board when the preferred name changes', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/members')) return { ok: true, json: async () => ({ user_ids: [] }) };
      if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
      if (url === '/api/boards') return {
        ok: true,
        json: async () => [{
          id: 'personal-1',
          title: "Sam's personal board",
          owner_id: 'boardowner',
          is_personal: true,
        }],
      };
      if (url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/profile' && options?.method === 'PUT') return {
        ok: true,
        json: async () => ({
          username: 'boardowner',
          full_name: 'Board Owner',
          preferred_name: 'Casey',
          email: 'owner@example.com',
          role: 'user',
        }),
      };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({
          username: 'boardowner',
          full_name: 'Board Owner',
          preferred_name: 'Sam',
          email: 'owner@example.com',
          role: 'user',
        }),
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'User menu for boardowner' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    fireEvent.change(screen.getByLabelText('Preferred name'), { target: { value: 'Casey' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/profile', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        full_name: 'Board Owner',
        preferred_name: 'Casey',
        email: 'owner@example.com',
      }),
    })));
    fireEvent.click(screen.getByRole('button', { name: 'Boards' }));
    expect(await screen.findByText("Casey's personal board")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Manage Casey's personal board" }));
    expect(await screen.findByRole('dialog', { name: "Manage Casey's personal board" })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete board' })).toBeNull();
    expect(screen.getByText('Personal boards cannot be deleted.')).toBeTruthy();
  });

  it('shows tasks from all boards and creates a shared board', async () => {
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
  
      expect(await screen.findByRole('heading', { name: 'Board Owner' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Project Board' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Current board: Board Owner' })).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith('/api/tasks?board_id=board-2', { credentials: 'same-origin' });
  
      fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Board' }));
      const dialog = screen.getByRole('dialog', { name: 'Create a new board' });
      fireEvent.change(screen.getByLabelText('Board name'), { target: { value: 'New Shared Board' } });
      fireEvent.click(screen.getByLabelText('Teammate (user-2)'));
      fireEvent.submit(dialog.querySelector('form')!);
  
      expect(await screen.findByRole('heading', { name: 'New Shared Board' })).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith('/api/boards', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'New Shared Board', user_ids: ['user-2'] }),
      }));
    });
  
  it('reorders boards on Home and persists the per-user order', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/boards/order' && options?.method === 'PUT') return { ok: true };
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
      if (url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      if (url === '/api/initiatives') return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByRole('heading', { name: 'Board Owner' });
    const boardTitleOrder = () => screen.getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
      .filter((title) => title === 'Board Owner' || title === 'Project Board');
    expect(boardTitleOrder()).toEqual(['Board Owner', 'Project Board']);
    expect((screen.getByRole('button', { name: 'Move Board Owner up' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Move Project Board up' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/boards/order', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ board_ids: ['board-2', 'board-1'] }),
      }));
      expect(boardTitleOrder()).toEqual(['Project Board', 'Board Owner']);
    });
  });

  it('restores the Home board order and reports save failures', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url === '/api/boards/order' && options?.method === 'PUT') {
        return { ok: false, text: async () => 'Board order save failed' };
      }
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
      if (url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      if (url === '/api/initiatives') return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    await screen.findByRole('heading', { name: 'Board Owner' });
    fireEvent.click(screen.getByRole('button', { name: 'Move Project Board up' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Board order save failed');
    const boardTitleOrder = screen.getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
      .filter((title) => title === 'Board Owner' || title === 'Project Board');
    expect(boardTitleOrder).toEqual(['Board Owner', 'Project Board']);
  });

  it('manages owned and shared boards from the sidebar Boards view', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/members') && options?.method === 'PUT') {
          return { ok: true, json: async () => ({ user_ids: ['teammate'] }) };
        }
        if (url.endsWith('/members')) return { ok: true, json: async () => ({ user_ids: ['teammate'] }) };
        if (url.startsWith('/api/boards/') && options?.method === 'DELETE') return { ok: true };
        if (url === '/api/boards') return { ok: true, json: async () => boardList };
        if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
        if (url === '/api/users') return {
          ok: true,
          json: async () => [
            { id: 'boardowner', full_name: 'Board Owner' },
            { id: 'teammate', full_name: 'Project Teammate' },
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
  
      await screen.findByRole('heading', { name: 'Board Owner' });
      fireEvent.click(screen.getByRole('button', { name: 'Boards' }));
  
      expect(await screen.findByRole('heading', { name: 'Your boards' })).toBeTruthy();
      expect(window.location.pathname).toBe('/boards');
      expect(screen.getByText('Created by you')).toBeTruthy();
      expect(screen.getByText('Shared with you')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Manage Board Owner' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Manage Project Board' })).toBeNull();
  
      fireEvent.click(screen.getByRole('button', { name: 'Manage Board Owner' }));
      expect(await screen.findByRole('dialog', { name: 'Manage Board Owner' })).toBeTruthy();
      const teammateAccess = await screen.findByLabelText('Project Teammate (teammate)') as HTMLInputElement;
      expect(teammateAccess.checked).toBe(true);
      fireEvent.click(teammateAccess);
      expect(teammateAccess.checked).toBe(false);
      fireEvent.click(teammateAccess);
      fireEvent.click(screen.getByRole('button', { name: 'Save access' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage Board Owner' })).toBeNull());
      expect(fetchMock).toHaveBeenCalledWith('/api/boards/board-1/members', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ user_ids: ['teammate'] }),
      }));
  
      fireEvent.click(screen.getByRole('button', { name: 'Manage Board Owner' }));
      await screen.findByRole('dialog', { name: 'Manage Board Owner' });
      fireEvent.click(screen.getByRole('button', { name: 'Delete board' }));
      expect(screen.getByText('This option will delete the board')).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalledWith('/api/boards/board-1', expect.objectContaining({ method: 'DELETE' }));
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Delete board' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(screen.queryByText('Board Owner', { selector: 'h3' })).toBeNull());
      expect(fetchMock).toHaveBeenCalledWith('/api/boards/board-1', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      await waitFor(() => expect(window.localStorage.getItem('snappy-plan-selected-board')).toBe('board-2'));
      expect(fetchMock).toHaveBeenCalledWith('/api/tasks?board_id=board-2', { credentials: 'same-origin' });
  
      fireEvent.click(screen.getByRole('button', { name: 'Open board' }));
      expect(await screen.findByRole('heading', { name: 'Project Board' })).toBeTruthy();
      expect(window.location.pathname).toBe('/');
      fireEvent.click(screen.getByRole('button', { name: 'Boards' }));
      await screen.findByRole('heading', { name: 'Your boards' });
  
      fireEvent.click(screen.getByRole('button', { name: '+ Create new board' }));
      expect(screen.getByRole('dialog', { name: 'Create a new board' })).toBeTruthy();
    });
  
  it('reports board deletion failures and clears selection after deleting the last board', async () => {
      let deleteAttempts = 0;
      const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/members')) return { ok: true, json: async () => ({ user_ids: [] }) };
        if (url.startsWith('/api/boards/') && options?.method === 'DELETE') {
          deleteAttempts += 1;
          return deleteAttempts === 1
            ? { ok: false, text: async () => 'Cannot delete board' }
            : { ok: true };
        }
        if (url === '/api/boards') return {
          ok: true,
          json: async () => [boardList[0]],
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
  
      await screen.findByRole('heading', { name: 'Board Owner' });
      fireEvent.click(screen.getByRole('button', { name: 'Boards' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Manage Board Owner' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Delete board' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Cannot delete board');
      fireEvent.click(await screen.findByRole('button', { name: 'Delete board' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  
      expect(await screen.findByText("You don't have any boards yet. Create one below to get started.")).toBeTruthy();
      expect(window.localStorage.getItem('snappy-plan-selected-board')).toBeNull();
      expect(deleteAttempts).toBe(2);
    });
  
  it('reports board access loading and saving failures', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/members') && options?.method === 'PUT') {
          return { ok: false, text: async () => 'Cannot update board access' };
        }
        if (url.endsWith('/members')) return { ok: false, text: async () => 'Cannot load board access' };
        if (url === '/api/boards') return { ok: true, json: async () => boardList };
        if (url.startsWith('/api/tasks?board_id=')) return { ok: true, json: async () => [] };
        if (url === '/api/users') return { ok: true, json: async () => [{ id: 'teammate', full_name: 'Project Teammate' }] };
        if (url === '/api/profile') return {
          ok: true,
          json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
        };
        return { ok: true, json: async () => ({ authenticated: true }) };
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<App />);
  
      await screen.findByRole('heading', { name: 'Board Owner' });
      fireEvent.click(screen.getByRole('button', { name: 'Boards' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Manage Board Owner' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Cannot load board access');
  
      fireEvent.click(screen.getByRole('button', { name: 'Save access' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Cannot update board access');
    });
});
