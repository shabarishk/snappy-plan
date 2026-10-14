import { useEffect, useRef, useState } from 'react';
import { DndContext, DragOverlay, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { deleteBoard as persistDeleteBoard, getBoards, getProfile, getTaskAssignees, getTasks, logout, moveTask as persistMoveTask } from './api';
import type { Board, TaskAssignee, UserProfile } from './api';
import type { ColumnId, Task } from './taskModel';
import type { AppPage } from './navigation';
import { pageFromPath, pathForPage } from './navigation';
import { BOARD_COLUMNS, COLUMNS, COLUMN_STATES, moveTaskToColumn, toBoardTask } from './taskModel';
import { CreateTaskOverlay, TaskDetailsOverlay } from './TaskOverlays';
import { BoardsPage, CreateBoardOverlay } from './BoardComponents';
import { AdminPage } from './AdminPage';
import { SettingsPage } from './SettingsPage';
import { ProfilePage } from './ProfilePage';
import { Column } from './TaskBoard';

export function AuthenticatedBoard({
  tasks,
  setTasks,
  onLoggedOut,
}: {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  onLoggedOut?: () => void;
}) {
  const [currentPage, setCurrentPage] = useState<AppPage>(() => pageFromPath(window.location.pathname));
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const boardMenuRef = useRef<HTMLDivElement>(null);
  const [logoutError, setLogoutError] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [isCreateBoardOpen, setIsCreateBoardOpen] = useState(false);
  const [isBoardMenuOpen, setIsBoardMenuOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [moveError, setMoveError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const navigateToPage = (page: AppPage) => {
    const path = pathForPage(page);
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentPage(page);
  };

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(pageFromPath(window.location.pathname));
      setIsProfileMenuOpen(false);
      setIsCreateTaskOpen(false);
      setSelectedTaskId(null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!isProfileMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !profileMenuRef.current?.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (!isBoardMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !boardMenuRef.current?.contains(event.target)) {
        setIsBoardMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isBoardMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getTaskAssignees(), getProfile(), getBoards()])
      .then(([availableAssignees, currentProfile, availableBoards]) => {
        if (cancelled) return;
        setAssignees(availableAssignees);
        setProfile(currentProfile);
        setBoards(availableBoards);
        const savedBoardId = window.localStorage.getItem('snappy-plan-selected-board');
        const nextBoard = availableBoards.find((board) => board.id === savedBoardId) ?? availableBoards[0];
        if (nextBoard) setSelectedBoardId(nextBoard.id);
        else {
          setTasks([]);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load board data');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [setTasks]);

  useEffect(() => {
    if (!selectedBoardId) return;
    let cancelled = false;
    getTasks(selectedBoardId)
      .then((savedTasks) => {
        if (!cancelled) setTasks(savedTasks.map(toBoardTask));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load board tasks');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedBoardId, setTasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const onDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === 'Task') {
      setActiveTask(event.active.data.current.task);
    }
  };

  const persistTaskMove = async (task: Task, destination: ColumnId) => {
    if (task.columnId === destination) return;
    setMoveError('');
    try {
      await persistMoveTask(task.id, COLUMN_STATES[destination]);
    } catch (err) {
      setTasks((previous) => previous.map((current) =>
        current.id === task.id && current.columnId === destination
          ? task
          : current
      ));
      setMoveError(err instanceof Error ? err.message : 'Failed to move task');
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const task = tasks.find((current) => current.id === event.active.id);
    const destinationColumn = event.over?.data.current?.type === 'Column'
      ? COLUMNS.find((column) => column.id === event.over?.id.toString())
      : undefined;

    if (task && destinationColumn && task.columnId !== destinationColumn.id) {
      const movedTask = moveTaskToColumn(task, destinationColumn.id);
      setTasks((previous) => previous.map((current) =>
        current.id === task.id ? movedTask : current
      ));
      void persistTaskMove(task, destinationColumn.id);
    }
    setActiveTask(null);
  };

  const moveBacklogTaskToTodo = (taskId: string) => {
    const task = tasks.find((current) => current.id === taskId);
    if (!task) return;
    setTasks((previous) => previous.map((current) =>
      current.id === taskId ? moveTaskToColumn(current, 'todo') : current
    ));
    void persistTaskMove(task, 'todo');
  };

  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const selectedBoard = boards.find((board) => board.id === selectedBoardId);
  const profileInitial = profile?.full_name.trim().charAt(0).toUpperCase()
    || profile?.username.charAt(0).toUpperCase()
    || '?';

  const handleLogout = async () => {
    setLogoutError('');
    setIsLoggingOut(true);
    try {
      await logout();
      window.history.replaceState({}, '', '/');
      onLoggedOut?.();
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : 'Failed to log out');
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="flex h-screen min-h-0 bg-gray-200 font-sans">
      <aside aria-label="Sidebar" className="relative z-20 flex w-16 shrink-0 flex-col items-center border-r border-gray-200 bg-white py-4">
        <button
          type="button"
          aria-label="Home"
          title="Home"
          aria-current={currentPage === 'board' || currentPage === 'backlog' ? 'page' : undefined}
          onClick={() => navigateToPage('board')}
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${currentPage === 'board' || currentPage === 'backlog' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Boards"
          title="Boards"
          aria-current={currentPage === 'boards' ? 'page' : undefined}
          onClick={() => {
            setIsProfileMenuOpen(false);
            setIsCreateTaskOpen(false);
            setSelectedTaskId(null);
            navigateToPage('boards');
          }}
          className={`mt-2 flex h-11 w-11 items-center justify-center rounded-xl ${currentPage === 'boards' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v16m6-16v16" />
          </svg>
        </button>
        <div ref={profileMenuRef} className="mt-auto flex flex-col items-center gap-2">
          {profile?.role === 'admin' && (
            <button
              type="button"
              aria-label="Admin"
              title="Admin"
              aria-current={currentPage === 'admin' ? 'page' : undefined}
              onClick={() => {
                setIsProfileMenuOpen(false);
                setIsCreateTaskOpen(false);
                setSelectedTaskId(null);
                navigateToPage('admin');
              }}
              className={`flex h-11 w-11 items-center justify-center rounded-xl ${currentPage === 'admin' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4.5 6v5.5c0 4.8 3.2 7.8 7.5 9.5 4.3-1.7 7.5-4.7 7.5-9.5V6L12 3Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
              </svg>
            </button>
          )}
          <button
            type="button"
            aria-label={`User menu for ${profile?.username ?? 'user'}`}
            aria-haspopup="menu"
            aria-expanded={isProfileMenuOpen}
            title={profile?.full_name ?? 'User profile'}
            onClick={() => setIsProfileMenuOpen((isOpen) => !isOpen)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700 hover:bg-blue-200"
          >
            {profileInitial}
          </button>
          {isProfileMenuOpen && (
            <div role="menu" aria-label="User menu" className="absolute bottom-4 left-full ml-2 w-40 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
              {logoutError && <p role="alert" className="px-3 py-2 text-xs text-red-700">{logoutError}</p>}
              <button type="button" role="menuitem" onClick={() => {
                setIsProfileMenuOpen(false);
                setIsCreateTaskOpen(false);
                setSelectedTaskId(null);
                navigateToPage('profile');
              }} className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">Profile</button>
              <button type="button" role="menuitem" onClick={() => {
                setIsProfileMenuOpen(false);
                setIsCreateTaskOpen(false);
                setSelectedTaskId(null);
                navigateToPage('settings');
              }} className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">Settings</button>
              <button type="button" role="menuitem" disabled={isLoggingOut} onClick={() => void handleLogout()} className="w-full rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                {isLoggingOut ? 'Logging out…' : 'Log out'}
              </button>
            </div>
          )}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
      <header className="bg-white p-4 shadow-sm z-10 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          {(currentPage === 'board' || currentPage === 'backlog') ? (
            <div ref={boardMenuRef} className="relative">
              <button
                type="button"
                aria-label={`Current board: ${selectedBoard?.title ?? 'No boards'}`}
                aria-haspopup="menu"
                aria-expanded={isBoardMenuOpen}
                disabled={isLoading && !selectedBoard}
                onClick={() => setIsBoardMenuOpen((open) => !open)}
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-xl font-extrabold tracking-tight text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              >
                {selectedBoard?.title ?? (isLoading ? 'Loading boards…' : 'No boards')}
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
              </button>
              {isBoardMenuOpen && (
                <div role="menu" aria-label="Switch board" className="absolute left-0 top-full z-30 mt-2 min-w-56 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                  {boards.map((board) => (
                    <button key={board.id} type="button" role="menuitem" onClick={() => {
                      setSelectedBoardId(board.id);
                      window.localStorage.setItem('snappy-plan-selected-board', board.id);
                      setTasks([]);
                      setIsLoading(true);
                      setIsBoardMenuOpen(false);
                    }} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${board.id === selectedBoardId ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}>
                      {board.title}
                    </button>
                  ))}
                  <div className="my-1 border-t border-gray-100" />
                  <button type="button" role="menuitem" onClick={() => {
                    setIsBoardMenuOpen(false);
                    setIsCreateBoardOpen(true);
                  }} className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50">
                    + Create new board
                  </button>
                </div>
              )}
            </div>
          ) : (
            <h1 className="text-xl font-extrabold tracking-tight text-blue-600">
              {currentPage === 'admin' ? 'Admin' : currentPage === 'settings' ? 'Settings' : currentPage === 'boards' ? 'Boards' : 'Profile'}
            </h1>
          )}
          {(currentPage === 'board' || currentPage === 'backlog') && (
            <button type="button" disabled={isLoading || Boolean(loadError)} onClick={() => setIsCreateTaskOpen(true)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              Create task
            </button>
          )}
        </div>
        {(currentPage === 'board' || currentPage === 'backlog') && <nav aria-label="Main navigation" className="flex items-center gap-2">
          <button
            type="button"
            aria-current={currentPage === 'board' ? 'page' : undefined}
            onClick={() => navigateToPage('board')}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${currentPage === 'board' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Kanban board
          </button>
          <button
            type="button"
            aria-current={currentPage === 'backlog' ? 'page' : undefined}
            onClick={() => navigateToPage('backlog')}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${currentPage === 'backlog' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Backlog
          </button>
        </nav>}
      </header>
      {(currentPage === 'board' || currentPage === 'backlog') && isCreateTaskOpen && (
        <CreateTaskOverlay
          boards={boards}
          selectedBoardId={selectedBoardId}
          assignees={assignees}
          onClose={() => setIsCreateTaskOpen(false)}
          onCreated={(task, boardId) => {
            setSelectedBoardId(boardId);
            window.localStorage.setItem('snappy-plan-selected-board', boardId);
            setIsLoading(true);
            setTasks((previous) => [...previous, task]);
            navigateToPage(task.columnId === 'backlog' ? 'backlog' : 'board');
            setIsCreateTaskOpen(false);
          }}
        />
      )}
      {(currentPage === 'board' || currentPage === 'backlog' || currentPage === 'boards') && isCreateBoardOpen && (
        <CreateBoardOverlay
          users={assignees}
          onClose={() => setIsCreateBoardOpen(false)}
          onCreated={(board) => {
            setBoards((current) => [...current, board]);
            setSelectedBoardId(board.id);
            window.localStorage.setItem('snappy-plan-selected-board', board.id);
            setIsLoading(true);
            setTasks([]);
            setIsCreateBoardOpen(false);
          }}
        />
      )}
      {(currentPage === 'board' || currentPage === 'backlog') && selectedTask && (
        <TaskDetailsOverlay
          key={selectedTask.id}
          task={selectedTask}
          onClose={() => setSelectedTaskId(null)}
          onSaved={(updatedTask) => {
            setTasks((previous) => previous.map((task) =>
              task.id === updatedTask.id ? updatedTask : task
            ));
            setSelectedTaskId(null);
          }}
        />
      )}

      {/* Main content area takes up remaining height */}
      <main className="board-main flex-1 p-4">
        {currentPage === 'admin' ? (
          profile?.role === 'admin'
            ? <AdminPage currentUsername={profile.username} />
            : <p role="alert" className="p-4 text-sm text-red-700">Administrator access required.</p>
        ) : currentPage === 'settings' ? (
          <SettingsPage />
        ) : currentPage === 'profile' ? (
          profile
            ? <ProfilePage profile={profile} onSaved={setProfile} />
            : <p role={loadError ? 'alert' : undefined} className="p-4 text-sm text-gray-600">{loadError || 'Loading profile…'}</p>
        ) : currentPage === 'boards' ? (
          profile
            ? <BoardsPage
              boards={boards}
              users={assignees}
              username={profile.username}
              onOpenBoard={(board) => {
                setSelectedBoardId(board.id);
                window.localStorage.setItem('snappy-plan-selected-board', board.id);
                setTasks([]);
                setIsLoading(true);
                setIsBoardMenuOpen(false);
                navigateToPage('board');
              }}
              onCreateBoard={() => setIsCreateBoardOpen(true)}
              onDeleteBoard={async (board) => {
                await persistDeleteBoard(board.id);
                const remainingBoards = boards.filter((current) => current.id !== board.id);
                setBoards(remainingBoards);
                if (selectedBoardId === board.id) {
                  const nextBoard = remainingBoards[0];
                  if (nextBoard) {
                    setSelectedBoardId(nextBoard.id);
                    window.localStorage.setItem('snappy-plan-selected-board', nextBoard.id);
                    setIsLoading(true);
                  } else {
                    setSelectedBoardId('');
                    window.localStorage.removeItem('snappy-plan-selected-board');
                    setTasks([]);
                    setIsLoading(false);
                  }
                }
              }}
            />
            : <p role={loadError ? 'alert' : undefined} className="p-4 text-sm text-gray-600">{loadError || 'Loading boards…'}</p>
        ) : (
          <>
        {(loadError || moveError) && <p role="alert" className="mb-3 rounded bg-red-100 p-3 text-sm text-red-700">{loadError || moveError}</p>}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          {/* Backlog is managed separately; the main board keeps its active workflow lanes. */}
          <div
            role="region"
            aria-label={currentPage === 'backlog' ? 'Backlog tasks' : 'Kanban board columns'}
            className="board-columns gap-4 pb-4"
            style={{
              gridTemplateColumns: currentPage === 'backlog'
                ? 'minmax(0, 1fr)'
                : 'repeat(3, minmax(0, 1fr))',
            }}
          >
            {(currentPage === 'backlog' ? COLUMNS.filter((column) => column.id === 'backlog') : BOARD_COLUMNS).map((col) => (
              <Column
                key={col.id}
                column={col}
                tasks={tasks.filter((task) => task.columnId === col.id)}
                onMoveToTodo={currentPage === 'backlog' ? moveBacklogTaskToTodo : undefined}
                onSelectTask={(task) => setSelectedTaskId(task.id)}
              />
            ))}
          </div>

          <DragOverlay>
            {activeTask ? (
              <div className="bg-white p-4 rounded-lg shadow-2xl border-2 border-blue-400 rotate-2 opacity-90 cursor-grabbing">
                <p className="text-gray-800 text-sm font-medium">{activeTask.title}</p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
          </>
        )}
      </main>
      </div>
    </div>
  );
}