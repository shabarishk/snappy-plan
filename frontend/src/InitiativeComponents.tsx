import { useEffect, useState } from 'react';
import {
  addTaskToInitiative,
  createInitiative,
  getInitiative,
  getInitiatives,
  getTasks,
  removeTaskFromInitiative,
  updateInitiative,
} from './api';
import type { ApiTask, Initiative, InitiativeRequest, TaskAssignee } from './api';

function dateForInput(date: string | null): string {
  return date ? date.slice(0, 10) : '';
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, { timeZone: 'UTC' });
}

function InitiativeForm({
  initial,
  users,
  submitLabel,
  className = 'space-y-4 rounded-xl border border-gray-200 bg-white p-5',
  onSubmit,
  onCancel,
}: {
  initial?: Initiative;
  users: TaskAssignee[];
  submitLabel: string;
  className?: string;
  onSubmit: (request: InitiativeRequest) => Promise<void>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [completeBy, setCompleteBy] = useState(dateForInput(initial?.complete_by ?? null));
  const [assignedToID, setAssignedToID] = useState(initial?.assigned_to_id ?? '');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSaving(true);
    try {
      await onSubmit({
        title,
        description,
        complete_by: completeBy || null,
        assigned_to_id: assignedToID,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save initiative');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className={className}>
      <div>
        <label htmlFor="initiative-title" className="mb-1 block text-sm font-medium text-gray-700">Title</label>
        <input id="initiative-title" required maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2" />
      </div>
      <div>
        <label htmlFor="initiative-description" className="mb-1 block text-sm font-medium text-gray-700">Description</label>
        <textarea id="initiative-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="initiative-complete-by" className="mb-1 block text-sm font-medium text-gray-700">Complete by</label>
          <input id="initiative-complete-by" type="date" value={completeBy} onChange={(event) => setCompleteBy(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2" />
        </div>
        <div>
          <label htmlFor="initiative-assignee" className="mb-1 block text-sm font-medium text-gray-700">Assigned to</label>
          <select id="initiative-assignee" value={assignedToID} onChange={(event) => setAssignedToID(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white p-2">
            <option value="">Unassigned</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.full_name}</option>)}
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-3">
        {onCancel && <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>}
        <button type="submit" disabled={isSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {isSaving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function CreateInitiativeOverlay({
  users,
  onClose,
  onCreated,
  isPage = false,
}: {
  users: TaskAssignee[];
  onClose: () => void;
  onCreated: (initiative: Initiative) => void;
  isPage?: boolean;
}) {
  return (
    <div className={isPage ? 'creation-page' : 'fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4'}>
      <section
        role={isPage ? 'region' : 'dialog'}
        aria-modal={isPage ? undefined : 'true'}
        aria-labelledby="create-initiative-title"
        className={isPage
          ? 'creation-page-content w-full rounded-xl bg-white p-5 shadow-sm sm:p-6'
          : 'w-full max-w-lg rounded-xl bg-white p-6 shadow-xl'}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="create-initiative-title" className="text-xl font-bold text-gray-800">Create initiative</h2>
          <button type="button" aria-label={isPage ? 'Back from create initiative form' : 'Close create initiative form'} onClick={onClose} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100">{isPage ? 'Back' : '×'}</button>
        </div>
        <InitiativeForm
          users={users}
          submitLabel="Create initiative"
          className="space-y-4"
          onCancel={onClose}
          onSubmit={async (request) => onCreated(await createInitiative(request))}
        />
      </section>
    </div>
  );
}

export function InitiativesPage({
  onOpenInitiative,
  onCreateInitiative,
  refreshToken,
}: {
  onOpenInitiative: (initiative: Initiative) => void;
  onCreateInitiative: () => void;
  refreshToken: number;
}) {
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getInitiatives()
      .then((loaded) => { if (!cancelled) setInitiatives(loaded); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load initiatives');
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [refreshToken]);

  return (
    <section aria-labelledby="initiatives-title" className="initiatives-page mx-auto flex h-full w-full max-w-3xl flex-col">
      <header className="initiatives-page-header mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 id="initiatives-title" className="text-2xl font-bold text-gray-900">Your initiatives</h2>
          <p className="mt-1 text-sm text-gray-600">Group related tasks and track their progress.</p>
        </div>
        <button type="button" onClick={onCreateInitiative} className="mobile-secondary-create shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          + New initiative
        </button>
      </header>
      {error && <p role="alert" className="mb-3 rounded bg-red-100 p-3 text-sm text-red-700">{error}</p>}
      <ul aria-label="Initiatives" className="min-h-0 flex-1 overflow-y-auto divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
        {isLoading ? (
          <li className="px-5 py-8 text-center text-sm text-gray-500">Loading initiatives…</li>
        ) : initiatives.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-gray-500">No initiatives yet. Create one to start tracking a group of tasks.</li>
        ) : initiatives.map((initiative) => {
          const total = initiative.task_count ?? 0;
          const completed = initiative.completed_task_count ?? 0;
          const progress = total ? Math.round(completed / total * 100) : 0;
          return (
            <li key={initiative.id}>
              <button type="button" onClick={() => onOpenInitiative(initiative)} className="block w-full px-5 py-4 text-left hover:bg-gray-50">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-gray-900">{initiative.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-gray-600">{initiative.description || 'No description'}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-blue-700">{progress}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>{completed} of {total} tasks complete</span>
                  {initiative.assigned_to_name && <span>Assigned to {initiative.assigned_to_name}</span>}
                  {initiative.complete_by && <span>Due {formatDate(initiative.complete_by)}</span>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function InitiativeDetailPage({
  initiativeId,
  users,
  onBack,
  onTitleChanged,
}: {
  initiativeId: string;
  users: TaskAssignee[];
  onBack: () => void;
  onTitleChanged: (title: string) => void;
}) {
  const [initiative, setInitiative] = useState<Initiative | null>(null);
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [availableTasks, setAvailableTasks] = useState<ApiTask[]>([]);
  const [taskSearch, setTaskSearch] = useState('');
  const [taskToAdd, setTaskToAdd] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getInitiative(initiativeId), getTasks()])
      .then(([detail, allTasks]) => {
        if (cancelled) return;
        setInitiative(detail.initiative);
        setTasks(detail.tasks);
        setAvailableTasks(allTasks.filter((task) => !detail.tasks.some((linked) => linked.id === task.id)));
        onTitleChanged(detail.initiative.title);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load initiative');
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [initiativeId, onTitleChanged]);

  const submitUpdate = async (request: InitiativeRequest) => {
    const updated = await updateInitiative(initiativeId, request);
    setInitiative(updated);
    onTitleChanged(updated.title);
    setIsEditing(false);
  };

  const addTask = async () => {
    if (!taskToAdd) return;
    setError('');
    setIsAdding(true);
    try {
      await addTaskToInitiative(initiativeId, taskToAdd);
      const added = availableTasks.find((task) => task.id === taskToAdd);
      if (added) setTasks((current) => [...current, added]);
      setAvailableTasks((current) => current.filter((task) => task.id !== taskToAdd));
      setTaskToAdd('');
      setTaskSearch('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add task');
    } finally {
      setIsAdding(false);
    }
  };

  const removeTask = async (task: ApiTask) => {
    setError('');
    try {
      await removeTaskFromInitiative(initiativeId, task.id);
      setTasks((current) => current.filter((linked) => linked.id !== task.id));
      setAvailableTasks((current) => [...current, task]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove task');
    }
  };

  if (isLoading) return <p className="p-4 text-sm text-gray-600">Loading initiative…</p>;
  if (error && !initiative) return <p role="alert" className="p-4 text-sm text-red-700">{error}</p>;
  if (!initiative) return <p role="alert" className="p-4 text-sm text-red-700">Initiative could not be found.</p>;

  const matchingTasks = taskSearch.trim()
    ? availableTasks.filter((task) =>
      task.title.toLocaleLowerCase().includes(taskSearch.trim().toLocaleLowerCase()))
    : [];

  return (
    <section aria-labelledby="initiative-detail-title" className="initiative-detail-page mx-auto h-full w-full max-w-4xl overflow-y-auto">
      <button type="button" onClick={onBack} className="mb-4 rounded-lg px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">← All initiatives</button>
      {error && <p role="alert" className="mb-3 rounded bg-red-100 p-3 text-sm text-red-700">{error}</p>}
      {isEditing ? (
        <div className="mb-6">
          <h2 className="mb-3 text-xl font-bold text-gray-900">Edit initiative</h2>
          <InitiativeForm
            initial={initiative}
            users={users}
            submitLabel="Save changes"
            onCancel={() => setIsEditing(false)}
            onSubmit={submitUpdate}
          />
        </div>
      ) : (
        <header className="initiative-detail-header mb-6 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="initiative-detail-title" className="text-2xl font-bold text-gray-900">{initiative.title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{initiative.description || 'No description'}</p>
            </div>
            <button type="button" onClick={() => setIsEditing(true)} className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Edit initiative</button>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-500">
            <span>Assigned to {users.find((user) => user.id === initiative.assigned_to_id)?.full_name ?? 'Unassigned'}</span>
            <span>Due {initiative.complete_by ? formatDate(initiative.complete_by) : 'No date set'}</span>
          </div>
        </header>
      )}
      <section aria-labelledby="initiative-tasks-title" className="rounded-xl border border-gray-200 bg-white">
        <div className="initiative-task-tools flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-5">
          <div>
            <h3 id="initiative-tasks-title" className="font-semibold text-gray-900">Tasks</h3>
            <p className="text-sm text-gray-500">{tasks.filter((task) => task.state === 'Complete').length} of {tasks.length} complete</p>
          </div>
          <div className="flex w-full max-w-xl items-start gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1">
              <label htmlFor="initiative-task-search" className="sr-only">Search tasks to add</label>
              <input
                id="initiative-task-search"
                type="search"
                autoComplete="off"
                placeholder="Search existing tasks…"
                value={taskSearch}
                onChange={(event) => {
                  setTaskSearch(event.target.value);
                  setTaskToAdd('');
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              />
              {taskSearch.trim() && (
                <ul aria-label="Matching tasks" className="absolute left-0 right-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {matchingTasks.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-gray-500">No matching tasks found.</li>
                  ) : matchingTasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        aria-pressed={taskToAdd === task.id}
                        onClick={() => setTaskToAdd(task.id)}
                        className={`block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${taskToAdd === task.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                      >
                        {task.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" disabled={!taskToAdd || isAdding} onClick={() => void addTask()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {isAdding ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </div>
        <ul aria-label="Initiative tasks" className="divide-y divide-gray-100">
          {tasks.length === 0 ? (
            <li className="px-5 py-8 text-center text-sm text-gray-500">No tasks in this initiative yet. Choose an existing task above to add it.</li>
          ) : tasks.map((task) => (
            <li key={task.id} className="initiative-task-item flex items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{task.title}</p>
                <p className="text-sm text-gray-500">{task.state} · {task.priority}</p>
              </div>
              <button type="button" onClick={() => void removeTask(task)} className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">Remove</button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
