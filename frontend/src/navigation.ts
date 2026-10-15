export type AppPage = 'board' | 'backlog' | 'boards' | 'initiatives' | 'initiative' | 'profile' | 'settings' | 'admin';

export function pageFromPath(pathname: string): AppPage {
  if (pathname === '/admin') return 'admin';
  if (pathname === '/boards') return 'boards';
  if (pathname === '/initiatives') return 'initiatives';
  if (/^\/initiatives\/[^/]+$/.test(pathname)) return 'initiative';
  if (pathname === '/profile') return 'profile';
  if (pathname === '/settings') return 'settings';
  return 'board';
}

export function pathForPage(page: AppPage, initiativeId?: string): string {
  if (page === 'admin') return '/admin';
  if (page === 'boards') return '/boards';
  if (page === 'initiatives') return '/initiatives';
  if (page === 'initiative' && initiativeId) return `/initiatives/${encodeURIComponent(initiativeId)}`;
  if (page === 'profile') return '/profile';
  if (page === 'settings') return '/settings';
  return '/';
}

export function initiativeIdFromPath(pathname: string): string | null {
  if (pageFromPath(pathname) !== 'initiative') return null;
  return decodeURIComponent(pathname.slice('/initiatives/'.length));
}