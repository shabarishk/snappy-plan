import { useEffect, useState } from 'react';
import type { TaskPriority } from './taskPriority';
import { addTaskToInitiative, createTask as persistTask, getInitiatives, removeTaskFromInitiative, updateTask as persistUpdateTask } from './api';
import type { ApiTask, Board, Initiative, TaskAssignee } from './api';
import type { Task, TaskState } from './taskModel';
import { toBoardTask } from './taskModel';

function InitiativePicker({
  id,
  value,
  initiatives,
  boardInitiatives,
  disabled,
  onValueChange,
  onSelect,
  onBlur,
}: {
  id: string;
  value: string;
  initiatives: Initiative[];
  boardInitiatives: Initiative[];
  disabled?: boolean;
  onValueChange: (value: string) => void;
  onSelect: (initiative: Initiative) => void;
  onBlur?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasTyped, setHasTyped] = useState(false);
  const matchingInitiatives = hasTyped && value.trim()
    ? initiatives.filter((initiative) =>
      initiative.title.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()))
    : boardInitiatives;

  return (
    <div className="relative">
      <input
        id={id}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={`${id}-options`}
        autoComplete="off"
        placeholder="Search initiatives…"
        value={value}
        onClick={(event) => {
          event.currentTarget.select();
          setHasTyped(false);
          setIsOpen(true);
        }}
        onFocus={(event) => {
          event.currentTarget.select();
          setHasTyped(false);
          setIsOpen(true);
        }}
        onChange={(event) => {
          onValueChange(event.target.value);
          setHasTyped(true);
          setIsOpen(true);
        }}
        onBlur={() => {
          onBlur?.();
          setIsOpen(false);
        }}
        disabled={disabled}
        className="w-full rounded-lg border border-gray-300 p-2"
      />
      {isOpen && (
        <ul
          id={`${id}-options`}
          role="listbox"
          aria-label="Matching initiatives"
          className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {matchingInitiatives.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">
              {value.trim() ? 'No matching initiatives found.' : 'No initiatives linked to this board.'}
            </li>
          ) : matchingInitiatives.map((initiative) => (
            <li key={initiative.id}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(initiative);
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50"
              >
                {initiative.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CreateTaskOverlay({
  boards,
  selectedBoardId,
  assignees,
  currentUserId,
  boardInitiatives,
  onClose,
  onCreated,
}: {
  boards: Board[];
  selectedBoardId: string;
  assignees: TaskAssignee[];
  currentUserId: string;
  boardInitiatives: Record<string, Initiative[]>;
  onClose: () => void;
  onCreated: (task: Task, boardId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [boardId, setBoardId] = useState(selectedBoardId);
  const [assignedToId, setAssignedToId] = useState('');
  const [initiativeId, setInitiativeId] = useState('');
  const [initiativeSearch, setInitiativeSearch] = useState('');
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
            <InitiativePicker
              id="task-initiative"
              value={initiativeSearch}
              initiatives={initiatives}
              boardInitiatives={boardInitiatives[boardId] ?? []}
              disabled={Boolean(initiativeLoadError)}
              onValueChange={(value) => {
                setInitiativeSearch(value);
                setInitiativeId('');
              }}
              onSelect={(initiative) => {
                setInitiativeSearch(initiative.title);
                setInitiativeId(initiative.id);
              }}
            />
            {initiativeLoadError && <p role="alert" className="mt-1 text-sm text-red-700">Failed to load initiatives: {initiativeLoadError}</p>}
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
  boardInitiatives,
  linkedInitiatives,
  selectedBoardId,
  onClose,
  onSaved,
  onInitiativesChanged,
}: {
  task: Task;
  boards: Board[];
  assignees: TaskAssignee[];
  initiatives: Initiative[];
  boardInitiatives: Initiative[];
  linkedInitiatives: Initiative[];
  selectedBoardId: string;
  onClose: () => void;
  onSaved: (task: Task, boardId: string) => void;
  onInitiativesChanged: (initiatives: Initiative[]) => void;
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
  const initialInitiativeId = linkedInitiatives[0]?.id ?? '';
  const initialInitiativeTitle = linkedInitiatives[0]?.title ?? '';
  const [initiativeSearchDraft, setInitiativeSearchDraft] = useState<string | null>(null);
  const [initiativeIdDraft, setInitiativeIdDraft] = useState<string | null>(null);
  const initiativeSearch = initiativeSearchDraft ?? initialInitiativeTitle;
  const initiativeId = initiativeIdDraft ?? initialInitiativeId;
  const initiativeChanged = initiativeIdDraft !== null
    && (initiativeIdDraft !== initialInitiativeId || linkedInitiatives.length > 1);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const hasUnselectedSearch = Boolean(initiativeSearch.trim())
        && initiativeSearchDraft !== null
        && initiativeIdDraft === null;
      const nextInitiativeId = hasUnselectedSearch ? initialInitiativeId : initiativeId;
      const shouldUpdateInitiative = initiativeChanged && !hasUnselectedSearch;
      if (hasUnselectedSearch) {
        setInitiativeIdDraft(null);
        setInitiativeSearchDraft(null);
      }

      const updated = await persistUpdateTask(task.id, {
        board_id: boardId,
        title,
        description,
        priority,
        state,
        assigned_to_id: assignedToId,
        complete_by: completeBy ? new Date(completeBy).toISOString() : null,
      });
      if (shouldUpdateInitiative) {
        const selectedInitiative = nextInitiativeId
          ? initiatives.find((initiative) => initiative.id === nextInitiativeId)
            ?? linkedInitiatives.find((initiative) => initiative.id === nextInitiativeId)
          : undefined;
        if (nextInitiativeId && !selectedInitiative) {
          throw new Error('The selected initiative is no longer available.');
        }
        if (selectedInitiative && !linkedInitiatives.some((initiative) => initiative.id === selectedInitiative.id)) {
          await addTaskToInitiative(selectedInitiative.id, task.id);
        }
        for (const initiative of linkedInitiatives) {
          if (initiative.id !== nextInitiativeId) {
            await removeTaskFromInitiative(initiative.id, task.id);
          }
        }
        onInitiativesChanged(selectedInitiative ? [selectedInitiative] : []);
      }
      onSaved(toBoardTask(updated), boardId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    } finally {
      setSaving(false);
    }
  };

  const availableInitiatives = initiatives.filter((initiative) =>
    !linkedInitiatives.some((linked) => linked.id === initiative.id));

  const handleInitiativeSelect = (initiative: Initiative) => {
    setInitiativeIdDraft(initiative.id);
    setInitiativeSearchDraft(initiative.title);
  };

  const handleInitiativeBlur = () => {
    if (!initiativeSearch.trim()) {
      setInitiativeSearchDraft('');
      return;
    }
    if (initiativeIdDraft !== null) return;
    setInitiativeIdDraft(null);
    setInitiativeSearchDraft(null);
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
            <InitiativePicker
              id="task-initiative-search"
              value={initiativeSearch}
              initiatives={availableInitiatives}
              boardInitiatives={boardInitiatives}
              onValueChange={(value) => {
                setInitiativeSearchDraft(value);
                setInitiativeIdDraft(value.trim() ? null : '');
              }}
              onSelect={handleInitiativeSelect}
              onBlur={handleInitiativeBlur}
            />
            {initiatives.length === 0 && <p className="mt-1 text-sm text-gray-500">No initiatives available.</p>}
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