import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';

import { boardList, mockBoardReads } from './appTestUtils';

describe('Account', () => {
  it('closes the user menu when clicking outside it', async () => {
    const fetchMock = mockBoardReads();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/boards') return { ok: true, json: async () => boardList };
      if (url.startsWith('/api/tasks?board_id=') || url === '/api/users') return { ok: true, json: async () => [] };
      if (url === '/api/profile') return {
        ok: true,
        json: async () => ({ username: 'boardowner', full_name: 'Board Owner', email: 'owner@example.com' }),
      };
      return { ok: true, json: async () => ({ authenticated: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'User menu for boardowner' }));
    expect(screen.getByRole('menu', { name: 'User menu' })).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('menu', { name: 'User menu' })).toBeNull();
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
  
      await screen.findByRole('heading', { name: 'Board Owner' });
      const userMenuButton = await screen.findByRole('button', { name: 'User menu for boardowner' });
      expect(userMenuButton.textContent).toBe('B');
      fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
      expect(screen.queryByRole('heading', { name: 'Backlog' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Home' }));
      expect(screen.getAllByRole('heading', { name: 'To Do' })).toHaveLength(2);
  
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
      expect(screen.getAllByRole('heading', { name: 'To Do' })).toHaveLength(2);
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
});
