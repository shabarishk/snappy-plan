export type AppPage = 'board' | 'backlog' | 'tasks' | 'task' | 'create-task' | 'create-board' | 'create-initiative' | 'boards' | 'initiatives' | 'initiative' | 'profile' | 'settings' | 'admin';

export function pageFromPath(pathname: string): AppPage {
  if (pathname === '/admin') return 'admin';
  if (pathname === '/create/task') return 'create-task';
  if (pathname === '/create/board') return 'create-board';
  if (pathname === '/create/initiative') return 'create-initiative';
  if (/^\/tasks\/[^/]+$/.test(pathname)) return 'task';
  if (pathname === '/tasks') return 'tasks';
  if (pathname === '/boards') return 'boards';
  if (pathname === '/initiatives') return 'initiatives';
  if (/^\/initiatives\/[^/]+$/.test(pathname)) return 'initiative';
  if (pathname === '/profile') return 'profile';
  if (pathname === '/settings') return 'settings';
  return 'board';
}

export function pathForPage(page: AppPage, resourceId?: string, initiativeTitle?: string): string {
  if (page === 'admin') return '/admin';
  if (page === 'create-task') return '/create/task';
  if (page === 'create-board') return '/create/board';
  if (page === 'create-initiative') return '/create/initiative';
  if (page === 'task' && resourceId) return `/tasks/${encodeURIComponent(resourceId)}`;
  if (page === 'tasks') return '/tasks';
  if (page === 'boards') return '/boards';
  if (page === 'initiatives') return '/initiatives';
  if (page === 'initiative' && resourceId) {
    if (!initiativeTitle) return `/initiatives/${encodeURIComponent(resourceId)}`;
    const slug = initiativeTitle.normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/g, '') || 'initiative';
    return `/initiatives/${encodeURIComponent(slug)}--${encodeURIComponent(resourceId)}`;
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

export function taskIdFromPath(pathname: string): string | null {
  if (pageFromPath(pathname) !== 'task') return null;
  const routeSegment = pathname.slice('/tasks/'.length);
  try {
    return decodeURIComponent(routeSegment);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}