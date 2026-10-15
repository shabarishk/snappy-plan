import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';

import { mockBoardReads } from './appTestUtils';

describe('Application', () => {
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
  
      await screen.findByRole('heading', { name: 'Board Owner' });
      expect(screen.queryByRole('button', { name: 'Current board: Board Owner' })).toBeNull();
      expect(screen.getAllByRole('heading', { name: 'To Do' })).toHaveLength(2);
      expect(screen.getAllByRole('heading', { name: 'In Progress' })).toHaveLength(2);
      expect(screen.getAllByRole('heading', { name: 'Complete' })).toHaveLength(2);
      expect(screen.queryByRole('heading', { name: 'Backlog' })).toBeNull();
      expect((screen.getByLabelText('Group tasks by') as HTMLSelectElement).value).toBe('board');
      expect(screen.getAllByText('0 tasks')).toHaveLength(8);
      expect(screen.queryByText('Setup Unraid Docker')).toBeNull();
      expect(screen.queryByText('Configure iOS PWA settings')).toBeNull();
      expect(screen.queryByText('Build React UI')).toBeNull();
  
      fireEvent.click(screen.getByRole('button', { name: 'Backlog' }));
      expect(screen.getAllByRole('heading', { name: 'Backlog' })).toHaveLength(2);
      expect(screen.getAllByText('0 tasks')).toHaveLength(4);
  
      fireEvent.click(screen.getByRole('button', { name: 'Kanban board' }));
      expect(screen.getAllByRole('heading', { name: 'To Do' })).toHaveLength(2);
      expect(screen.getAllByText('0 tasks')).toHaveLength(8);
    });
  
  it('opens the page selected by the current URL and follows browser history', async () => {
      window.history.replaceState({}, '', '/settings');
      vi.stubGlobal('fetch', mockBoardReads());
      render(<App />);
  
      expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
      expect(screen.getByLabelText('Current password')).toBeTruthy();
  
      fireEvent.click(screen.getByRole('button', { name: 'Home' }));
      expect(window.location.pathname).toBe('/');
      expect(await screen.findAllByRole('heading', { name: 'To Do' })).toHaveLength(2);
  
      window.history.back();
      await waitFor(() => expect(window.location.pathname).toBe('/settings'));
      expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    });
});
