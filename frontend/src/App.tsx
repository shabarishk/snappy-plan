import { useCallback, useEffect, useState } from 'react';
import {
  DndContext, DragOverlay, closestCorners, KeyboardSensor, PointerSensor,
  useSensor, useSensors, useDraggable, useDroppable, type DragStartEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { AuthWrapper } from './Auth';
import { sortTasksByPriority, type TaskPriority } from './taskPriority';
import { createBoard as persistCreateBoard, createTask as persistTask, createUser, deleteBoard as persistDeleteBoard, getAdminBoards, getAdminUsers, getBoardMembers, getBoards, getProfile, getTaskAssignees, getTasks, logout, moveTask as persistMoveTask, promoteUserToAdmin, updateBoardMembers, updatePassword, updateProfile, updateTask as persistUpdateTask, type AdminBoard, type AdminUser, type ApiTask, type Board, type TaskAssignee, type UserProfile } from './api';

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

type AppPage = 'board' | 'backlog' | 'boards' | 'profile' | 'settings' | 'admin';

function pageFromPath(pathname: string): AppPage {
  if (pathname === '/admin') return 'admin';
  if (pathname === '/boards') return 'boards';
  if (pathname === '/profile') return 'profile';
  if (pathname === '/settings') return 'settings';
  return 'board';
}

function pathForPage(page: AppPage): string {
  if (page === 'admin') return '/admin';
  if (page === 'boards') return '/boards';
  if (page === 'profile') return '/profile';
  if (page === 'settings') return '/settings';
  return '/';
}

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
  boards,
  selectedBoardId,
  assignees,
  onClose,
  onCreated,
}: {
  boards: Board[];
  selectedBoardId: string;
  assignees: TaskAssignee[];
  onClose: () => void;
  onCreated: (task: Task, boardId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [boardId, setBoardId] = useState(selectedBoardId);
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
        board_id: boardId,
        title,
        description,
        assigned_to_id: assignedToId,
        state,
        priority,
        complete_by: completeBy ? new Date(completeBy).toISOString() : null,
      });
      onCreated(toBoardTask(task), boardId);
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
            <label htmlFor="task-board" className="mb-1 block text-sm font-medium text-gray-700">Board</label>
            <select id="task-board" name="board_id" required value={boardId} onChange={(event) => setBoardId(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2">
              <option value="" disabled>Select a board</option>
              {boards.map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}
            </select>
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
            <button type="submit" disabled={saving || boards.length === 0} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Confirm Task'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CreateBoardOverlay({
  users,
  onClose,
  onCreated,
}: {
  users: TaskAssignee[];
  onClose: () => void;
  onCreated: (board: Board) => void;
}) {
  const [title, setTitle] = useState('');
  const [userIds, setUserIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSaving(true);
    try {
      onCreated(await persistCreateBoard(title, userIds));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create board');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="create-board-title" className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="create-board-title" className="text-xl font-bold text-gray-800">Create a new board</h2>
          <button type="button" aria-label="Close create board form" onClick={onClose} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-board-title" className="mb-1 block text-sm font-medium text-gray-700">Board name</label>
            <input id="new-board-title" required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2" />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-gray-700">Users who can access this board</legend>
            {users.length === 0 ? <p className="text-sm text-gray-500">No other users are available.</p> : users.map((user) => (
              <label key={user.id} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={userIds.includes(user.id)}
                  onChange={(event) => setUserIds((current) => event.target.checked
                    ? [...current, user.id]
                    : current.filter((id) => id !== user.id))}
                />
                {user.full_name} ({user.id})
              </label>
            ))}
          </fieldset>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={isSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {isSaving ? 'Creating…' : 'Create board'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ManageBoardOverlay({
  board,
  users,
  onClose,
  onDeleteBoard,
}: {
  board: Board;
  users: TaskAssignee[];
  onClose: () => void;
  onDeleteBoard: (board: Board) => Promise<void>;
}) {
  const [userIds, setUserIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getBoardMembers(board.id)
      .then((ids) => { if (!cancelled) setUserIds(ids); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load board access'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [board.id]);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSaving(true);
    try {
      await updateBoardMembers(board.id, userIds);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update board access');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    setError('');
    setIsDeleting(true);
    try {
      await onDeleteBoard(board);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete board');
      setIsConfirmingDelete(false);
      setIsDeleting(false);
    }
  };

  const selectableUsers = users.filter((user) => user.id !== board.owner_id);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="manage-board-title" className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="manage-board-title" className="text-xl font-bold text-gray-800">Manage {board.title}</h2>
          <button type="button" aria-label="Close manage board form" onClick={onClose} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100">×</button>
        </div>
        <form onSubmit={handleSave} className="space-y-4">
          <fieldset className="max-h-64 space-y-2 overflow-y-auto">
            <legend className="mb-1 text-sm font-medium text-gray-700">Users who can access this board</legend>
            {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : selectableUsers.length === 0 ? <p className="text-sm text-gray-500">No other users are available.</p> : selectableUsers.map((user) => (
              <label key={user.id} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={userIds.includes(user.id)}
                  onChange={(event) => setUserIds((current) => event.target.checked
                    ? [...current, user.id]
                    : current.filter((id) => id !== user.id))}
                />
                {user.full_name} ({user.id})
              </label>
            ))}
          </fieldset>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={isLoading || isSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save access'}
            </button>
          </div>
        </form>
        <div className="mt-6 border-t border-gray-200 pt-4">
          <button type="button" onClick={() => setIsConfirmingDelete(true)} className="rounded-lg px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
            Delete board
          </button>
        </div>
        {isConfirmingDelete && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
            <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-delete-title" className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
              <h3 id="confirm-delete-title" className="text-lg font-bold text-gray-800">This option will delete the board</h3>
              <div className="mt-5 flex justify-end gap-3">
                <button type="button" onClick={() => setIsConfirmingDelete(false)} disabled={isDeleting} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
                <button type="button" onClick={() => void handleConfirmDelete()} disabled={isDeleting} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                  {isDeleting ? 'Deleting…' : 'Confirm'}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function BoardsPage({
  boards,
  users,
  username,
  onOpenBoard,
  onCreateBoard,
  onDeleteBoard,
}: {
  boards: Board[];
  users: TaskAssignee[];
  username: string;
  onOpenBoard: (board: Board) => void;
  onCreateBoard: () => void;
  onDeleteBoard: (board: Board) => Promise<void>;
}) {
  const [managingBoard, setManagingBoard] = useState<Board | null>(null);

  return (
    <section aria-labelledby="boards-title" className="mx-auto flex h-full max-w-3xl flex-col">
      <header className="mb-6">
        <h2 id="boards-title" className="text-2xl font-bold text-gray-900">Your boards</h2>
        <p className="mt-1 text-sm text-gray-600">Manage your boards and the boards shared with you.</p>
      </header>
      <ul aria-label="Boards" className="min-h-0 flex-1 overflow-y-auto divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
        {boards.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-gray-500">You don't have any boards yet. Create one below to get started.</li>
        ) : boards.map((board) => {
          const isOwner = board.owner_id === username;
          return (
            <li key={board.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-gray-900">{board.title}</h3>
                <p className="text-sm text-gray-500">{isOwner ? 'Created by you' : 'Shared with you'}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => onOpenBoard(board)} className="rounded-lg px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
                  Open board
                </button>
                {isOwner && (
                  <button
                    type="button"
                    aria-label={`Manage ${board.title}`}
                    onClick={() => setManagingBoard(board)}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                  >
                    Manage
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto border-t border-gray-200 pt-5">
        <button type="button" onClick={onCreateBoard} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700">
          + Create new board
        </button>
      </div>
      {managingBoard && (
        <ManageBoardOverlay
          board={managingBoard}
          users={users}
          onClose={() => setManagingBoard(null)}
          onDeleteBoard={onDeleteBoard}
        />
      )}
    </section>
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
    <section aria-label="Profile details" className="mx-auto w-full max-w-2xl rounded-xl bg-white p-6 shadow-sm">
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

function SettingsPage() {
  const [selectedSection, setSelectedSection] = useState<'profile-settings'>('profile-settings');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setIsSaving(true);
    try {
      await updatePassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Password updated successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section aria-label="Settings" className="mx-auto w-full max-w-5xl">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="rounded-xl bg-white p-2 shadow-sm">
          <button
            type="button"
            aria-current={selectedSection === 'profile-settings' ? 'page' : undefined}
            onClick={() => setSelectedSection('profile-settings')}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${selectedSection === 'profile-settings' ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            Profile settings
          </button>
        </nav>
        <div className="rounded-xl bg-white p-6 shadow-sm">
          {selectedSection === 'profile-settings' && (
            <section aria-labelledby="password-settings-title">
              <div className="mb-6 border-b border-gray-100 pb-4">
                <h3 id="password-settings-title" className="text-lg font-bold text-gray-800">Change password</h3>
                <p className="mt-1 text-sm text-gray-500">Enter your current password and choose a new one.</p>
              </div>
              <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
                <div>
                  <label htmlFor="current-password" className="mb-1 block text-sm font-medium text-gray-700">Current password</label>
                  <input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    disabled={isSaving}
                    className="w-full rounded-lg border border-gray-300 p-2"
                  />
                </div>
                <div>
                  <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-gray-700">New password</label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={72}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    disabled={isSaving}
                    className="w-full rounded-lg border border-gray-300 p-2"
                  />
                </div>
                <div>
                  <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-gray-700">Re-enter new password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={72}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    disabled={isSaving}
                    className="w-full rounded-lg border border-gray-300 p-2"
                  />
                </div>
                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                {success && <p role="status" className="text-sm text-green-700">{success}</p>}
                <div className="border-t border-gray-100 pt-4">
                  <button type="submit" disabled={isSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    {isSaving ? 'Saving…' : 'Save password'}
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}

function AdminPage({ currentUsername }: { currentUsername: string }) {
  const [selectedSection, setSelectedSection] = useState<'users' | 'boards'>('users');
  const [managingBoard, setManagingBoard] = useState<AdminBoard | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [boards, setBoards] = useState<AdminBoard[]>([]);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [boardsError, setBoardsError] = useState('');
  const [isBoardsLoading, setIsBoardsLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAdminUsers()
      .then((loadedUsers) => {
        if (!cancelled) setUsers(loadedUsers);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load users');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAdminBoards()
      .then((loadedBoards) => {
        if (!cancelled) setBoards(loadedBoards);
      })
      .catch((err: unknown) => {
        if (!cancelled) setBoardsError(err instanceof Error ? err.message : 'Failed to load boards');
      })
      .finally(() => {
        if (!cancelled) setIsBoardsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setIsSaving(true);
    try {
      const newUser = await createUser({ username, email, password });
      setUsers((currentUsers) => [...currentUsers, newUser].sort((left, right) =>
        left.full_name.localeCompare(right.full_name) || left.username.localeCompare(right.username)
      ));
      setUsername('');
      setEmail('');
      setPassword('');
      setSuccess(`User ${newUser.username} created.`);
      getAdminBoards()
        .then(setBoards)
        .catch((err: unknown) => setBoardsError(err instanceof Error ? err.message : 'Failed to load boards'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePromoteUser = async (user: AdminUser) => {
    setError('');
    setSuccess('');
    setIsSaving(true);
    try {
      const updatedUser = await promoteUserToAdmin(user.username);
      setUsers((currentUsers) => currentUsers.map((currentUser) =>
        currentUser.username === updatedUser.username ? updatedUser : currentUser
      ));
      setSuccess(`${updatedUser.username} is now an administrator.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote user');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section aria-label="Admin" className="mx-auto w-full max-w-7xl">
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Admin sections" className="rounded-xl bg-white p-2 shadow-sm">
          <button
            type="button"
            aria-current={selectedSection === 'users' ? 'page' : undefined}
            onClick={() => setSelectedSection('users')}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${selectedSection === 'users' ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            User management
          </button>
          <button
            type="button"
            aria-current={selectedSection === 'boards' ? 'page' : undefined}
            onClick={() => setSelectedSection('boards')}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${selectedSection === 'boards' ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            Board management
          </button>
        </nav>
        <div className="min-w-0 rounded-xl bg-white p-6 shadow-sm">
      {selectedSection === 'users' ? (
      <section aria-labelledby="user-management-title" className="space-y-4">
        <h2 id="user-management-title" className="text-xl font-bold text-gray-800">User management</h2>
        <section aria-labelledby="create-user-title" className="rounded-xl bg-white p-6 shadow-sm">
          <h3 id="create-user-title" className="mb-4 text-lg font-bold text-gray-800">Create user</h3>
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="admin-username" className="mb-1 block text-sm font-medium text-gray-700">Username</label>
              <input id="admin-username" required minLength={1} maxLength={32} pattern="[A-Za-z0-9]+" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={isSaving} className="w-full rounded-lg border border-gray-300 p-2" />
            </div>
            <div>
              <label htmlFor="admin-email" className="mb-1 block text-sm font-medium text-gray-700">Email address</label>
              <input id="admin-email" type="email" required maxLength={255} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={isSaving} className="w-full rounded-lg border border-gray-300 p-2" />
            </div>
            <div>
              <label htmlFor="admin-password" className="mb-1 block text-sm font-medium text-gray-700">Password</label>
              <input id="admin-password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={isSaving} className="w-full rounded-lg border border-gray-300 p-2" />
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={isSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {isSaving ? 'Saving…' : 'Create user'}
              </button>
            </div>
          </form>
        </section>

        <section aria-labelledby="manage-users-title" className="rounded-xl bg-white p-6 shadow-sm">
        <h2 id="manage-users-title" className="mb-4 text-lg font-bold text-gray-800">Manage users</h2>
        {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
        {success && <p role="status" className="mb-3 text-sm text-green-700">{success}</p>}
        {isLoading ? (
          <p className="text-sm text-gray-600">Loading users…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th scope="col" className="px-3 py-2 font-medium">Username</th>
                  <th scope="col" className="px-3 py-2 font-medium">Email</th>
                  <th scope="col" className="px-3 py-2 font-medium">Role</th>
                  <th scope="col" className="px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.username} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-3 font-medium text-gray-800">{user.username}</td>
                    <td className="px-3 py-3 text-gray-600">{user.email}</td>
                    <td className="px-3 py-3 capitalize text-gray-600">{user.role}</td>
                    <td className="px-3 py-3">
                      {user.role === 'user' && user.username !== currentUsername ? (
                        <button type="button" disabled={isSaving} onClick={() => void handlePromoteUser(user)} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                          Make admin
                        </button>
                      ) : user.username === currentUsername ? (
                        <span className="text-xs text-gray-500">You</span>
                      ) : (
                        <span className="text-xs text-gray-500">Administrator</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </section>
      </section>
      ) : (
      <section aria-labelledby="manage-boards-title" className="space-y-4">
        <h2 id="manage-boards-title" className="text-xl font-bold text-gray-800">Board management</h2>
        <section aria-label="All boards" className="rounded-xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-bold text-gray-800">All boards</h3>
          {boardsError && <p role="alert" className="mb-3 text-sm text-red-700">{boardsError}</p>}
          {isBoardsLoading ? (
            <p className="text-sm text-gray-600">Loading boards…</p>
          ) : boards.length === 0 ? (
            <p className="text-sm text-gray-600">No boards found.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {boards.map((board) => (
                <li key={board.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800">{board.title}</p>
                    <p className="mt-1 text-sm text-gray-500">Owned by {board.owner_name} ({board.owner_id})</p>
                  </div>
                  <button type="button" aria-label={`Manage ${board.title}`} onClick={() => setManagingBoard(board)} className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                    Manage
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
      )}
      {managingBoard && (
        <ManageBoardOverlay
          board={managingBoard}
          users={users.map((user) => ({ id: user.username, full_name: user.full_name }))}
          onClose={() => setManagingBoard(null)}
          onDeleteBoard={async (board) => {
            await persistDeleteBoard(board.id);
            setBoards((current) => current.filter((item) => item.id !== board.id));
          }}
        />
      )}
        </div>
      </div>
    </section>
  );
}

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
        <div className="mt-auto flex flex-col items-center gap-2">
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
            <div className="relative">
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

  return <AuthenticatedBoard tasks={tasks} setTasks={setTasks} onLoggedOut={() => setIsAuthenticated(false)} />;
}