export type AppPage = 'board' | 'backlog' | 'tasks' | 'boards' | 'initiatives' | 'initiative' | 'profile' | 'settings' | 'admin';

export function pageFromPath(pathname: string): AppPage {
  if (pathname === '/admin') return 'admin';
  if (pathname === '/tasks') return 'tasks';
  if (pathname === '/boards') return 'boards';
  if (pathname === '/initiatives') return 'initiatives';
  if (/^\/initiatives\/[^/]+$/.test(pathname)) return 'initiative';
  if (pathname === '/profile') return 'profile';
  if (pathname === '/settings') return 'settings';
  return 'board';
}

export function pathForPage(page: AppPage, initiativeId?: string, initiativeTitle?: string): string {
  if (page === 'admin') return '/admin';
  if (page === 'tasks') return '/tasks';
  if (page === 'boards') return '/boards';
  if (page === 'initiatives') return '/initiatives';
  if (page === 'initiative' && initiativeId) {
    if (!initiativeTitle) return `/initiatives/${encodeURIComponent(initiativeId)}`;
    const slug = initiativeTitle.normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/g, '') || 'initiative';
    return `/initiatives/${encodeURIComponent(slug)}--${encodeURIComponent(initiativeId)}`;
  }
  if (page === 'profile') return '/profile';
  if (page === 'settings') return '/settings';
  return '/';
}

export function initiativeIdFromPath(pathname: string): string | null {
  if (pageFromPath(pathname) !== 'initiative') return null;
  const routeSegment = pathname.slice('/initiatives/'.length);
  const separator = routeSegment.lastIndexOf('--');
  return decodeURIComponent(separator < 0 ? routeSegment : routeSegment.slice(separator + 2));
}