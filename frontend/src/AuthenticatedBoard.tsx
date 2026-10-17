import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { deleteBoard as persistDeleteBoard, getBoards, getInitiative, getInitiatives, getProfile, getTaskAssignees, getTasks, logout, moveTask as persistMoveTask } from './api';
import type { Board, Initiative, TaskAssignee, UserProfile } from './api';
import type { ColumnId, Task } from './taskModel';
import type { AppPage } from './navigation';
import { initiativeIdFromPath, pageFromPath, pathForPage } from './navigation';
import { BOARD_COLUMNS, COLUMNS, COLUMN_STATES, moveTaskToColumn, toBoardTask } from './taskModel';
import { CreateTaskOverlay, TaskDetailsOverlay } from './TaskOverlays';
import { BoardsPage, CreateBoardOverlay } from './BoardComponents';
import { AdminPage } from './AdminPage';
import { SettingsPage } from './SettingsPage';
import { ProfilePage } from './ProfilePage';
import { CreateInitiativeOverlay, InitiativeDetailPage, InitiativesPage } from './InitiativeComponents';
import { TaskSearch } from './TaskSearch';
import { Column } from './TaskBoard';
import { TasksPage } from './TasksPage';

type SelectedTask = {
  task: Task;
  boardId: string;
};

type TaskGroupBy = 'board' | 'initiative' | 'assignee';

type TaskGroup = {
  id: string;
  title: string;
  tasks: Task[];
};

