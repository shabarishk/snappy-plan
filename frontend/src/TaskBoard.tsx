import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { sortTasksByCompleteByAndPriority, sortTasksByPriority } from './taskPriority';
import type { ColumnType, Task } from './taskModel';

// --- Sub-Components ---
function TaskCard({
  task,
  onMoveToTodo,
  onSelect,
  draggableId,
}: {
  task: Task;
  onMoveToTodo?: (taskId: string) => void;
  onSelect: (task: Task) => void;
  draggableId?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId ?? task.id,
    data: { type: 'Task', task },
  });

  const style = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    opacity: isDragging ? 0 : 1,
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

export function Column({
  column,
  tasks,
  onMoveToTodo,
  onSelectTask,
  droppableId,
  taskIdPrefix,
  hideColumnTitle,
  sortByCompleteBy,
}: {
  column: ColumnType;
  tasks: Task[];
  onMoveToTodo?: (taskId: string) => void;
  onSelectTask: (task: Task) => void;
  droppableId?: string;
  taskIdPrefix?: string;
  hideColumnTitle?: boolean;
  sortByCompleteBy?: boolean;
}) {
  const { setNodeRef } = useDroppable({
    id: droppableId ?? column.id,
    data: { type: 'Column', columnId: column.id },
  });

  return (
    <>
    {/* Columns stack and scroll with the page on mobile, then fill desktop grid cells. */}
    <div ref={setNodeRef} className="board-column bg-gray-50 flex flex-col rounded-xl max-h-full border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-200 bg-gray-100">
      {!hideColumnTitle && <h3 className="text-sm text-gray-500">{column.title}</h3>}
        <span className="text-xs text-gray-400">{tasks.length} tasks</span>
      </div>
      
      <div className="board-column-tasks flex-1 p-3 overflow-y-auto">
        {(sortByCompleteBy ? sortTasksByCompleteByAndPriority(tasks) : sortTasksByPriority(tasks)).map((task) => (
          <TaskCard
            key={taskIdPrefix ? `${taskIdPrefix}:${task.id}` : task.id}
            task={task}
            onMoveToTodo={onMoveToTodo}
            onSelect={onSelectTask}
            draggableId={taskIdPrefix ? `${taskIdPrefix}:${task.id}` : undefined}
          />
        ))}
      </div>
    </div>
    </>
  );
}