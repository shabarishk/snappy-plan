import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';

import { mockBoardReads, taskResponse } from './appTestUtils';

describe('Application', () => {
  it('requires auth before rendering the board', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ launch_required: false }) })
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
      for (const title of ['To Do', 'In Progress', 'Complete']) {
        for (const heading of screen.getAllByRole('heading', { name: title })) {
          expect(heading.className).toContain('text-sm');
          expect(heading.className).not.toMatch(/font-(bold|semibold|medium)/);
        }
      }
      expect(screen.queryByRole('heading', { name: 'Backlog' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Snappy-Plan' })).toBeNull();
      expect((screen.getByLabelText('Group tasks by') as HTMLSelectElement).value).toBe('board');
      expect(screen.getAllByText('0 tasks')).toHaveLength(8);
      expect(screen.queryByText('Setup Unraid Docker')).toBeNull();
      expect(screen.queryByText('Configure iOS PWA settings')).toBeNull();
      expect(screen.queryByText('Build React UI')).toBeNull();
      const activeTab = screen.getByRole('button', { name: 'Active' });
      expect(activeTab.querySelector('span[aria-hidden="true"]')).toBeTruthy();
  
      const backlogTab = screen.getByRole('button', { name: 'Backlog' });
      fireEvent.click(backlogTab);
      expect(backlogTab.querySelector('span[aria-hidden="true"]')).toBeTruthy();
      expect(activeTab.querySelector('span[aria-hidden="true"]')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Backlog' })).toBeNull();
      expect(screen.getAllByText('0 tasks')).toHaveLength(4);
  
      fireEvent.click(activeTab);
      expect(activeTab.querySelector('span[aria-hidden="true"]')).toBeTruthy();
      expect(screen.getAllByRole('heading', { name: 'To Do' })).toHaveLength(2);
      expect(screen.getAllByText('0 tasks')).toHaveLength(8);
    });

  it('uses mobile navigation, filters, and ungrouped active sections on portrait screens', async () => {
    const mobileMediaQuery = {
      matches: true,
      media: '(max-width: 767px), (orientation: portrait) and (max-width: 1024px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const boardReads = mockBoardReads();
    vi.stubGlobal('matchMedia', vi.fn(() => mobileMediaQuery));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/tasks?board_id=board-1') {
        return { ok: true, json: async () => [taskResponse({ id: 'todo-task', title: 'Plan review', state: 'ToDo' })] };
      }
      if (url === '/api/tasks?board_id=board-2') {
        return { ok: true, json: async () => [taskResponse({ id: 'progress-task', title: 'Review launch', state: 'InProgress' })] };
      }
      return boardReads(url);
    }));
    render(<App />);

    const mobileSections = await screen.findByRole('region', { name: 'Mobile active task sections' });
    const brandRow = screen.getByRole('heading', { name: 'Snappy-Plan' });
    const searchBar = screen.getByRole('searchbox', { name: 'Search tasks' });
    expect(brandRow.className).toContain('mobile-brand-row');
    expect(brandRow.compareDocumentPosition(searchBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(mobileSections).getByRole('heading', { name: 'To Do' })).toBeTruthy();
    expect(within(mobileSections).getByRole('heading', { name: 'In Progress' })).toBeTruthy();
    expect(within(mobileSections).getByRole('heading', { name: 'Complete' })).toBeTruthy();
    expect(within(mobileSections).getByText('Plan review')).toBeTruthy();
    expect(within(mobileSections).getByText('Review launch')).toBeTruthy();
    expect(screen.queryByLabelText('Group tasks by')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Project Board' })).toBeNull();
    const mobileFilterButton = screen.getByRole('button', { name: 'Open filters' });
    expect(mobileFilterButton.parentElement?.className).toContain('home-tabs-row');
    expect(mobileFilterButton.textContent).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByLabelText('Sidebar').getAttribute('aria-hidden')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation menu' }));
    expect(screen.getByLabelText('Sidebar').getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Open filters' }));
    expect(screen.getByRole('dialog', { name: 'Task filters' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Task filters' }).className).toContain('mobile-filter-panel-open');
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.getByLabelText('Board: All')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Board: Board Owner'));
    expect(within(mobileSections).queryByText('Plan review')).toBeNull();
    expect(within(mobileSections).getByText('Review launch')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.queryByLabelText('Board: All')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Initiative' }));
    expect(screen.getByLabelText('Initiative: All')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Assignee' }));
    expect(screen.getByLabelText('Assignee: All')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close task filters' }));
    expect(screen.queryByRole('dialog', { name: 'Task filters' })).toBeNull();
    expect(document.querySelector('.mobile-filter-panel')?.classList.contains('mobile-filter-panel-open')).toBe(false);
  });

  it('pulls to refresh portrait pages after a downward gesture at the top', async () => {
    const mobileMediaQuery = {
      matches: true,
      media: '(max-width: 767px), (orientation: portrait) and (max-width: 1024px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    window.history.replaceState({}, '', '/settings');
    vi.stubGlobal('matchMedia', vi.fn(() => mobileMediaQuery));
    vi.stubGlobal('fetch', mockBoardReads());
    render(<App />);

    await screen.findByRole('heading', { name: 'Settings', level: 1 });
    const main = document.querySelector('main');
    expect(main).not.toBeNull();

    fireEvent.touchStart(main!, { touches: [{ identifier: 1, clientX: 20, clientY: 0 }] });
    fireEvent.touchMove(main!, { touches: [{ identifier: 1, clientX: 20, clientY: 100 }] });
    expect(screen.getByRole('status').textContent).toBe('Release to refresh');
    fireEvent.touchEnd(main!, { touches: [], changedTouches: [{ identifier: 1, clientX: 20, clientY: 100 }] });

    expect(screen.getByRole('status').textContent).toBe('Refreshing…');
  });

  it('does not pull to refresh from an open overlay', async () => {
    const mobileMediaQuery = {
      matches: true,
      media: '(max-width: 767px), (orientation: portrait) and (max-width: 1024px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => mobileMediaQuery));
    vi.stubGlobal('fetch', mockBoardReads());
    render(<App />);

    await screen.findByRole('region', { name: 'Mobile active task sections' });
    fireEvent.click(screen.getByRole('button', { name: 'Open filters' }));
    const filters = screen.getByRole('dialog', { name: 'Task filters' });

    fireEvent.touchStart(filters, { touches: [{ identifier: 1, clientX: 20, clientY: 0 }] });
    fireEvent.touchMove(filters, { touches: [{ identifier: 1, clientX: 20, clientY: 100 }] });
    fireEvent.touchEnd(filters, { touches: [], changedTouches: [{ identifier: 1, clientX: 20, clientY: 100 }] });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps a portrait create button fixed and opens a dedicated page for each create option', async () => {
    const mobileMediaQuery = {
      matches: true,
      media: '(max-width: 767px), (orientation: portrait) and (max-width: 1024px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    window.history.replaceState({}, '', '/');
    vi.stubGlobal('matchMedia', vi.fn(() => mobileMediaQuery));
    vi.stubGlobal('fetch', mockBoardReads());
    render(<App />);

    await screen.findByRole('region', { name: 'Mobile active task sections' });
    const createButton = screen.getByRole('button', { name: '+ Create' });
    expect(createButton.parentElement?.className).toContain('mobile-create-menu');

    fireEvent.click(createButton);
    expect(screen.getByRole('button', { name: 'Close create menu' }).className).toContain('backdrop-blur-sm');
    expect(screen.getByRole('menu', { name: 'Create' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Task' }));
    expect(window.location.pathname).toBe('/create/task');
    expect(await screen.findByRole('region', { name: 'Create task' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Create task' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back from create task form' }));
    expect(window.location.pathname).toBe('/');
    fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Board' }));
    expect(window.location.pathname).toBe('/create/board');
    expect(await screen.findByRole('region', { name: 'Create a new board' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back from create board form' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Create' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Initiative' }));
    expect(window.location.pathname).toBe('/create/initiative');
    expect(await screen.findByRole('region', { name: 'Create initiative' })).toBeTruthy();
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
