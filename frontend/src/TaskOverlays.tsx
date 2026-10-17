import { useEffect, useState } from 'react';
import type { TaskPriority } from './taskPriority';
import { addTaskToInitiative, createTask as persistTask, getInitiatives, updateTask as persistUpdateTask } from './api';
import type { ApiTask, Board, Initiative, TaskAssignee } from './api';
import type { Task, TaskState } from './taskModel';
import { toBoardTask } from './taskModel';

export function CreateTaskOverlay({
  boards,
  selectedBoardId,
  assignees,
  currentUserId,
  onClose,
  onCreated,
}: {
  boards: Board[];
  selectedBoardId: string;
  assignees: TaskAssignee[];
  currentUserId: string;
  onClose: () => void;
  onCreated: (task: Task, boardId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [boardId, setBoardId] = useState(selectedBoardId);
  const [assignedToId, setAssignedToId] = useState('');
  const [initiativeId, setInitiativeId] = useState('');
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [initiativeLoadError, setInitiativeLoadError] = useState('');
  const [createdTask, setCreatedTask] = useState<ApiTask | null>(null);
  const [state, setState] = useState<'Backlog' | 'ToDo'>('Backlog');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [completeBy, setCompleteBy] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmUnassigned, setConfirmUnassigned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getInitiatives()
      .then((availableInitiatives) => {
        if (!cancelled) setInitiatives(availableInitiatives);
      })
      .catch((err: unknown) => {
        if (!cancelled) setInitiativeLoadError(err instanceof Error ? err.message : 'Failed to load initiatives');
      });
    return () => { cancelled = true; };
  }, []);

  const createTask = async (assigneeId: string) => {
    setSaving(true);
    setError('');
    let taskWasCreated = false;
    try {
      let task = createdTask;
      if (!task) {
        task = await persistTask({
          board_id: boardId,
          title,
          description,
          assigned_to_id: assigneeId,
          state,
          priority,
          complete_by: completeBy ? new Date(completeBy).toISOString() : null,
        });
        taskWasCreated = true;
        setCreatedTask(task);
      }
      if (initiativeId) await addTaskToInitiative(initiativeId, task.id);
      onCreated(toBoardTask(task), boardId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create task';
      setError(taskWasCreated || createdTask
        ? `Task created, but it could not be assigned to the initiative. Try again. ${message}`
        : message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createdTask && !assignedToId) {
      setConfirmUnassigned(true);
      return;
    }
    void createTask(assignedToId);
  };

  const handleAssignToMe = () => {
    if (!currentUserId) {
      setError('Could not determine your account. Please try again.');
      return;
    }
    setAssignedToId(currentUserId);
    setConfirmUnassigned(false);
    void createTask(currentUserId);
  };

  const handleLeaveUnassigned = () => {
    setAssignedToId('');
    setConfirmUnassigned(false);
    void createTask('');
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
            <input id="task-title" name="title" required maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} disabled={Boolean(createdTask)} className="w-full rounded-lg border border-gray-300 p-2" />
          </div>
          <div>
            <label htmlFor="task-description" className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <textarea id="task-description" name="description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} disabled={Boolean(createdTask)} className="w-full rounded-lg border border-gray-300 p-2" />
          </div>
          <div>
            <label htmlFor="task-board" className="mb-1 block text-sm font-medium text-gray-700">Board</label>
            <select id="task-board" name="board_id" required value={boardId} onChange={(event) => setBoardId(event.target.value)} disabled={Boolean(createdTask)} className="w-full rounded-lg border border-gray-300 p-2">
              <option value="" disabled>Select a board</option>
              {boards.map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="task-assignee" className="mb-1 block text-sm font-medium text-gray-700">Assigned to</label>
            <select id="task-assignee" name="assigned_to_id" value={assignedToId} onChange={(event) => setAssignedToId(event.target.value)} disabled={Boolean(createdTask)} className="w-full rounded-lg border border-gray-300 p-2">
              <option value="">Unassigned</option>
              {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.full_name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="task-initiative" className="mb-1 block text-sm font-medium text-gray-700">Initiative</label>
            <select
              id="task-initiative"
              name="initiative_id"
              value={initiativeId}
              onChange={(event) => setInitiativeId(event.target.value)}
              disabled={Boolean(initiativeLoadError) || initiatives.length === 0}
              className="w-full rounded-lg border border-gray-300 p-2"
            >
              <option value="">No initiative</option>
              {initiatives.map((initiative) => <option key={initiative.id} value={initiative.id}>{initiative.title}</option>)}
            </select>
            {initiativeLoadError && <p role="alert" className="mt-1 text-sm text-red-700">Failed to load initiatives: {initiativeLoadError}</p>}
            {!initiativeLoadError && initiatives.length === 0 && <p className="mt-1 text-sm text-gray-500">No initiatives available.</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="task-state" className="mb-1 block text-sm font-medium text-gray-700">Current state</label>
              <select id="task-state" name="state" value={state} onChange={(event) => setState(event.target.value as 'Backlog' | 'ToDo')} disabled={Boolean(createdTask)} className="w-full rounded-lg border border-gray-300 p-2">
                <option value="Backlog">Backlog</option>
                <option value="ToDo">ToDo</option>
              </select>
            </div>
            <div>
              <label htmlFor="task-priority" className="mb-1 block text-sm font-medium text-gray-700">Priority</label>
              <select id="task-priority" name="priority" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} disabled={Boolean(createdTask)} className="w-full rounded-lg border border-gray-300 p-2">
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>
            <div>
              <label htmlFor="task-complete-by" className="mb-1 block text-sm font-medium text-gray-700">Complete by</label>
              <input id="task-complete-by" name="complete_by" type="datetime-local" value={completeBy} onChange={(event) => setCompleteBy(event.target.value)} disabled={Boolean(createdTask)} className="w-full rounded-lg border border-gray-300 p-2" />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={saving || boards.length === 0} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? (createdTask ? 'Assigning…' : 'Creating…') : (createdTask ? 'Retry initiative assignment' : 'Confirm Task')}
            </button>
          </div>
        </form>
      </section>
      {confirmUnassigned && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-unassigned-title"
            aria-describedby="confirm-unassigned-description"
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 id="confirm-unassigned-title" className="text-lg font-bold text-gray-800">Create task without an assignee?</h2>
            <p id="confirm-unassigned-description" className="mt-2 text-sm text-gray-600">Choose whether to assign this task to yourself or leave it unassigned.</p>
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
            <div className="mt-5 flex flex-col-reverse justify-end gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleLeaveUnassigned}
                disabled={saving}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Leave Task Unassigned
              </button>
              <button
                type="button"
                onClick={handleAssignToMe}
                disabled={saving}
                autoFocus
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Assign Task to me
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export function TaskDetailsOverlay({
  task,
  boards,
  assignees,
  initiatives,
  linkedInitiatives,
  selectedBoardId,
  onClose,
  onSaved,
  onInitiativeAssigned,
}: {
  task: Task;
  boards: Board[];
  assignees: TaskAssignee[];
  initiatives: Initiative[];
  linkedInitiatives: Initiative[];
  selectedBoardId: string;
  onClose: () => void;
  onSaved: (task: Task, boardId: string) => void;
  onInitiativeAssigned: (initiative: Initiative) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [boardId, setBoardId] = useState(selectedBoardId);
  const [assignedToId, setAssignedToId] = useState(task.assignedToId ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [state, setState] = useState<TaskState>(task.state);
  const [completeBy, setCompleteBy] = useState(() => {
    if (!task.completeBy) return '';
    const date = new Date(task.completeBy);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [initiativeSearch, setInitiativeSearch] = useState('');
  const [showInitiativeOptions, setShowInitiativeOptions] = useState(false);
  const [initiativeError, setInitiativeError] = useState('');
  const [isAssigningInitiative, setIsAssigningInitiative] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const updated = await persistUpdateTask(task.id, {
        board_id: boardId,
        title,
        description,
        priority,
        state,
        assigned_to_id: assignedToId,
        complete_by: completeBy ? new Date(completeBy).toISOString() : null,
      });
      onSaved(toBoardTask(updated), boardId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    } finally {
      setSaving(false);
    }
  };

  const matchingInitiatives = initiativeSearch.trim()
    ? initiatives.filter((initiative) =>
      !linkedInitiatives.some((linked) => linked.id === initiative.id)
      && initiative.title.toLocaleLowerCase().includes(initiativeSearch.trim().toLocaleLowerCase()))
    : [];

  const handleAssignInitiative = async (initiative: Initiative) => {
    setInitiativeError('');
    setIsAssigningInitiative(true);
    try {
      await addTaskToInitiative(initiative.id, task.id);
      onInitiativeAssigned(initiative);
      setInitiativeSearch(initiative.title);
      setShowInitiativeOptions(false);
    } catch (err) {
      setInitiativeError(err instanceof Error ? err.message : 'Failed to assign initiative');
    } finally {
      setIsAssigningInitiative(false);
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
          <div>
            <label htmlFor="edit-task-board" className="mb-1 block text-sm font-medium text-gray-700">Board</label>
            <select id="edit-task-board" required value={boardId} onChange={(event) => setBoardId(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2">
              {boards.map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="edit-task-assignee" className="mb-1 block text-sm font-medium text-gray-700">Assigned to</label>
            <select id="edit-task-assignee" value={assignedToId} onChange={(event) => setAssignedToId(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2">
              <option value="">Unassigned</option>
              {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.full_name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="task-initiative-search" className="mb-1 block text-sm font-medium text-gray-700">Initiatives</label>
            <div className="relative">
              <input
                id="task-initiative-search"
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showInitiativeOptions && Boolean(initiativeSearch.trim())}
                aria-controls="task-initiative-options"
                autoComplete="off"
                placeholder="Search initiatives…"
                value={initiativeSearch}
                onFocus={() => setShowInitiativeOptions(true)}
                onChange={(event) => {
                  setInitiativeSearch(event.target.value);
                  setShowInitiativeOptions(true);
                  setInitiativeError('');
                }}
                disabled={isAssigningInitiative}
                className="w-full rounded-lg border border-gray-300 p-2"
              />
              {showInitiativeOptions && initiativeSearch.trim() && (
                <ul
                  id="task-initiative-options"
                  role="listbox"
                  aria-label="Matching initiatives"
                  className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                >
                  {matchingInitiatives.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-gray-500">No matching initiatives found.</li>
                  ) : matchingInitiatives.map((initiative) => (
                    <li key={initiative.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        disabled={isAssigningInitiative}
                        onClick={() => void handleAssignInitiative(initiative)}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {initiative.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {linkedInitiatives.length > 0 && (
              <p className="mt-1 text-sm text-gray-600">
                Assigned to: {linkedInitiatives.map((initiative) => initiative.title).join(', ')}
              </p>
            )}
            {initiatives.length === 0 && <p className="mt-1 text-sm text-gray-500">No initiatives available.</p>}
            {initiativeError && <p role="alert" className="mt-1 text-sm text-red-700">{initiativeError}</p>}
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