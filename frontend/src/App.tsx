import { useCallback, useState } from 'react';
import {
  DndContext, DragOverlay, closestCorners, KeyboardSensor, PointerSensor,
  useSensor, useSensors, useDraggable, useDroppable, type DragStartEvent, type DragOverEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { AuthWrapper } from './Auth';
import { sortTasksByPriority, type TaskPriority } from './taskPriority';

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
        <h1 className="text-xl font-extrabold text-blue-600 tracking-tight">Snappy Plan</h1>
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

      {/* Main content area takes up remaining height */}
      <main className="board-main flex-1 p-4">
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