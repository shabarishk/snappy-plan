import { useCallback, useEffect, useState } from 'react';
import {
  DndContext, DragOverlay, closestCorners, KeyboardSensor, PointerSensor,
  useSensor, useSensors, useDraggable, useDroppable, type DragStartEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { AuthWrapper } from './Auth';
import { sortTasksByPriority, type TaskPriority } from './taskPriority';
import { createTask as persistTask, getProfile, getTaskAssignees, getTasks, moveTask as persistMoveTask, updateProfile, updateTask as persistUpdateTask, type ApiTask, type TaskAssignee, type UserProfile } from './api';

// --- Types ---
type TaskState = 'Backlog' | 'ToDo' | 'InProgress' | 'Complete';
type ColumnId = 'backlog' | 'todo' | 'in-progress' | 'complete';
export type Task = {
  id: string;
  columnId: ColumnId;
  state: TaskState;
  priority: TaskPriority;
  title: string;
  description?: string | null;
  assignedToId?: string | null;
  completeBy?: string | null;
  completedAt?: string | null;
};
type ColumnType = { id: ColumnId; title: string };

const COLUMNS: ColumnType[] = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'todo', title: 'To Do' },
  { id: 'in-progress', title: 'In Progress' },
  { id: 'complete', title: 'Complete' },
];
const BOARD_COLUMNS = COLUMNS.filter((column) => column.id !== 'backlog');
const COLUMN_STATES: Record<ColumnId, TaskState> = {
  backlog: 'Backlog',
  todo: 'ToDo',
  'in-progress': 'InProgress',
  complete: 'Complete',
};

function toBoardTask(task: ApiTask): Task {
  const stateColumns: Record<TaskState, ColumnId> = {
    Backlog: 'backlog',
    ToDo: 'todo',
    InProgress: 'in-progress',
    Complete: 'complete',
  };
  return {
    id: task.id,
    columnId: stateColumns[task.state],
    state: task.state,
    priority: task.priority,
    title: task.title,
    description: task.description,
    assignedToId: task.assigned_to_id,
    completeBy: task.complete_by,
    completedAt: task.completed_at,
  };
}

