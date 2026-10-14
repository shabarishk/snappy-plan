import { useState } from 'react';
import type { TaskPriority } from './taskPriority';
import { createTask as persistTask, updateTask as persistUpdateTask } from './api';
import type { Board, TaskAssignee } from './api';
import type { Task, TaskState } from './taskModel';
import { toBoardTask } from './taskModel';

export function CreateTaskOverlay({
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

export function TaskDetailsOverlay({
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