const COMPLETED_TASK_RETENTION_MS = 24 * 60 * 60 * 1000;

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
  const isTaskPage = currentPage === 'board' || currentPage === 'backlog';
  const needsInitiativeGrouping = isTaskPage || currentPage === 'tasks';
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [groupBy, setGroupBy] = useState<TaskGroupBy>('board');
  const [boardFilterId, setBoardFilterId] = useState('');
  const [initiativeFilterId, setInitiativeFilterId] = useState('');
  const [assigneeFilterId, setAssigneeFilterId] = useState('all');
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [taskInitiatives, setTaskInitiatives] = useState<Record<string, Initiative[]>>({});
  const [isInitiativeGroupingLoading, setIsInitiativeGroupingLoading] = useState(needsInitiativeGrouping);
  const [initiativeGroupingError, setInitiativeGroupingError] = useState('');
  const [initiativeGroupingRefreshToken, setInitiativeGroupingRefreshToken] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const [logoutError, setLogoutError] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [isCreateBoardOpen, setIsCreateBoardOpen] = useState(false);
  const [isCreateInitiativeOpen, setIsCreateInitiativeOpen] = useState(false);
  const [initiativeRefreshToken, setInitiativeRefreshToken] = useState(0);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [moveError, setMoveError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const navigateToPage = (page: AppPage, initiativeId?: string, initiativeTitle?: string) => {
    const path = pathForPage(page, initiativeId, initiativeTitle);
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setIsCreateMenuOpen(false);
    setIsCreateTaskOpen(false);
    setIsCreateBoardOpen(false);
    setIsCreateInitiativeOpen(false);
    if ((page === 'board' || page === 'backlog' || page === 'tasks') && !needsInitiativeGrouping) {
      setIsInitiativeGroupingLoading(true);
      setInitiativeGroupingError('');
    }
    if (page === 'board' || page === 'backlog') setCurrentTime(Date.now());
    setCurrentPage(page);
  };

  const handleInitiativeTitleChanged = useCallback((title: string) => {
    const initiativeId = initiativeIdFromPath(window.location.pathname);
    if (initiativeId) {
      window.history.replaceState({}, '', pathForPage('initiative', initiativeId, title));
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const page = pageFromPath(window.location.pathname);
      setCurrentPage(page);
      setIsProfileMenuOpen(false);
      setIsCreateTaskOpen(false);
      setIsCreateBoardOpen(false);
      setIsCreateInitiativeOpen(false);
      setIsCreateMenuOpen(false);
      setSelectedTask(null);
      if (page === 'board' || page === 'backlog') setCurrentTime(Date.now());
      if ((page === 'board' || page === 'backlog' || page === 'tasks') && !needsInitiativeGrouping) {
        setIsInitiativeGroupingLoading(true);
        setInitiativeGroupingError('');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [needsInitiativeGrouping]);

  useEffect(() => {
    if (currentPage !== 'board') return;

    const nextExpiration = tasks.reduce((earliestExpiration, task) => {
      if (task.state !== 'Complete' || !task.completedAt) return earliestExpiration;
      const completedAt = Date.parse(task.completedAt);
      if (!Number.isFinite(completedAt)) return earliestExpiration;
      const expiration = completedAt + COMPLETED_TASK_RETENTION_MS;
      return expiration > currentTime && expiration < earliestExpiration ? expiration : earliestExpiration;
    }, Number.POSITIVE_INFINITY);

    if (!Number.isFinite(nextExpiration)) return;
    const timeout = window.setTimeout(
      () => setCurrentTime(Date.now()),
      Math.max(0, nextExpiration - currentTime)
    );
    return () => window.clearTimeout(timeout);
  }, [currentPage, currentTime, tasks]);

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
    if (!isCreateMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !createMenuRef.current?.contains(event.target)) {
        setIsCreateMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isCreateMenuOpen]);

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
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load board data');
          setIsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [setTasks]);

  useEffect(() => {
    if (!selectedBoardId || boards.length === 0) return;
    let cancelled = false;
    Promise.all(boards.map(async (board) => ({
      boardId: board.id,
      tasks: await getTasks(board.id),
    })))
      .then((boardTasks) => {
        if (!cancelled) {
          setTasks(boardTasks.flatMap(({ boardId, tasks: savedTasks }) =>
            savedTasks.map((task) => toBoardTask(task, boardId))
          ));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load board tasks');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [boards, selectedBoardId, setTasks]);

  useEffect(() => {
    if (!needsInitiativeGrouping) return;
    let cancelled = false;
    Promise.all([
      getInitiatives(),
    ])
      .then(async ([availableInitiatives]) => Promise.all(
        availableInitiatives.map(async (initiative) => ({
          initiative,
          tasks: (await getInitiative(initiative.id)).tasks,
        }))
      ))
      .then((initiativeTasks) => {
        if (cancelled) return;
        const taskToInitiatives: Record<string, Initiative[]> = {};
        for (const { initiative, tasks: initiativeTaskList } of initiativeTasks) {
          for (const task of initiativeTaskList) {
            taskToInitiatives[task.id] = [...(taskToInitiatives[task.id] ?? []), initiative];
          }
        }
        setInitiatives(initiativeTasks.map(({ initiative }) => initiative));
        setTaskInitiatives(taskToInitiatives);
        setInitiativeGroupingError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setInitiativeGroupingError(err instanceof Error ? err.message : 'Failed to load initiative task groups');
      })
      .finally(() => {
        if (!cancelled) setIsInitiativeGroupingLoading(false);
      });
    return () => { cancelled = true; };
  }, [initiativeGroupingRefreshToken, initiativeRefreshToken, needsInitiativeGrouping]);

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
    const taskId = event.active.data.current?.type === 'Task'
      ? event.active.data.current.task.id
      : undefined;
    const task = tasks.find((current) => current.id === taskId);
    const overData = event.over?.data.current;
    const destinationColumn = overData?.type === 'Column'
      ? COLUMNS.find((column) => column.id === overData.columnId)
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

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    if (currentPage === 'board' && task.state === 'Complete' && task.completedAt) {
      const completedAt = Date.parse(task.completedAt);
      if (Number.isFinite(completedAt) && completedAt + COMPLETED_TASK_RETENTION_MS <= currentTime) return false;
    }
    const belongsToBoard = !boardFilterId || (task.boardId ?? selectedBoardId) === boardFilterId;
    const belongsToInitiative = !initiativeFilterId
      || (taskInitiatives[task.id] ?? []).some((initiative) => initiative.id === initiativeFilterId);
    const belongsToAssignee = assigneeFilterId === 'all'
      || (assigneeFilterId === 'unassigned'
        ? !task.assignedToId
        : task.assignedToId === assigneeFilterId.slice('assignee:'.length));
    return belongsToBoard && belongsToInitiative && belongsToAssignee;
  }), [assigneeFilterId, boardFilterId, currentPage, currentTime, initiativeFilterId, selectedBoardId, taskInitiatives, tasks]);

  const taskGroups = useMemo<TaskGroup[]>(() => {
    if (groupBy === 'board') {
      return boards.filter((board) => !boardFilterId || board.id === boardFilterId).map((board) => ({
        id: `board-${board.id}`,
        title: board.title,
        tasks: filteredTasks.filter((task) => (task.boardId ?? selectedBoardId) === board.id),
      }));
    }

    if (groupBy === 'initiative') {
      const groups = new Map(initiatives.map((initiative) => [
        initiative.id,
        { id: `initiative-${initiative.id}`, title: initiative.title, tasks: [] as Task[] },
      ]));
      const withoutInitiative: Task[] = [];
      for (const task of filteredTasks) {
        const associatedInitiatives = taskInitiatives[task.id] ?? [];
        if (associatedInitiatives.length === 0) {
          withoutInitiative.push(task);
          continue;
        }
        for (const initiative of associatedInitiatives) {
          groups.get(initiative.id)?.tasks.push(task);
        }
      }
      const grouped = [...groups.values()].filter((group) => group.tasks.length > 0);
      if (withoutInitiative.length > 0) {
        grouped.push({ id: 'initiative-none', title: 'No Initiative', tasks: withoutInitiative });
      }
      return grouped;
    }

    const groups = new Map(assignees.map((assignee) => [
      assignee.id,
      { id: `assignee-${assignee.id}`, title: assignee.full_name, tasks: [] as Task[] },
    ]));
    const unknownAssigneeGroups = new Map<string, TaskGroup>();
    const withoutAssignee: Task[] = [];
    for (const task of filteredTasks) {
      if (!task.assignedToId) {
        withoutAssignee.push(task);
        continue;
      }
      const group = groups.get(task.assignedToId);
      if (group) {
        group.tasks.push(task);
      } else {
        const unknownGroup = unknownAssigneeGroups.get(task.assignedToId)
          ?? { id: `assignee-${task.assignedToId}`, title: task.assignedToId, tasks: [] };
        unknownGroup.tasks.push(task);
        unknownAssigneeGroups.set(task.assignedToId, unknownGroup);
      }
    }
    const grouped = [...groups.values()].filter((group) => group.tasks.length > 0);
    grouped.push(...[...unknownAssigneeGroups.values()].sort((left, right) => left.title.localeCompare(right.title)));
    if (withoutAssignee.length > 0) {
      grouped.push({ id: 'assignee-none', title: 'No Assignee', tasks: withoutAssignee });
    }
    return grouped;
  }, [assignees, boardFilterId, boards, filteredTasks, groupBy, initiatives, selectedBoardId, taskInitiatives]);
  const visibleColumns = currentPage === 'backlog'
    ? COLUMNS.filter((column) => column.id === 'backlog')
    : BOARD_COLUMNS;

  const profileDisplayName = profile?.preferred_name?.trim() || profile?.full_name || '';
  const profileInitial = profileDisplayName.charAt(0).toUpperCase()
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
          aria-label="Tasks"
          title="Tasks"
          aria-current={currentPage === 'tasks' ? 'page' : undefined}
          onClick={() => {
            setIsProfileMenuOpen(false);
            setIsCreateTaskOpen(false);
            setSelectedTask(null);
            navigateToPage('tasks');
          }}
          className={`mt-2 flex h-11 w-11 items-center justify-center rounded-xl ${currentPage === 'tasks' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path strokeLinecap="round" strokeLinejoin="round" d="m8 12 3 3 5-6" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Initiatives"
          title="Initiatives"
          aria-current={currentPage === 'initiatives' || currentPage === 'initiative' ? 'page' : undefined}
          onClick={() => {
            setIsProfileMenuOpen(false);
            setIsCreateTaskOpen(false);
            setSelectedTask(null);
            navigateToPage('initiatives');
          }}
          className={`mt-2 flex h-11 w-11 items-center justify-center rounded-xl ${currentPage === 'initiatives' || currentPage === 'initiative' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 2 4 14h7l-1 8 10-12h-7l1-8Z" />
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
            setSelectedTask(null);
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
                setSelectedTask(null);
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
            title={profileDisplayName || 'User profile'}
            onClick={() => setIsProfileMenuOpen((isOpen) => !isOpen)}
            className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-bold text-blue-700 hover:bg-blue-200"
          >
            {profile?.profile_picture
              ? <img src={profile.profile_picture} alt="" className="h-full w-full object-cover" />
              : profileInitial}
          </button>
          {isProfileMenuOpen && (
            <div role="menu" aria-label="User menu" className="absolute bottom-4 left-full ml-2 w-40 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
              {logoutError && <p role="alert" className="px-3 py-2 text-xs text-red-700">{logoutError}</p>}
              <button type="button" role="menuitem" onClick={() => {
                setIsProfileMenuOpen(false);
                setIsCreateTaskOpen(false);
                setSelectedTask(null);
                navigateToPage('profile');
              }} className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">Profile</button>
              <button type="button" role="menuitem" onClick={() => {
                setIsProfileMenuOpen(false);
                setIsCreateTaskOpen(false);
                setSelectedTask(null);
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
      <header className="bg-white p-4 shadow-sm z-10 grid grid-cols-1 gap-2 shrink-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] sm:items-center">
        {currentPage !== 'board' && currentPage !== 'backlog' && (
          <h1 className="text-xl font-extrabold tracking-tight text-blue-600 sm:col-start-1 sm:row-start-1">
            {currentPage === 'tasks' ? 'Tasks' : currentPage === 'admin' ? 'Admin' : currentPage === 'settings' ? 'Settings' : currentPage === 'boards' ? 'Boards' : currentPage === 'initiatives' || currentPage === 'initiative' ? 'Initiatives' : 'Profile'}
          </h1>
        )}
        {currentPage !== 'profile' && currentPage !== 'settings' && (
          <div className="flex w-full min-w-0 max-w-2xl items-center gap-2 justify-self-center sm:col-start-2 sm:row-start-1">
            <TaskSearch
              boards={boards}
              onSelectTask={(task, boardId) => setSelectedTask({ task, boardId })}
            />
            <div ref={createMenuRef} className="relative shrink-0">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={isCreateMenuOpen}
                onClick={() => setIsCreateMenuOpen((open) => !open)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                + Create
              </button>
              {isCreateMenuOpen && (
                <div role="menu" aria-label="Create" className="absolute right-0 top-full z-30 mt-2 w-48 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                  <button type="button" role="menuitem" onClick={() => {
                    setIsCreateMenuOpen(false);
                    setIsCreateTaskOpen(true);
                  }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0">
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8 12 3 3 5-6" />
                    </svg>
                    Task
                  </button>
                  <button type="button" role="menuitem" onClick={() => {
                    setIsCreateMenuOpen(false);
                    setIsCreateBoardOpen(true);
                  }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0">
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v16m6-16v16" />
                    </svg>
                    Board
                  </button>
                  <button type="button" role="menuitem" onClick={() => {
                    setIsCreateMenuOpen(false);
                    setIsCreateInitiativeOpen(true);
                  }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 2 4 14h7l-1 8 10-12h-7l1-8Z" />
                    </svg>
                    Initiative
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </header>
      {currentPage !== 'profile' && currentPage !== 'settings' && isCreateTaskOpen && (
        <CreateTaskOverlay
          boards={boards}
          selectedBoardId={selectedBoardId}
          assignees={assignees}
          currentUserId={profile?.username ?? ''}
          onClose={() => setIsCreateTaskOpen(false)}
          onCreated={(task, boardId) => {
            if (boardId !== selectedBoardId) setIsLoading(true);
            setSelectedBoardId(boardId);
            window.localStorage.setItem('snappy-plan-selected-board', boardId);
            setTasks((previous) => [...previous, { ...task, boardId }]);
            navigateToPage(task.columnId === 'backlog' ? 'backlog' : 'board');
            setIsCreateTaskOpen(false);
          }}
        />
      )}
      {currentPage !== 'profile' && currentPage !== 'settings' && isCreateBoardOpen && (
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
      {currentPage !== 'profile' && currentPage !== 'settings' && isCreateInitiativeOpen && (
        <CreateInitiativeOverlay
          users={assignees}
          onClose={() => setIsCreateInitiativeOpen(false)}
          onCreated={() => {
            setInitiativeRefreshToken((version) => version + 1);
            setIsCreateInitiativeOpen(false);
          }}
        />
      )}
      {selectedTask && currentPage !== 'profile' && currentPage !== 'settings' && (
        <TaskDetailsOverlay
          key={selectedTask.task.id}
          task={selectedTask.task}
          boards={boards}
          assignees={assignees}
          selectedBoardId={selectedTask.boardId}
          onClose={() => setSelectedTask(null)}
          onSaved={(updatedTask, assignedBoardId) => {
            setTasks((previous) => [
              ...previous.filter((task) => task.id !== updatedTask.id),
              { ...updatedTask, boardId: assignedBoardId },
            ]);
            setSelectedTask(null);
          }}
        />
      )}

      {/* Main content area takes up remaining height */}
      <main className={`board-main flex-1 p-4 ${(currentPage === 'board' || currentPage === 'backlog') ? 'board-main-grouped' : ''}`}>
        {currentPage === 'admin' ? (
          profile?.role === 'admin'
            ? <AdminPage currentUsername={profile.username} />
            : <p role="alert" className="p-4 text-sm text-red-700">Administrator access required.</p>
        ) : currentPage === 'settings' ? (
          <SettingsPage />
        ) : currentPage === 'profile' ? (
          profile
            ? <ProfilePage profile={profile} onSaved={(savedProfile) => {
              setProfile(savedProfile);
              const personalName = savedProfile.preferred_name?.trim() || savedProfile.full_name;
              setBoards((currentBoards) => currentBoards.map((board) =>
                board.is_personal && board.owner_id === savedProfile.username
                  ? { ...board, title: `${personalName}'s personal board` }
                  : board
              ));
            }} />
            : <p role={loadError ? 'alert' : undefined} className="p-4 text-sm text-gray-600">{loadError || 'Loading profile…'}</p>
        ) : currentPage === 'tasks' ? (
          <TasksPage
            tasks={tasks}
            boards={boards}
            initiatives={initiatives}
            assignees={assignees}
            taskInitiatives={taskInitiatives}
            isLoading={isLoading}
            loadError={loadError}
            isInitiativeLoading={isInitiativeGroupingLoading}
            initiativeError={initiativeGroupingError}
            onRetryInitiatives={() => {
              setInitiativeGroupingError('');
              setIsInitiativeGroupingLoading(true);
              setInitiativeGroupingRefreshToken((version) => version + 1);
            }}
            onSelectTask={(task) => setSelectedTask({ task, boardId: task.boardId ?? selectedBoardId })}
          />
        ) : currentPage === 'boards' ? (
          profile
            ? <BoardsPage
              boards={boards}
              users={assignees}
              username={profile.username}
              onOpenBoard={(board) => {
                if (selectedBoardId !== board.id) {
                  setSelectedBoardId(board.id);
                  setIsLoading(true);
                }
                window.localStorage.setItem('snappy-plan-selected-board', board.id);
                navigateToPage('board');
              }}
              onCreateBoard={() => setIsCreateBoardOpen(true)}
              onDeleteBoard={async (board) => {
                await persistDeleteBoard(board.id);
                const remainingBoards = boards.filter((current) => current.id !== board.id);
                setBoards(remainingBoards);
                setIsLoading(true);
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
        ) : currentPage === 'initiatives' ? (
          <InitiativesPage
            refreshToken={initiativeRefreshToken}
            onCreateInitiative={() => setIsCreateInitiativeOpen(true)}
            onOpenInitiative={(initiative) => navigateToPage('initiative', initiative.id, initiative.title)}
          />
        ) : currentPage === 'initiative' ? (
          <InitiativeDetailPage
            key={initiativeIdFromPath(window.location.pathname) ?? ''}
            initiativeId={initiativeIdFromPath(window.location.pathname) ?? ''}
            users={assignees}
            onBack={() => navigateToPage('initiatives')}
            onTitleChanged={handleInitiativeTitleChanged}
          />
        ) : (
          <>
          <div className="mb-4 border-b border-gray-200">
            <nav aria-label="Main navigation" className="flex items-center gap-2">
              <button
                type="button"
                aria-current={currentPage === 'board' ? 'page' : undefined}
                onClick={() => navigateToPage('board')}
                className={`relative inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${currentPage === 'board' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v16m6-16v16" />
                </svg>
                Active
                {currentPage === 'board' && (
                  <span aria-hidden="true" className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-blue-500 shadow-[0_0_8px_2px_rgba(59,130,246,0.7)]" />
                )}
              </button>
              <button
                type="button"
                aria-current={currentPage === 'backlog' ? 'page' : undefined}
                onClick={() => navigateToPage('backlog')}
                className={`relative inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${currentPage === 'backlog' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 rotate-90">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v16m6-16v16" />
                </svg>
                Backlog
                {currentPage === 'backlog' && (
                  <span aria-hidden="true" className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-blue-500 shadow-[0_0_8px_2px_rgba(59,130,246,0.7)]" />
                )}
              </button>
            </nav>
          </div>
          {(loadError || moveError) && <p role="alert" className="mb-3 rounded bg-red-100 p-3 text-sm text-red-700">{loadError || moveError}</p>}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <span>Board</span>
              <select
                aria-label="Filter by board"
                value={boardFilterId}
                onChange={(event) => setBoardFilterId(event.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2"
              >
                <option value="">All boards</option>
                {boards.map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <span>Initiative</span>
              <select
                aria-label="Filter by initiative"
                value={initiativeFilterId}
                onChange={(event) => setInitiativeFilterId(event.target.value)}
                disabled={isInitiativeGroupingLoading}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 disabled:opacity-60"
              >
                <option value="">All initiatives</option>
                {initiatives.map((initiative) => (
                  <option key={initiative.id} value={initiative.id}>{initiative.title}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <span>Assignee</span>
              <select
                aria-label="Filter by assignee"
                value={assigneeFilterId}
                onChange={(event) => setAssigneeFilterId(event.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2"
              >
                <option value="all">All assignees</option>
                <option value="unassigned">Unassigned</option>
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={`assignee:${assignee.id}`}>{assignee.full_name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <span>Group by:</span>
            <select
              aria-label="Group tasks by"
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value as TaskGroupBy)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2"
            >
              <option value="board">Board</option>
              <option value="initiative">Initiative</option>
              <option value="assignee">Assignee</option>
            </select>
          </label>
        </div>
        {initiativeGroupingError && groupBy !== 'initiative' && !initiativeFilterId && (
          <div className="mb-3 flex items-center gap-3 rounded bg-red-100 p-3 text-sm text-red-700">
            <p role="alert">{initiativeGroupingError}</p>
            <button
              type="button"
              onClick={() => {
                setInitiativeGroupingError('');
                setIsInitiativeGroupingLoading(true);
                setInitiativeGroupingRefreshToken((version) => version + 1);
              }}
              className="font-medium underline"
            >
              Retry
            </button>
          </div>
        )}
        {isLoading ? (
          <p role="status" className="py-8 text-center text-sm text-gray-500">Loading tasks…</p>
        ) : isInitiativeGroupingLoading && (groupBy === 'initiative' || Boolean(initiativeFilterId)) ? (
          <p role="status" className="py-8 text-center text-sm text-gray-500">Loading initiative groups…</p>
        ) : initiativeGroupingError && (groupBy === 'initiative' || Boolean(initiativeFilterId)) ? (
          <div className="rounded bg-red-100 p-3 text-sm text-red-700">
            <p role="alert">{initiativeGroupingError}</p>
            <button
              type="button"
              onClick={() => {
                setInitiativeGroupingError('');
                setIsInitiativeGroupingLoading(true);
                setInitiativeGroupingRefreshToken((version) => version + 1);
              }}
              className="mt-2 font-medium underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <div role="region" aria-label={currentPage === 'backlog' ? 'Backlog tasks' : 'Kanban board columns'} className="space-y-6 pb-4">
              {taskGroups.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">No tasks to display.</p>
              ) : taskGroups.map((group) => {
                const groupTasks = currentPage === 'backlog'
                  ? group.tasks.filter((task) => task.columnId === 'backlog')
                  : group.tasks;
                return (
                  <section key={group.id} aria-label={`${group.title} tasks`} className="space-y-2">
                    <header className="flex items-center justify-between gap-3">
                      <h2 className="text-lg font-semibold text-gray-800">{group.title}</h2>
                      <span className="text-xs text-gray-500">{groupTasks.length} tasks</span>
                    </header>
                    <div className={`grid items-start gap-4 ${currentPage === 'backlog' ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'}`}>
                      {visibleColumns.map((column) => (
                        <Column
                          key={`${group.id}-${column.id}`}
                          column={column}
                          tasks={groupTasks.filter((task) => task.columnId === column.id)}
                          onMoveToTodo={currentPage === 'backlog' ? moveBacklogTaskToTodo : undefined}
                          onSelectTask={(task) => setSelectedTask({ task, boardId: task.boardId ?? selectedBoardId })}
                          droppableId={`${group.id}:${column.id}`}
                          taskIdPrefix={group.id}
                          hideColumnTitle={currentPage === 'backlog'}
                          sortByCompleteBy={currentPage === 'backlog'}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            <DragOverlay>
              {activeTask ? (
                <div className="bg-white p-4 rounded-lg shadow-2xl border-2 border-blue-400 rotate-2 opacity-90 cursor-grabbing">
                  <p className="text-gray-800 text-sm font-medium">{activeTask.title}</p>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
          </>
        )}
      </main>
      </div>
    </div>
  );
}