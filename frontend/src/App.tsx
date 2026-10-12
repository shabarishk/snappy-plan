import { useCallback, useEffect, useState } from 'react';
import {
  DndContext, DragOverlay, closestCorners, KeyboardSensor, PointerSensor,
  useSensor, useSensors, useDraggable, useDroppable, type DragStartEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { AuthWrapper } from './Auth';
import { sortTasksByPriority, type TaskPriority } from './taskPriority';
import { createTask as persistTask, getTaskAssignees, getTasks, type ApiTask, type TaskAssignee } from './api';

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

// --- Sub-Components ---
function TaskCard({ task, onMoveToTodo }: { task: Task; onMoveToTodo?: (taskId: string) => void }) {
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
}: {
  column: ColumnType;
  tasks: Task[];
  onMoveToTodo?: (taskId: string) => void;
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
          <TaskCard key={task.id} task={task} onMoveToTodo={onMoveToTodo} />
        ))}
      </div>
    </div>
    </>
  );
}

export function AuthenticatedBoard({
  tasks,
  setTasks,
}: {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
}) {
  const [currentPage, setCurrentPage] = useState<'board' | 'backlog'>('board');
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getTasks(), getTaskAssignees()])
      .then(([savedTasks, availableAssignees]) => {
        if (cancelled) return;
        setTasks(savedTasks.map(toBoardTask));
        setAssignees(availableAssignees);
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

  const onDragEnd = () => {
    setActiveTask(null);
  };

  const moveBacklogTaskToTodo = (taskId: string) => {
    setTasks((previous) => previous.map((task) =>
      task.id === taskId ? moveTaskToColumn(task, 'todo') : task
    ));
  };

  return (
    <div className="h-screen bg-gray-200 font-sans flex flex-col">
      <header className="bg-white p-4 shadow-sm z-10 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-extrabold text-blue-600 tracking-tight">Snappy Plan</h1>
          <button type="button" disabled={isLoading || Boolean(loadError)} onClick={() => setIsCreateTaskOpen(true)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            Create task
          </button>
        </div>
        <nav aria-label="Main navigation" className="flex items-center gap-2">
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
        </nav>
        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">S</div>
      </header>
      {isCreateTaskOpen && (
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

      {/* Main content area takes up remaining height */}
      <main className="board-main flex-1 p-4">
        {loadError && <p role="alert" className="mb-3 rounded bg-red-100 p-3 text-sm text-red-700">{loadError}</p>}
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
      </main>
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