function CreateTaskOverlay({
  assignees,
  onClose,
  onCreated,
}: {
  assignees: TaskAssignee[];
  onClose: () => void;
  onCreated: (task: Task) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [state, setState] = useState<'Backlog' | 'ToDo'>('Backlog');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [completeBy, setCompleteBy] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const task = await persistTask({
        title,
        description,
        assigned_to_id: assignedToId,
        state,
        priority,
        complete_by: completeBy ? new Date(completeBy).toISOString() : null,
      });
      onCreated(toBoardTask(task));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-title"
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="create-task-title" className="text-xl font-bold text-gray-800">Create task</h2>
          <button type="button" aria-label="Close create task form" onClick={onClose} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="task-title" className="mb-1 block text-sm font-medium text-gray-700">Title</label>
            <input id="task-title" name="title" required maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2" />
          </div>
          <div>
            <label htmlFor="task-description" className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <textarea id="task-description" name="description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full rounded-lg border border-gray-300 p-2" />
          </div>
          <div>
            <label htmlFor="task-assignee" className="mb-1 block text-sm font-medium text-gray-700">Assigned to</label>
            <select id="task-assignee" name="assigned_to_id" value={assignedToId} onChange={(event) => setAssignedToId(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2">
              <option value="">Unassigned</option>
              {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.full_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="task-state" className="mb-1 block text-sm font-medium text-gray-700">Current state</label>
              <select id="task-state" name="state" value={state} onChange={(event) => setState(event.target.value as 'Backlog' | 'ToDo')} className="w-full rounded-lg border border-gray-300 p-2">
                <option value="Backlog">Backlog</option>
                <option value="ToDo">ToDo</option>
              </select>
            </div>
            <div>
              <label htmlFor="task-priority" className="mb-1 block text-sm font-medium text-gray-700">Priority</label>
              <select id="task-priority" name="priority" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} className="w-full rounded-lg border border-gray-300 p-2">
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>
            <div>
              <label htmlFor="task-complete-by" className="mb-1 block text-sm font-medium text-gray-700">Complete by</label>
              <input id="task-complete-by" name="complete_by" type="datetime-local" value={completeBy} onChange={(event) => setCompleteBy(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2" />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Confirm Task'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function TaskDetailsOverlay({
  task,
  onClose,
  onSaved,
}: {
  task: Task;
  onClose: () => void;
  onSaved: (task: Task) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [state, setState] = useState<TaskState>(task.state);
  const [completeBy, setCompleteBy] = useState(() => {
    if (!task.completeBy) return '';
    const date = new Date(task.completeBy);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await persistUpdateTask(task.id, {
        title,
        description,
        priority,
        state,
        complete_by: completeBy ? new Date(completeBy).toISOString() : null,
      });
      onSaved(toBoardTask(updated));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-details-title"
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="task-details-title" className="text-xl font-bold text-gray-800">Task details</h2>
          <button type="button" aria-label="Close task details" onClick={onClose} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="edit-task-title" className="mb-1 block text-sm font-medium text-gray-700">Title</label>
            <input id="edit-task-title" required maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2" />
          </div>
          <div>
            <label htmlFor="edit-task-description" className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <textarea id="edit-task-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className="w-full rounded-lg border border-gray-300 p-2" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="edit-task-priority" className="mb-1 block text-sm font-medium text-gray-700">Priority</label>
              <select id="edit-task-priority" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} className="w-full rounded-lg border border-gray-300 p-2">
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>
            <div>
              <label htmlFor="edit-task-state" className="mb-1 block text-sm font-medium text-gray-700">State</label>
              <select id="edit-task-state" value={state} onChange={(event) => setState(event.target.value as TaskState)} className="w-full rounded-lg border border-gray-300 p-2">
                <option value="Backlog">Backlog</option>
                <option value="ToDo">To Do</option>
                <option value="InProgress">In Progress</option>
                <option value="Complete">Complete</option>
              </select>
            </div>
            <div>
              <label htmlFor="edit-task-complete-by" className="mb-1 block text-sm font-medium text-gray-700">Complete by</label>
              <input id="edit-task-complete-by" type="datetime-local" value={completeBy} onChange={(event) => setCompleteBy(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2" />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

// --- Sub-Components ---
function TaskCard({
  task,
  onMoveToTodo,
  onSelect,
}: {
  task: Task;
  onMoveToTodo?: (taskId: string) => void;
  onSelect: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { type: 'Task', task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(task)}
      className="bg-white p-4 mb-3 rounded-lg shadow-sm border border-gray-100 cursor-grab active:cursor-grabbing touch-manipulation hover:shadow-md transition-shadow"
    >
      <p className="text-gray-800 text-sm font-medium">{task.title}</p>
      <p className="mt-1 text-xs text-gray-500">Priority: {task.priority}</p>
      {task.description && <p className="mt-1 text-xs text-gray-600">{task.description}</p>}
      {task.completedAt && (
        <p className="mt-2 text-xs text-gray-500">
          Completed <time dateTime={task.completedAt}>{new Date(task.completedAt).toLocaleString()}</time>
        </p>
      )}
      {onMoveToTodo && (
        <button
          type="button"
          className="mt-3 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
          onClick={(event) => {
            event.stopPropagation();
            onMoveToTodo(task.id);
          }}
        >
          Move to To Do
        </button>
      )}
    </div>
  );
}

function moveTaskToColumn(task: Task, columnId: ColumnId): Task {
  if (task.columnId === columnId) return task;
  return {
    ...task,
    columnId,
    state: COLUMN_STATES[columnId],
    completedAt: columnId === 'complete' ? task.completedAt ?? new Date().toISOString() : null,
  };
}

function Column({
  column,
  tasks,
  onMoveToTodo,
  onSelectTask,
}: {
  column: ColumnType;
  tasks: Task[];
  onMoveToTodo?: (taskId: string) => void;
  onSelectTask: (task: Task) => void;
}) {
  const { setNodeRef } = useDroppable({
    id: column.id,
    data: { type: 'Column', column },
  });

  return (
    <>
    {/* Columns stack and scroll with the page on mobile, then fill desktop grid cells. */}
    <div ref={setNodeRef} className="board-column bg-gray-50 flex flex-col rounded-xl max-h-full border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-200 bg-gray-100">
        <h2 className="font-bold text-gray-700">{column.title}</h2>
        <span className="text-xs text-gray-500">{tasks.length} tasks</span>
      </div>
      
      <div className="board-column-tasks flex-1 p-3 overflow-y-auto">
        {sortTasksByPriority(tasks).map((task) => (
          <TaskCard key={task.id} task={task} onMoveToTodo={onMoveToTodo} onSelect={onSelectTask} />
        ))}
      </div>
    </div>
    </>
  );
}

function ProfilePage({
  profile,
  onSaved,
}: {
  profile: UserProfile;
  onSaved: (profile: UserProfile) => void;
}) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [email, setEmail] = useState(profile.email);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSaving(true);
    try {
      const savedProfile = await updateProfile({ full_name: fullName, email });
      setFullName(savedProfile.full_name);
      setEmail(savedProfile.email);
      setIsEditing(false);
      onSaved(savedProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section aria-labelledby="profile-title" className="mx-auto w-full max-w-2xl rounded-xl bg-white p-6 shadow-sm">
      <div className="mb-6 border-b border-gray-100 pb-4">
        <h2 id="profile-title" className="text-2xl font-bold text-gray-800">Profile</h2>
        <p className="mt-1 text-sm text-gray-500">View and update your account information.</p>
      </div>
      <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Username</span>
            <p className="rounded-lg bg-gray-50 p-2 text-gray-700">{profile.username}</p>
          </div>
          <div>
            <label htmlFor="profile-full-name" className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
            <input
              id="profile-full-name"
              type="text"
              required
              maxLength={100}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              disabled={!isEditing || isSaving}
              className="w-full rounded-lg border border-gray-300 p-2 disabled:border-transparent disabled:bg-gray-50 disabled:text-gray-700"
            />
          </div>
          <div>
            <label htmlFor="profile-email" className="mb-1 block text-sm font-medium text-gray-700">Email address</label>
            <input
              id="profile-email"
              type="email"
              required
              maxLength={255}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={!isEditing || isSaving}
              className="w-full rounded-lg border border-gray-300 p-2 disabled:border-transparent disabled:bg-gray-50 disabled:text-gray-700"
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            {isEditing ? (
              <>
                <button type="button" disabled={isSaving} onClick={() => {
                  setFullName(profile.full_name);
                  setEmail(profile.email);
                  setError('');
                  setIsEditing(false);
                }} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
                <button type="submit" disabled={isSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {isSaving ? 'Saving…' : 'Save changes'}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setIsEditing(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Edit profile</button>
            )}
          </div>
      </form>
    </section>
  );
}

export function AuthenticatedBoard({
  tasks,
  setTasks,
}: {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
}) {
  const [currentPage, setCurrentPage] = useState<'board' | 'backlog' | 'profile'>('board');
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [moveError, setMoveError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getTasks(), getTaskAssignees(), getProfile()])
      .then(([savedTasks, availableAssignees, currentProfile]) => {
        if (cancelled) return;
        setTasks(savedTasks.map(toBoardTask));
        setAssignees(availableAssignees);
        setProfile(currentProfile);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load board data');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [setTasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const onDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === 'Task') {
      setActiveTask(event.active.data.current.task);
    }
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id;
    const overId = over.id;
    if (activeId === overId) return;

    const isActiveTask = active.data.current?.type === 'Task';
    const destinationColumn = over.data.current?.type === 'Column'
      ? COLUMNS.find((column) => column.id === overId.toString())
      : undefined;
    if (isActiveTask && destinationColumn) {
      setTasks((prev) => {
        const activeIndex = prev.findIndex((t) => t.id === activeId);
        if (activeIndex < 0) return prev;
        const newTasks = [...prev];
        newTasks[activeIndex] = moveTaskToColumn(newTasks[activeIndex], destinationColumn.id);
        return newTasks;
      });
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

  const onDragEnd = () => {
    const movedTask = activeTask && tasks.find((task) => task.id === activeTask.id);
    if (activeTask && movedTask && movedTask.columnId !== activeTask.columnId) {
      void persistTaskMove(activeTask, movedTask.columnId);
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
  const profileInitial = profile?.full_name.trim().charAt(0).toUpperCase()
    || profile?.username.charAt(0).toUpperCase()
    || '?';

  return (
    <div className="flex h-screen min-h-0 bg-gray-200 font-sans">
      <aside aria-label="Sidebar" className="relative z-20 flex w-16 shrink-0 flex-col items-center border-r border-gray-200 bg-white py-4">
        <button
          type="button"
          aria-label="Home"
          title="Home"
          aria-current={currentPage === 'board' ? 'page' : undefined}
          onClick={() => setCurrentPage('board')}
          className={`flex h-11 w-11 items-center justify-center rounded-xl ${currentPage === 'board' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" />
          </svg>
        </button>
        <div className="mt-auto">
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
              <button type="button" role="menuitem" onClick={() => {
                setIsProfileMenuOpen(false);
                setIsCreateTaskOpen(false);
                setSelectedTaskId(null);
                setCurrentPage('profile');
              }} className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">Profile</button>
              <button type="button" role="menuitem" className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">Settings</button>
            </div>
          )}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
      <header className="bg-white p-4 shadow-sm z-10 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-extrabold text-blue-600 tracking-tight">Snappy Plan</h1>
          {currentPage !== 'profile' && (
            <button type="button" disabled={isLoading || Boolean(loadError)} onClick={() => setIsCreateTaskOpen(true)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              Create task
            </button>
          )}
        </div>
        {currentPage !== 'profile' && <nav aria-label="Main navigation" className="flex items-center gap-2">
          <button
            type="button"
            aria-current={currentPage === 'board' ? 'page' : undefined}
            onClick={() => setCurrentPage('board')}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${currentPage === 'board' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Kanban board
          </button>
          <button
            type="button"
            aria-current={currentPage === 'backlog' ? 'page' : undefined}
            onClick={() => setCurrentPage('backlog')}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${currentPage === 'backlog' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Backlog
          </button>
        </nav>}
      </header>
      {currentPage !== 'profile' && isCreateTaskOpen && (
        <CreateTaskOverlay
          assignees={assignees}
          onClose={() => setIsCreateTaskOpen(false)}
          onCreated={(task) => {
            setTasks((previous) => [...previous, task]);
            setCurrentPage(task.columnId === 'backlog' ? 'backlog' : 'board');
            setIsCreateTaskOpen(false);
          }}
        />
      )}
      {currentPage !== 'profile' && selectedTask && (
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
        {currentPage === 'profile' ? (
          profile
            ? <ProfilePage profile={profile} onSaved={setProfile} />
            : <p role={loadError ? 'alert' : undefined} className="p-4 text-sm text-gray-600">{loadError || 'Loading profile…'}</p>
        ) : (
          <>
        {(loadError || moveError) && <p role="alert" className="mb-3 rounded bg-red-100 p-3 text-sm text-red-700">{loadError || moveError}</p>}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
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

// --- Main App Component ---
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const handleAuthenticated = useCallback(() => setIsAuthenticated(true), []);

  if (!isAuthenticated) {
    return <AuthWrapper onAuthenticated={handleAuthenticated} />;
  }

  return <AuthenticatedBoard tasks={tasks} setTasks={setTasks} />;
}