import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { deleteBoard as persistDeleteBoard, getBoards, getInitiative, getInitiatives, getProfile, getTaskAssignees, getTasks, logout, moveTask as persistMoveTask, updateBoardOrder as persistBoardOrder } from './api';
import type { Board, Initiative, TaskAssignee, UserProfile } from './api';
import type { ColumnId, Task, TaskState } from './taskModel';
import type { AppPage } from './navigation';
import { initiativeIdFromPath, pageFromPath, pathForPage, taskIdFromPath } from './navigation';
import { BOARD_COLUMNS, COLUMNS, COLUMN_STATES, moveTaskToColumn, toBoardTask } from './taskModel';
import { CreateTaskOverlay, TaskDetailsOverlay } from './TaskOverlays';
import { BoardsPage, CreateBoardOverlay } from './BoardComponents';
import { AdminPage } from './AdminPage';
import { SettingsPage } from './SettingsPage';
import { ProfilePage } from './ProfilePage';
import { CreateInitiativeOverlay, InitiativeDetailPage, InitiativesPage } from './InitiativeComponents';
import { TaskSearch } from './TaskSearch';
import { TasksPage } from './TasksPage';
import { NotificationBell } from './NotificationBell';
import { AuthenticatedSidebar } from './AuthenticatedSidebar';
import { BoardTaskColumns, type TaskGroup, type TaskGroupBy } from './BoardTaskColumns';
import { CheckboxFilter } from './TaskFilters';
import { isAllSelected, toggleAllFilter, toggleFilterOption } from './taskFilterUtils';
import type { FilterOption, FilterSelection } from './taskFilterUtils';

type SelectedTask = {
  task: Task;
  boardId: string;
};

const TASK_PROGRESSION: TaskState[] = ['Backlog', 'ToDo', 'InProgress', 'Complete'];
const TASK_STATE_LABELS: Record<TaskState, string> = {
  Backlog: 'Backlog',
  ToDo: 'To Do',
  InProgress: 'In Progress',
  Complete: 'Complete',
};

const MOBILE_LAYOUT_QUERY = '(max-width: 767px), (orientation: portrait) and (max-width: 1024px)';

