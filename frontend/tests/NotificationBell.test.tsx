import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationBell } from '../src/NotificationBell';

class FakeIntersectionObserver {
  static reveal: (() => void) | undefined;
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: number[] = [];
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe() {
    FakeIntersectionObserver.reveal = () => this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  disconnect() {}
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

describe('NotificationBell', () => {
  it('shows unread notifications and marks an item read when it becomes visible', async () => {
    const notification = {
      id: 'notification-1',
      message: 'A new task was created for you.',
      created_at: '2026-10-18T10:00:00Z',
      read_at: null,
    };
    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input) === '/api/notifications') {
        return { ok: true, json: async () => [notification] };
      }
      return { ok: true };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

    render(<NotificationBell />);
    expect(await screen.findByLabelText('Unread notifications')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText(notification.message)).toBeTruthy();
    await waitFor(() => expect(FakeIntersectionObserver.reveal).toBeTypeOf('function'));
    FakeIntersectionObserver.reveal?.();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/notifications/notification-1/read', expect.objectContaining({
        method: 'PATCH',
      }));
      expect(screen.queryByLabelText('Unread notifications')).toBeNull();
    });
  });
});
