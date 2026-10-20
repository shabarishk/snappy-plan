import type { RefObject } from 'react';
import type { UserProfile } from './api';
import type { AppPage } from './navigation';
import { useDelayedUnmount } from './useDelayedUnmount';

type AuthenticatedSidebarProps = {
  currentPage: AppPage;
  isMobileLayout: boolean;
  isMobileSidebarOpen: boolean;
  profile: UserProfile | null;
  profileDisplayName: string;
  profileInitial: string;
  isProfileMenuOpen: boolean;
  profileMenuRef: RefObject<HTMLDivElement | null>;
  logoutError: string;
  isLoggingOut: boolean;
  onCloseMobileSidebar: () => void;
  onToggleProfileMenu: () => void;
  onNavigateHome: () => void;
  onNavigateFromMenu: (page: AppPage) => void;
  onLogout: () => void;
};

export function AuthenticatedSidebar({
  currentPage,
  isMobileLayout,
  isMobileSidebarOpen,
  profile,
  profileDisplayName,
  profileInitial,
  isProfileMenuOpen,
  profileMenuRef,
  logoutError,
  isLoggingOut,
  onCloseMobileSidebar,
  onToggleProfileMenu,
  onNavigateHome,
  onNavigateFromMenu,
  onLogout,
}: AuthenticatedSidebarProps) {
  const shouldRenderProfileMenu = useDelayedUnmount(isProfileMenuOpen);

  return (
    <>
      {isMobileLayout && isMobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="mobile-sidebar-backdrop"
          onClick={onCloseMobileSidebar}
        />
      )}
      <aside
        aria-label="Sidebar"
        aria-hidden={isMobileLayout && !isMobileSidebarOpen}
        className={`app-sidebar relative z-20 flex w-16 shrink-0 flex-col items-center border-r border-gray-200 bg-white py-4 ${isMobileSidebarOpen ? 'app-sidebar-open' : ''}`}
      >
        <button
          type="button"
          aria-label="Home"
          title="Home"
          aria-current={currentPage === 'board' || currentPage === 'backlog' ? 'page' : undefined}
          onClick={onNavigateHome}
          className={`sidebar-navigation-item flex h-11 w-11 items-center justify-center rounded-xl ${currentPage === 'board' || currentPage === 'backlog' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" />
          </svg>
          <span className="sidebar-label">Home</span>
        </button>
        <button
          type="button"
          aria-label="Tasks"
          title="Tasks"
          aria-current={currentPage === 'tasks' ? 'page' : undefined}
          onClick={() => onNavigateFromMenu('tasks')}
          className={`sidebar-navigation-item mt-2 flex h-11 w-11 items-center justify-center rounded-xl ${currentPage === 'tasks' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path strokeLinecap="round" strokeLinejoin="round" d="m8 12 3 3 5-6" />
          </svg>
          <span className="sidebar-label">Tasks</span>
        </button>
        <button
          type="button"
          aria-label="Initiatives"
          title="Initiatives"
          aria-current={currentPage === 'initiatives' || currentPage === 'initiative' ? 'page' : undefined}
          onClick={() => onNavigateFromMenu('initiatives')}
          className={`sidebar-navigation-item mt-2 flex h-11 w-11 items-center justify-center rounded-xl ${currentPage === 'initiatives' || currentPage === 'initiative' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 2 4 14h7l-1 8 10-12h-7l1-8Z" />
          </svg>
          <span className="sidebar-label">Initiatives</span>
        </button>
        <button
          type="button"
          aria-label="Boards"
          title="Boards"
          aria-current={currentPage === 'boards' ? 'page' : undefined}
          onClick={() => onNavigateFromMenu('boards')}
          className={`sidebar-navigation-item mt-2 flex h-11 w-11 items-center justify-center rounded-xl ${currentPage === 'boards' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v16m6-16v16" />
          </svg>
          <span className="sidebar-label">Boards</span>
        </button>
        <div ref={profileMenuRef} className="mt-auto flex flex-col items-center gap-2">
          {profile?.role === 'admin' && (
            <button
              type="button"
              aria-label="Admin"
              title="Admin"
              aria-current={currentPage === 'admin' ? 'page' : undefined}
              onClick={() => onNavigateFromMenu('admin')}
              className={`sidebar-navigation-item flex h-11 w-11 items-center justify-center rounded-xl ${currentPage === 'admin' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4.5 6v5.5c0 4.8 3.2 7.8 7.5 9.5 4.3-1.7 7.5-4.7 7.5-9.5V6L12 3Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
              </svg>
              <span className="sidebar-label">Admin</span>
            </button>
          )}
          <button
            type="button"
            aria-label={`User menu for ${profile?.username ?? 'user'}`}
            aria-haspopup="menu"
            aria-expanded={isProfileMenuOpen}
            title={profileDisplayName || 'User profile'}
            onClick={onToggleProfileMenu}
            className="sidebar-user-button flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-bold text-blue-700 hover:bg-blue-200"
          >
            {profile?.profile_picture
              ? <img src={profile.profile_picture} alt="" className="h-full w-full object-cover" />
              : profileInitial}
            {isMobileLayout && <span className="sidebar-label">{profileDisplayName || profile?.username || 'Account'}</span>}
          </button>
          {shouldRenderProfileMenu && (
            <div
              role={isProfileMenuOpen ? 'menu' : undefined}
              aria-hidden={!isProfileMenuOpen}
              inert={!isProfileMenuOpen}
              aria-label="User menu"
              className={`sidebar-user-menu absolute bottom-4 left-full ml-2 w-40 rounded-lg border border-gray-200 bg-white p-1 shadow-lg ${isProfileMenuOpen ? 'popup-menu-enter' : 'popup-menu-exit'}`}
            >
              {logoutError && <p role="alert" className="px-3 py-2 text-xs text-red-700">{logoutError}</p>}
              <button type="button" role="menuitem" onClick={() => onNavigateFromMenu('profile')} className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">Profile</button>
              <button type="button" role="menuitem" onClick={() => onNavigateFromMenu('settings')} className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">Settings</button>
              <button type="button" role="menuitem" disabled={isLoggingOut} onClick={onLogout} className="w-full rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                {isLoggingOut ? 'Logging out…' : 'Log out'}
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
