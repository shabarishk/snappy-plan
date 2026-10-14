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
});
