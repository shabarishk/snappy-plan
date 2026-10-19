import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { sortTasksByCompleteByAndPriority, sortTasksByPriority } from './taskPriority';
import type { ColumnType, Task } from './taskModel';

// --- Sub-Components ---
function PriorityIcon({ priority }: { priority: Task['priority'] }) {
  const colorClass = priority === 'High'
    ? 'text-red-600'
    : priority === 'Medium'
      ? 'text-yellow-500'
      : 'text-blue-600';

  return (
    <span role="img" aria-label={`${priority} priority`} className={`inline-flex ${colorClass}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        {priority === 'Medium' ? (
          <path d="M5 8h14M5 16h14" />
        ) : priority === 'High' ? (
          <path d="M12 19V5m-6 6 6-6 6 6" />
        ) : (
          <path d="M12 5v14m6-6-6 6-6-6" />
        )}
      </svg>
    </span>
  );
}

function TaskCard({
  task,
  onMoveToTodo,
  onSelect,
  draggableId,
  disableDrag,
  boardName,
  initiativeNames,
  showBoardName,
  showInitiativeNames,
}: {
  task: Task;
  onMoveToTodo?: (taskId: string) => void;
  onSelect: (task: Task) => void;
  draggableId?: string;
  disableDrag?: boolean;
  boardName?: string;
  initiativeNames: string[];
  showBoardName: boolean;
  showInitiativeNames: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId ?? task.id,
    data: { type: 'Task', task },
    disabled: disableDrag,
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
      className={`task-card mb-3 rounded-lg border border-gray-100 bg-white p-4 shadow-sm hover:shadow-md ${
        disableDrag ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing touch-manipulation'
      } transition-shadow`}
    >
      <p className="text-gray-800 text-sm font-medium">{task.title}</p>
      {showBoardName && boardName && (
        <div className="mt-1">
          <span title={boardName} className="inline-block max-w-full truncate rounded-sm border border-gray-300 bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
            {boardName}
          </span>
        </div>
      )}
      {showInitiativeNames && initiativeNames.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">{initiativeNames.join(', ')}</p>
      )}
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
      <div className="mt-1 flex justify-end">
        <PriorityIcon priority={task.priority} />
      </div>
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
  disableDrag,
  boardNamesById,
  initiativeNamesByTaskId,
  selectedBoardId,
  showBoardName,
  showInitiativeNames,
}: {
  column: ColumnType;
  tasks: Task[];
  onMoveToTodo?: (taskId: string) => void;
  onSelectTask: (task: Task) => void;
  droppableId?: string;
  taskIdPrefix?: string;
  hideColumnTitle?: boolean;
  sortByCompleteBy?: boolean;
  disableDrag?: boolean;
  boardNamesById?: ReadonlyMap<string, string>;
  initiativeNamesByTaskId?: ReadonlyMap<string, string[]>;
  selectedBoardId?: string;
  showBoardName?: boolean;
  showInitiativeNames?: boolean;
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
            disableDrag={disableDrag}
            boardName={boardNamesById?.get(task.boardId ?? selectedBoardId ?? '')}
            initiativeNames={initiativeNamesByTaskId?.get(task.id) ?? []}
            showBoardName={showBoardName ?? false}
            showInitiativeNames={showInitiativeNames ?? false}
          />
        ))}
      </div>
    </div>
    </>
  );
}