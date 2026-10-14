export type AppPage = 'board' | 'backlog' | 'boards' | 'profile' | 'settings' | 'admin';

export function pageFromPath(pathname: string): AppPage {
  if (pathname === '/admin') return 'admin';
  if (pathname === '/boards') return 'boards';
  if (pathname === '/profile') return 'profile';
  if (pathname === '/settings') return 'settings';
  return 'board';
}

export function pathForPage(page: AppPage): string {
  if (page === 'admin') return '/admin';
  if (page === 'boards') return '/boards';
  if (page === 'profile') return '/profile';
  if (page === 'settings') return '/settings';
  return '/';
}