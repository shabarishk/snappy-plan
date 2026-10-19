import { useCallback, useEffect, useRef, useState } from 'react';
import { getNotifications, markNotificationRead } from './api';
import type { UserNotification } from './api';

function NotificationItem({
  notification,
  root,
  onRead,
}: {
  notification: UserNotification;
  root: HTMLDivElement | null;
  onRead: (id: string) => void;
}) {
  const itemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (notification.read_at || !root || !itemRef.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onRead(notification.id);
    }, { root, threshold: 0.35 });
    observer.observe(itemRef.current);
    return () => observer.disconnect();
  }, [notification.id, notification.read_at, onRead, root]);

  return (
    <li
      ref={itemRef}
      className={`border-b border-gray-100 px-4 py-3 last:border-b-0 ${notification.read_at ? 'bg-white' : 'bg-blue-50'}`}
    >
      <p className="text-sm text-gray-800">{notification.message}</p>
      <time className="mt-1 block text-xs text-gray-500" dateTime={notification.created_at}>
        {new Date(notification.created_at).toLocaleString()}
      </time>
    </li>
  );
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState('');
  const [listRoot, setListRoot] = useState<HTMLDivElement | null>(null);
  const markingRef = useRef(new Set<string>());

  const refreshNotifications = useCallback(async () => {
    try {
      setNotifications(await getNotifications());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications');
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refreshNotifications(), 0);
    const interval = window.setInterval(() => void refreshNotifications(), 30_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [refreshNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    if (markingRef.current.has(id)) return;
    markingRef.current.add(id);
    try {
      await markNotificationRead(id);
      setNotifications((current) => current.map((notification) => notification.id === id
        ? { ...notification, read_at: new Date().toISOString() }
        : notification));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark notification as read');
    } finally {
      markingRef.current.delete(id);
    }
  }, []);

  const unreadCount = notifications.reduce((count, notification) => count + Number(!notification.read_at), 0);

  return (
    <div className="notification-bell relative justify-self-end sm:col-start-3 sm:row-start-1">
      <button
        type="button"
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4" />
        </svg>
        {unreadCount > 0 && (
          <span aria-label="Unread notifications" className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-600" />
        )}
      </button>
      {isOpen && (
        <section
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-5rem))] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <h2 className="text-base font-semibold text-gray-900">Notifications</h2>
            <span className="text-xs text-gray-500">{unreadCount} unread</span>
          </div>
          {error && <p role="alert" className="px-4 py-3 text-sm text-red-700">{error}</p>}
          <div ref={setListRoot} className="max-h-96 overflow-y-auto">
            {notifications.length === 0
              ? <p className="px-4 py-6 text-center text-sm text-gray-500">You’re all caught up.</p>
              : (
                <ul aria-label="Notification list">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      root={listRoot}
                      onRead={(id) => void markAsRead(id)}
                    />
                  ))}
                </ul>
              )}
          </div>
        </section>
      )}
    </div>
  );
}
