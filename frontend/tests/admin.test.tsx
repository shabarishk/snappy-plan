import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';

import { boardList } from './appTestUtils';

describe('Admin', () => {
  it('shows the admin tile to admins and supports creating and promoting users', async () => {
      const fetchMock = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
        if (url.endsWith('/members')) return { ok: true, json: async () => ({ user_ids: [] }) };
        if (url.startsWith('/api/boards/') && options?.method === 'DELETE') return { ok: true };
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
              full_name: 'New User',
              preferred_name: 'Sam',
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
      expect(await screen.findByRole('button', { name: '+ New user' })).toBeTruthy();
      expect(screen.queryByRole('dialog', { name: 'Create user' })).toBeNull();
      expect(screen.getByRole('navigation', { name: 'Admin sections' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'User management' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'All boards' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Board management' }));
      expect(await screen.findByRole('heading', { name: 'All boards' })).toBeTruthy();
      expect(await screen.findByText('Member Board')).toBeTruthy();
      expect(screen.getByText('Owned by Member User (member)')).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/boards', { credentials: 'same-origin' });
      fireEvent.click(screen.getByRole('button', { name: 'Manage Member Board' }));
      expect(await screen.findByRole('dialog', { name: 'Manage Member Board' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Delete board' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Manage Member Board' })).toBeNull());
      expect(fetchMock).toHaveBeenCalledWith('/api/boards/board-2', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      expect(screen.queryByRole('heading', { name: 'Create user' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'User management' }));
      fireEvent.click(screen.getByRole('button', { name: '+ New user' }));
      expect(await screen.findByRole('dialog', { name: 'Create user' })).toBeTruthy();
  
      fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newuser' } });
      fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New User' } });
      fireEvent.change(screen.getByLabelText('Preferred name'), { target: { value: 'Sam' } });
      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@example.com' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
      fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different123' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
      expect((await screen.findByRole('alert')).textContent).toBe('Passwords do not match.');
      expect(fetchMock).not.toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({ method: 'POST' }));

      fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
      expect((await screen.findByRole('status')).textContent).toContain('User newuser created.');
      expect(screen.queryByRole('dialog', { name: 'Create user' })).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ username: 'newuser', full_name: 'New User', preferred_name: 'Sam', email: 'new@example.com', password: 'password123' }),
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
});