const COMPLETED_TASK_RETENTION_MS = 24 * 60 * 60 * 1000;
const BACKLOG_TASK_NOTIFICATION_MS = 5_000;

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
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_LAYOUT_QUERY).matches
  );
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [expandedMobileFilter, setExpandedMobileFilter] = useState<'board' | 'initiative' | 'assignee' | null>(null);
  const [isTaskMoveMenuOpen, setIsTaskMoveMenuOpen] = useState(false);
  const [isTaskAssignmentsOpen, setIsTaskAssignmentsOpen] = useState(false);
  const isTaskPage = currentPage === 'board' || currentPage === 'backlog';
  const isCreatePage = currentPage === 'create-task'
    || currentPage === 'create-board'
    || currentPage === 'create-initiative';
  const needsInitiativeGrouping = isTaskPage || currentPage === 'tasks' || currentPage === 'task';
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [groupBy, setGroupBy] = useState<TaskGroupBy>('board');
  const [boardFilterIds, setBoardFilterIds] = useState<FilterSelection>(null);
  const [initiativeFilterIds, setInitiativeFilterIds] = useState<FilterSelection>(null);
  const [assigneeFilterIds, setAssigneeFilterIds] = useState<FilterSelection>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [taskInitiatives, setTaskInitiatives] = useState<Record<string, Initiative[]>>({});
  const [isInitiativeGroupingLoading, setIsInitiativeGroupingLoading] = useState(needsInitiativeGrouping);
  const [initiativeGroupingError, setInitiativeGroupingError] = useState('');
  const [initiativeGroupingRefreshToken, setInitiativeGroupingRefreshToken] = useState(0);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const taskMoveMenuRef = useRef<HTMLDivElement>(null);
  const taskReturnPageRef = useRef<AppPage>('board');
  const createReturnPageRef = useRef<AppPage>('board');
  const [logoutError, setLogoutError] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [isCreateBoardOpen, setIsCreateBoardOpen] = useState(false);
  const [isCreateInitiativeOpen, setIsCreateInitiativeOpen] = useState(false);
  const [initiativeRefreshToken, setInitiativeRefreshToken] = useState(0);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [moveError, setMoveError] = useState('');
  const [boardOrderError, setBoardOrderError] = useState('');
  const [isSavingBoardOrder, setIsSavingBoardOrder] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [backlogTaskNotification, setBacklogTaskNotification] = useState<string | null>(null);
  const boardFilterOptions = useMemo(
    () => boards.map((board) => ({ value: board.id, label: board.title })),
    [boards]
  );
  const initiativeFilterOptions = useMemo(
    () => initiatives.map((initiative) => ({ value: initiative.id, label: initiative.title })),
    [initiatives]
  );
  const assigneeFilterOptions = useMemo(
    () => [
      { value: 'unassigned', label: 'Unassigned' },
      ...assignees.map((assignee) => ({ value: assignee.id, label: assignee.full_name })),
    ],
    [assignees]
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const updateLayout = () => {
      setIsMobileLayout(mediaQuery.matches);
      if (!mediaQuery.matches) {
        setIsMobileSidebarOpen(false);
        setIsMobileFiltersOpen(false);
      }
    };
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  const navigateToPage = (page: AppPage, initiativeId?: string, initiativeTitle?: string) => {
    const path = pathForPage(page, initiativeId, initiativeTitle);
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setIsMobileSidebarOpen(false);
    setIsMobileFiltersOpen(false);
    setIsTaskMoveMenuOpen(false);
    setIsTaskAssignmentsOpen(false);
    setIsCreateMenuOpen(false);
    setIsCreateTaskOpen(false);
    setIsCreateBoardOpen(false);
    setIsCreateInitiativeOpen(false);
    if (page !== 'task') setSelectedTask(null);
    if ((page === 'board' || page === 'backlog' || page === 'tasks') && !needsInitiativeGrouping) {
      setIsInitiativeGroupingLoading(true);
      setInitiativeGroupingError('');
    }
    if (page === 'board' || page === 'backlog') setCurrentTime(Date.now());
    setCurrentPage(page);
  };

  const openCreateItem = (item: 'task' | 'board' | 'initiative') => {
    setIsCreateMenuOpen(false);
    if (isMobileLayout) {
      createReturnPageRef.current = currentPage;
      navigateToPage(item === 'task' ? 'create-task' : item === 'board' ? 'create-board' : 'create-initiative');
      return;
    }
    if (item === 'task') setIsCreateTaskOpen(true);
    if (item === 'board') setIsCreateBoardOpen(true);
    if (item === 'initiative') setIsCreateInitiativeOpen(true);
  };

  const returnFromCreatePage = () => navigateToPage(createReturnPageRef.current);

  const handleTaskCreated = (task: Task, boardId: string) => {
    if (boardId !== selectedBoardId) setIsLoading(true);
    setSelectedBoardId(boardId);
    window.localStorage.setItem('snappy-plan-selected-board', boardId);
    setTasks((previous) => [...previous, { ...task, boardId }]);
    if (task.columnId === 'backlog' && currentPage === 'board') {
      setBacklogTaskNotification(task.title);
    } else {
      navigateToPage(task.columnId === 'backlog' ? 'backlog' : 'board');
    }
    setIsCreateTaskOpen(false);
  };

  const handleBoardCreated = (board: Board) => {
    setBoards((current) => [...current, board]);
    setSelectedBoardId(board.id);
    window.localStorage.setItem('snappy-plan-selected-board', board.id);
    setIsLoading(true);
    setTasks([]);
    setIsCreateBoardOpen(false);
    if (currentPage === 'create-board') navigateToPage('board');
  };

  const handleInitiativeCreated = () => {
    setInitiativeRefreshToken((version) => version + 1);
    setIsCreateInitiativeOpen(false);
    if (currentPage === 'create-initiative') returnFromCreatePage();
  };

  const handleSelectTask = (task: Task, boardId: string) => {
    setSelectedTask({ task, boardId });
    if (isMobileLayout) {
      taskReturnPageRef.current = currentPage;
      navigateToPage('task', task.id);
    }
  };

  const returnFromTaskPage = () => navigateToPage(taskReturnPageRef.current);

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
      setIsMobileSidebarOpen(false);
      setIsMobileFiltersOpen(false);
      setIsTaskMoveMenuOpen(false);
      setIsTaskAssignmentsOpen(false);
      setIsCreateTaskOpen(false);
      setIsCreateBoardOpen(false);
      setIsCreateInitiativeOpen(false);
      setIsCreateMenuOpen(false);
      if (page !== 'task') setSelectedTask(null);
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
    if (!backlogTaskNotification) return;
    const timeout = window.setTimeout(() => setBacklogTaskNotification(null), BACKLOG_TASK_NOTIFICATION_MS);
    return () => window.clearTimeout(timeout);
  }, [backlogTaskNotification]);

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
    if (!isTaskMoveMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !taskMoveMenuRef.current?.contains(event.target)) {
        setIsTaskMoveMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isTaskMoveMenuOpen]);

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
    if (!needsInitiativeGrouping && !isCreateTaskOpen && !selectedTask) return;
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
  }, [initiativeGroupingRefreshToken, initiativeRefreshToken, isCreateTaskOpen, needsInitiativeGrouping, selectedTask]);

  const onDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === 'Task') {
      setActiveTask(event.active.data.current.task);
    }
  };

  const persistTaskMove = async (task: Task, destination: ColumnId): Promise<boolean> => {
    if (task.columnId === destination) return true;
    setMoveError('');
    try {
      await persistMoveTask(task.id, COLUMN_STATES[destination]);
      return true;
    } catch (err) {
      setTasks((previous) => previous.map((current) =>
        current.id === task.id && current.columnId === destination
          ? task
          : current
      ));
      setSelectedTask((current) => current?.task.id === task.id && current.task.columnId === destination
        ? { ...current, task }
        : current);
      setMoveError(err instanceof Error ? err.message : 'Failed to move task');
      return false;
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

  const moveBoard = async (boardId: string, direction: -1 | 1) => {
    if (isSavingBoardOrder) return;
    const currentIndex = boards.findIndex((board) => board.id === boardId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= boards.length) return;

    const previousBoards = boards;
    const reorderedBoards = [...boards];
    [reorderedBoards[currentIndex], reorderedBoards[nextIndex]] =
      [reorderedBoards[nextIndex], reorderedBoards[currentIndex]];
    setBoards(reorderedBoards);
    setBoardOrderError('');
    setIsSavingBoardOrder(true);
    try {
      await persistBoardOrder(reorderedBoards.map((board) => board.id));
    } catch (err) {
      setBoards(previousBoards);
      setBoardOrderError(err instanceof Error ? err.message : 'Failed to save board order');
    } finally {
      setIsSavingBoardOrder(false);
    }
  };

  const initiativesByBoardId = useMemo(() => {
    const byBoard: Record<string, Initiative[]> = {};
    for (const task of tasks) {
      const boardId = task.boardId ?? selectedBoardId;
      for (const initiative of taskInitiatives[task.id] ?? []) {
        const linked = byBoard[boardId] ?? [];
        if (!linked.some((item) => item.id === initiative.id)) {
          byBoard[boardId] = [...linked, initiative];
        }
      }
    }
    return byBoard;
  }, [selectedBoardId, taskInitiatives, tasks]);

  const filteredTasks = useMemo(() => {
    const newestCompletedTaskIds = new Set<string>();
    if (currentPage === 'board') {
      const completedTasksByBoard = new Map<string, Task[]>();
      for (const task of tasks) {
        if (task.state !== 'Complete') continue;
        const boardId = task.boardId ?? selectedBoardId;
        const boardTasks = completedTasksByBoard.get(boardId) ?? [];
        boardTasks.push(task);
        completedTasksByBoard.set(boardId, boardTasks);
      }
      for (const boardTasks of completedTasksByBoard.values()) {
        boardTasks.sort((first, second) => {
          const firstTimestamp = first.completedAt ? Date.parse(first.completedAt) : Number.NEGATIVE_INFINITY;
          const secondTimestamp = second.completedAt ? Date.parse(second.completedAt) : Number.NEGATIVE_INFINITY;
          const firstCompletedAt = Number.isFinite(firstTimestamp) ? firstTimestamp : Number.NEGATIVE_INFINITY;
          const secondCompletedAt = Number.isFinite(secondTimestamp) ? secondTimestamp : Number.NEGATIVE_INFINITY;
          return secondCompletedAt - firstCompletedAt;
        });
        for (const task of boardTasks.slice(0, 5)) newestCompletedTaskIds.add(task.id);
      }
    }

    return tasks.filter((task) => {
      if (currentPage === 'board' && task.state === 'Complete' && !newestCompletedTaskIds.has(task.id)) return false;
      if (currentPage === 'board' && task.state === 'Complete' && task.completedAt) {
        const completedAt = Date.parse(task.completedAt);
        if (Number.isFinite(completedAt) && completedAt + COMPLETED_TASK_RETENTION_MS <= currentTime) return false;
      }
      const belongsToBoard = boardFilterIds === null || boardFilterIds.includes(task.boardId ?? selectedBoardId);
      const belongsToInitiative = isAllSelected(initiativeFilterOptions, initiativeFilterIds)
        || (initiativeFilterIds !== null
          && (taskInitiatives[task.id] ?? []).some((initiative) => initiativeFilterIds.includes(initiative.id)));
      const belongsToAssignee = isAllSelected(assigneeFilterOptions, assigneeFilterIds)
        || (assigneeFilterIds !== null
          && (task.assignedToId
            ? assigneeFilterIds.includes(task.assignedToId)
            : assigneeFilterIds.includes('unassigned')));
      return belongsToBoard && belongsToInitiative && belongsToAssignee;
    });
  }, [assigneeFilterIds, assigneeFilterOptions, boardFilterIds, currentPage, currentTime, initiativeFilterIds, initiativeFilterOptions, selectedBoardId, taskInitiatives, tasks]);

  const taskGroups = useMemo<TaskGroup[]>(() => {
    if (groupBy === 'board') {
      return boards.filter((board) => boardFilterIds === null || boardFilterIds.includes(board.id)).map((board) => ({
        id: `board-${board.id}`,
        title: board.title,
        tasks: filteredTasks.filter((task) => (task.boardId ?? selectedBoardId) === board.id),
        boardId: board.id,
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
  }, [assignees, boardFilterIds, boards, filteredTasks, groupBy, initiatives, selectedBoardId, taskInitiatives]);
  const visibleColumns = currentPage === 'backlog'
    ? COLUMNS.filter((column) => column.id === 'backlog')
    : BOARD_COLUMNS;
  const taskPageId = currentPage === 'task' ? taskIdFromPath(window.location.pathname) : null;
  const taskPageTask = taskPageId
    ? tasks.find((task) => task.id === taskPageId)
      ?? (selectedTask?.task.id === taskPageId ? selectedTask.task : undefined)
    : undefined;
  const taskPageSelection = taskPageTask
    ? {
      task: taskPageTask,
      boardId: taskPageTask.boardId ?? selectedTask?.boardId ?? selectedBoardId,
    }
    : null;
  const isTaskCompleted = taskPageTask?.state === 'Complete';
  const taskProgressIndex = taskPageTask ? TASK_PROGRESSION.indexOf(taskPageTask.state) : -1;
  const forwardTaskState = isTaskCompleted
    ? 'Backlog'
    : taskProgressIndex >= 0 ? TASK_PROGRESSION[taskProgressIndex + 1] : undefined;
  const backwardTaskState = isTaskCompleted
    ? 'ToDo'
    : taskProgressIndex > 0 ? TASK_PROGRESSION[taskProgressIndex - 1] : undefined;

  const moveTaskPageState = async (nextState: TaskState) => {
    if (!taskPageSelection) return;
    const destination = COLUMNS.find((column) => COLUMN_STATES[column.id] === nextState);
    if (!destination) {
      setMoveError('Unable to determine the task destination.');
      return;
    }
    const currentTask = taskPageSelection.task;
    if (currentTask.columnId === destination.id) return;
    const movedTask = moveTaskToColumn(currentTask, destination.id);
    setTasks((previous) => previous.map((task) => task.id === currentTask.id ? movedTask : task));
    setSelectedTask({ ...taskPageSelection, task: movedTask });
    setMoveError('');
    setIsTaskMoveMenuOpen(false);
    const saved = await persistTaskMove(currentTask, destination.id);
    if (saved && isMobileLayout) navigateToPage('board');
  };

  const profileDisplayName = profile?.preferred_name?.trim() || profile?.full_name || '';
  const profileInitial = profileDisplayName.charAt(0).toUpperCase()
    || profile?.username.charAt(0).toUpperCase()
    || '?';
  const activeFilterCount = Number(!isAllSelected(boardFilterOptions, boardFilterIds))
    + Number(!isAllSelected(initiativeFilterOptions, initiativeFilterIds))
    + Number(!isAllSelected(assigneeFilterOptions, assigneeFilterIds));

  const closeMobileFilters = () => {
    setIsMobileFiltersOpen(false);
    setExpandedMobileFilter(null);
  };
  const mobileFilterSections: {
    id: 'board' | 'initiative' | 'assignee';
    title: string;
    options: FilterOption[];
    selectedValues: FilterSelection;
    onToggle: (value: string) => void;
    onToggleAll: () => void;
    disabled?: boolean;
  }[] = [
    {
      id: 'board',
      title: 'Board',
      options: boardFilterOptions,
      selectedValues: boardFilterIds,
      onToggle: (id) => setBoardFilterIds((selected) => toggleFilterOption(boardFilterOptions, selected, id)),
      onToggleAll: () => setBoardFilterIds((selected) => toggleAllFilter(boardFilterOptions, selected)),
    },
    {
      id: 'initiative',
      title: 'Initiative',
      options: initiativeFilterOptions,
      selectedValues: initiativeFilterIds,
      onToggle: (id) => setInitiativeFilterIds((selected) => toggleFilterOption(initiativeFilterOptions, selected, id)),
      onToggleAll: () => setInitiativeFilterIds((selected) => toggleAllFilter(initiativeFilterOptions, selected)),
      disabled: isInitiativeGroupingLoading,
    },
    {
      id: 'assignee',
      title: 'Assignee',
      options: assigneeFilterOptions,
      selectedValues: assigneeFilterIds,
      onToggle: (id) => setAssigneeFilterIds((selected) => toggleFilterOption(assigneeFilterOptions, selected, id)),
      onToggleAll: () => setAssigneeFilterIds((selected) => toggleAllFilter(assigneeFilterOptions, selected)),
    },
  ];

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

  const navigateFromSidebar = (page: AppPage) => {
    setIsProfileMenuOpen(false);
    setIsCreateTaskOpen(false);
    setSelectedTask(null);
    navigateToPage(page);
  };

  return (
    <div className="app-layout flex h-screen min-h-0 bg-gray-200 font-sans">
      <AuthenticatedSidebar
        currentPage={currentPage}
        isMobileLayout={isMobileLayout}
        isMobileSidebarOpen={isMobileSidebarOpen}
        profile={profile}
        profileDisplayName={profileDisplayName}
        profileInitial={profileInitial}
        isProfileMenuOpen={isProfileMenuOpen}
        profileMenuRef={profileMenuRef}
        logoutError={logoutError}
        isLoggingOut={isLoggingOut}
        onCloseMobileSidebar={() => setIsMobileSidebarOpen(false)}
        onToggleProfileMenu={() => setIsProfileMenuOpen((isOpen) => !isOpen)}
        onNavigateHome={() => navigateToPage('board')}
        onNavigateFromMenu={navigateFromSidebar}
        onLogout={() => void handleLogout()}
      />
      <div className="app-content flex min-w-0 flex-1 flex-col">
      <header className={`app-header bg-white p-4 shadow-sm z-10 grid grid-cols-1 gap-2 shrink-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] sm:items-center ${isTaskPage ? 'home-header' : ''}`}>
        {currentPage === 'task' || isCreatePage ? (
          <button
            type="button"
            aria-label={currentPage === 'task' ? 'Back to tasks' : 'Back from creation page'}
            onClick={currentPage === 'task' ? returnFromTaskPage : returnFromCreatePage}
            className="mobile-menu-button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6M9 12h12" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={isMobileSidebarOpen}
            onClick={() => setIsMobileSidebarOpen(true)}
            className="mobile-menu-button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        {currentPage !== 'board' && currentPage !== 'backlog' && (
          currentPage !== 'task' && (
          <h1 className="text-xl font-extrabold tracking-tight text-blue-600 sm:col-start-1 sm:row-start-1">
            {currentPage === 'create-task' ? 'Create task' : currentPage === 'create-board' ? 'Create board' : currentPage === 'create-initiative' ? 'Create initiative' : currentPage === 'tasks' ? 'Tasks' : currentPage === 'admin' ? 'Admin' : currentPage === 'settings' ? 'Settings' : currentPage === 'boards' ? 'Boards' : currentPage === 'initiatives' || currentPage === 'initiative' ? 'Initiatives' : 'Profile'}
          </h1>
          )
        )}
        {(currentPage !== 'profile' && currentPage !== 'settings' || isMobileLayout) && (
          <div className="header-search-actions flex w-full min-w-0 max-w-2xl items-center gap-2 justify-self-center sm:col-start-2 sm:row-start-1">
            <TaskSearch
              boards={boards}
              onSelectTask={handleSelectTask}
            />
            {!isCreatePage && (isMobileLayout || currentPage !== 'profile' && currentPage !== 'settings') && (
            <div ref={createMenuRef} className={isMobileLayout ? 'mobile-create-menu' : 'relative shrink-0'}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={isCreateMenuOpen}
                aria-label="+ Create"
                onClick={() => setIsCreateMenuOpen((open) => !open)}
                className="create-menu-button rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <span aria-hidden="true" className="create-menu-plus">+</span>
                <span className="create-menu-label">Create</span>
              </button>
              {isCreateMenuOpen && (
                <div role="menu" aria-label="Create" className="absolute right-0 top-full z-30 mt-2 w-48 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                  <button type="button" role="menuitem" onClick={() => openCreateItem('task')} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0">
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8 12 3 3 5-6" />
                    </svg>
                    Task
                  </button>
                  <button type="button" role="menuitem" onClick={() => openCreateItem('board')} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0">
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v16m6-16v16" />
                    </svg>
                    Board
                  </button>
                  <button type="button" role="menuitem" onClick={() => openCreateItem('initiative')} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 2 4 14h7l-1 8 10-12h-7l1-8Z" />
                    </svg>
                    Initiative
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        )}
        <NotificationBell />
      </header>
      {currentPage !== 'profile' && currentPage !== 'settings' && !isCreatePage && isCreateTaskOpen && (
        <CreateTaskOverlay
          boards={boards}
          selectedBoardId={selectedBoardId}
          assignees={assignees}
          currentUserId={profile?.username ?? ''}
          boardInitiatives={initiativesByBoardId}
          onClose={() => setIsCreateTaskOpen(false)}
          onCreated={handleTaskCreated}
        />
      )}
      {backlogTaskNotification && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-40 flex max-w-sm items-center gap-3 rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
        >
          <span>{backlogTaskNotification} was added to Backlog.</span>
          <button
            type="button"
            onClick={() => {
              setBacklogTaskNotification(null);
              navigateToPage('backlog');
            }}
            className="shrink-0 font-semibold text-blue-300 underline hover:text-blue-200"
          >
            Show task on board
          </button>
        </div>
      )}
      {currentPage !== 'profile' && currentPage !== 'settings' && !isCreatePage && isCreateBoardOpen && (
        <CreateBoardOverlay
          users={assignees}
          onClose={() => setIsCreateBoardOpen(false)}
          onCreated={handleBoardCreated}
        />
      )}
      {currentPage !== 'profile' && currentPage !== 'settings' && !isCreatePage && isCreateInitiativeOpen && (
        <CreateInitiativeOverlay
          users={assignees}
          onClose={() => setIsCreateInitiativeOpen(false)}
          onCreated={handleInitiativeCreated}
        />
      )}
      {currentPage === 'task' && taskPageSelection && (
        <div className="task-page-toolbar">
          <div ref={taskMoveMenuRef} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={isTaskMoveMenuOpen}
              onClick={() => setIsTaskMoveMenuOpen((open) => !open)}
              className="flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Move task
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {isTaskMoveMenuOpen && (
              <div role="menu" aria-label="Move task" className="absolute left-0 top-full z-30 mt-2 w-56 rounded-lg border border-gray-200 bg-white p-1 shadow-xl">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!forwardTaskState}
                  onClick={() => {
                    if (forwardTaskState) moveTaskPageState(forwardTaskState);
                  }}
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  {isMobileLayout
                    ? forwardTaskState ? TASK_STATE_LABELS[forwardTaskState] : 'No further step'
                    : forwardTaskState
                      ? `${isTaskCompleted ? '' : 'Forward: '}${TASK_STATE_LABELS[forwardTaskState]}`
                      : 'Forward: No further step'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!backwardTaskState}
                  onClick={() => {
                    if (backwardTaskState) moveTaskPageState(backwardTaskState);
                  }}
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  {isMobileLayout
                    ? backwardTaskState ? TASK_STATE_LABELS[backwardTaskState] : 'No earlier step'
                    : backwardTaskState
                      ? `${isTaskCompleted ? '' : 'Backward: '}${TASK_STATE_LABELS[backwardTaskState]}`
                      : 'Backward: No earlier step'}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsTaskAssignmentsOpen(true)}
            className="min-h-10 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            View assignments
          </button>
          {moveError && <p role="alert" className="task-page-move-error">{moveError}</p>}
        </div>
      )}
      {selectedTask && currentPage !== 'task' && currentPage !== 'profile' && currentPage !== 'settings' && (
        <TaskDetailsOverlay
          key={selectedTask.task.id}
          task={selectedTask.task}
          boards={boards}
          assignees={assignees}
          initiatives={initiatives}
          boardInitiatives={initiativesByBoardId[selectedTask.boardId] ?? []}
          linkedInitiatives={taskInitiatives[selectedTask.task.id] ?? []}
          selectedBoardId={selectedTask.boardId}
          onClose={() => setSelectedTask(null)}
          onExpandToPage={() => {
            taskReturnPageRef.current = currentPage;
            navigateToPage('task', selectedTask.task.id);
          }}
          onInitiativesChanged={(updatedInitiatives) => {
            setTaskInitiatives((previous) => ({
              ...previous,
              [selectedTask.task.id]: updatedInitiatives,
            }));
          }}
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
      <main className={`board-main flex-1 p-4 ${isTaskPage ? 'board-main-grouped' : ''} ${currentPage === 'task' ? 'board-main-task-page' : ''} ${currentPage === 'tasks' ? 'board-main-scrollable' : ''}`}>
        {currentPage === 'create-task' ? (
          <CreateTaskOverlay
            boards={boards}
            selectedBoardId={selectedBoardId}
            assignees={assignees}
            currentUserId={profile?.username ?? ''}
            boardInitiatives={initiativesByBoardId}
            onClose={returnFromCreatePage}
            onCreated={handleTaskCreated}
            isPage
          />
        ) : currentPage === 'create-board' ? (
          <CreateBoardOverlay
            users={assignees}
            onClose={returnFromCreatePage}
            onCreated={handleBoardCreated}
            isPage
          />
        ) : currentPage === 'create-initiative' ? (
          <CreateInitiativeOverlay
            users={assignees}
            onClose={returnFromCreatePage}
            onCreated={handleInitiativeCreated}
            isPage
          />
        ) : currentPage === 'admin' ? (
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
        ) : currentPage === 'task' ? (
          taskPageSelection ? (
            <TaskDetailsOverlay
              key={taskPageSelection.task.id}
              task={taskPageSelection.task}
              boards={boards}
              assignees={assignees}
              initiatives={initiatives}
              boardInitiatives={initiativesByBoardId[taskPageSelection.boardId] ?? []}
              linkedInitiatives={taskInitiatives[taskPageSelection.task.id] ?? []}
              selectedBoardId={taskPageSelection.boardId}
              isPage
              isAssignmentsOpen={isTaskAssignmentsOpen}
              onCloseAssignments={() => setIsTaskAssignmentsOpen(false)}
              onClose={returnFromTaskPage}
              onInitiativesChanged={(updatedInitiatives) => {
                setTaskInitiatives((previous) => ({
                  ...previous,
                  [taskPageSelection.task.id]: updatedInitiatives,
                }));
              }}
              onSaved={(updatedTask, assignedBoardId) => {
                const savedTask = { ...updatedTask, boardId: assignedBoardId };
                setTasks((previous) => [
                  ...previous.filter((task) => task.id !== savedTask.id),
                  savedTask,
                ]);
                setSelectedTask({ task: savedTask, boardId: assignedBoardId });
                setIsTaskAssignmentsOpen(false);
              }}
            />
          ) : (
            <p role={loadError ? 'alert' : 'status'} className="p-4 text-sm text-gray-600">
              {loadError || (isLoading ? 'Loading task…' : 'Task not found.')}
            </p>
          )
        ) : currentPage === 'tasks' ? (
          <TasksPage
            tasks={tasks}
            boards={boards}
            initiatives={initiatives}
            assignees={assignees}
            taskInitiatives={taskInitiatives}
            isLoading={isLoading}
            isMobileLayout={isMobileLayout}
            loadError={loadError}
            isInitiativeLoading={isInitiativeGroupingLoading}
            initiativeError={initiativeGroupingError}
            onRetryInitiatives={() => {
              setInitiativeGroupingError('');
              setIsInitiativeGroupingLoading(true);
              setInitiativeGroupingRefreshToken((version) => version + 1);
            }}
            onSelectTask={(task) => handleSelectTask(task, task.boardId ?? selectedBoardId)}
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
          <div className="home-tabs-row mb-4 border-b border-gray-200">
            <nav aria-label="Main navigation" className="flex min-w-0 flex-1 items-center gap-2">
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
            {isMobileLayout && (
              <button
                type="button"
                aria-label="Open filters"
                aria-haspopup="dialog"
                aria-expanded={isMobileFiltersOpen}
                onClick={() => setIsMobileFiltersOpen(true)}
                className="mobile-filter-trigger relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M7 12h10m-7 5h4" />
                  <circle cx="8" cy="7" r="1.5" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
                  <circle cx="11" cy="17" r="1.5" fill="currentColor" stroke="none" />
                </svg>
                {activeFilterCount > 0 && (
                  <span aria-label={`${activeFilterCount} active filters`} className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[0.65rem] font-semibold leading-none text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            )}
          </div>
          {(loadError || moveError || boardOrderError) && <p role="alert" className="mb-3 rounded bg-red-100 p-3 text-sm text-red-700">{loadError || moveError || boardOrderError}</p>}
        {!isMobileLayout && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <CheckboxFilter
                label="Board"
                ariaLabel="Filter by board"
                allLabel="All"
                options={boardFilterOptions}
                selectedValues={boardFilterIds}
                onToggle={(id) => setBoardFilterIds((selected) =>
                  toggleFilterOption(boardFilterOptions, selected, id)
                )}
                onToggleAll={() => setBoardFilterIds((selected) =>
                  toggleAllFilter(boardFilterOptions, selected)
                )}
              />
              <CheckboxFilter
                label="Initiative"
                ariaLabel="Filter by initiative"
                allLabel="All"
                options={initiativeFilterOptions}
                selectedValues={initiativeFilterIds}
                onToggle={(id) => setInitiativeFilterIds((selected) =>
                  toggleFilterOption(initiativeFilterOptions, selected, id)
                )}
                onToggleAll={() => setInitiativeFilterIds((selected) =>
                  toggleAllFilter(initiativeFilterOptions, selected)
                )}
                disabled={isInitiativeGroupingLoading}
              />
              <CheckboxFilter
                label="Assignee"
                ariaLabel="Filter by assignee"
                allLabel="All"
                options={assigneeFilterOptions}
                selectedValues={assigneeFilterIds}
                onToggle={(id) => setAssigneeFilterIds((selected) =>
                  toggleFilterOption(assigneeFilterOptions, selected, id)
                )}
                onToggleAll={() => setAssigneeFilterIds((selected) =>
                  toggleAllFilter(assigneeFilterOptions, selected)
                )}
              />
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
        )}
        {isMobileLayout && isMobileFiltersOpen && (
          <>
            <button
              type="button"
              aria-label="Close task filters"
              className="mobile-filter-backdrop"
              onClick={closeMobileFilters}
            />
            <section role="dialog" aria-modal="true" aria-label="Task filters" className="mobile-filter-panel">
              <header className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
                <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
                <button
                  type="button"
                  aria-label="Close filters"
                  onClick={closeMobileFilters}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
              </header>
              <div className="space-y-3 p-4">
                {mobileFilterSections.map((section) => (
                  <section key={section.id} className="rounded-lg border border-gray-200">
                    <button
                      type="button"
                      aria-expanded={expandedMobileFilter === section.id}
                      aria-controls={`mobile-filter-${section.id}`}
                      onClick={() => setExpandedMobileFilter((expanded) => expanded === section.id ? null : section.id)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-gray-800"
                    >
                      {section.title}
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-4 w-4 transition-transform ${expandedMobileFilter === section.id ? 'rotate-180' : ''}`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    {expandedMobileFilter === section.id && (
                      <div id={`mobile-filter-${section.id}`} className="border-t border-gray-200 p-4">
                        <div role="group" aria-label={`${section.title} options`} className="space-y-2">
                          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
                            <input
                              type="checkbox"
                              aria-label={`${section.title}: All`}
                              checked={isAllSelected(section.options, section.selectedValues)}
                              disabled={section.disabled}
                              onChange={section.onToggleAll}
                              className="accent-blue-600"
                            />
                            All
                          </label>
                          {section.options.map((option) => (
                            <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                aria-label={`${section.title}: ${option.label}`}
                                checked={section.selectedValues === null || section.selectedValues.includes(option.value)}
                                disabled={section.disabled}
                                onChange={() => section.onToggle(option.value)}
                                className="accent-blue-600"
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                ))}
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setBoardFilterIds(null);
                      setInitiativeFilterIds(null);
                      setAssigneeFilterIds(null);
                    }}
                    className="w-full rounded-lg px-4 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            </section>
          </>
        )}
        {initiativeGroupingError && groupBy !== 'initiative' && isAllSelected(initiativeFilterOptions, initiativeFilterIds) && (
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
        ) : isInitiativeGroupingLoading && (groupBy === 'initiative' || !isAllSelected(initiativeFilterOptions, initiativeFilterIds)) ? (
          <p role="status" className="py-8 text-center text-sm text-gray-500">Loading initiative groups…</p>
        ) : initiativeGroupingError && (groupBy === 'initiative' || !isAllSelected(initiativeFilterOptions, initiativeFilterIds)) ? (
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
          <BoardTaskColumns
            currentPage={currentPage}
            isMobileLayout={isMobileLayout}
            filteredTasks={filteredTasks}
            taskGroups={taskGroups}
            visibleColumns={visibleColumns}
            boards={boards}
            assignees={assignees}
            taskInitiatives={taskInitiatives}
            boardFilterOptions={boardFilterOptions}
            boardFilterIds={boardFilterIds}
            groupBy={groupBy}
            isSavingBoardOrder={isSavingBoardOrder}
            activeTask={activeTask}
            selectedBoardId={selectedBoardId}
            onMoveBoard={(boardId, direction) => void moveBoard(boardId, direction)}
            onMoveBacklogTaskToTodo={moveBacklogTaskToTodo}
            onSelectTask={handleSelectTask}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        )}
          </>
        )}
      </main>
      </div>
    </div>
  );
}