import { DndContext, DragOverlay, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import type { Board } from './api';
import type { AppPage } from './navigation';
import type { ColumnType, Task } from './taskModel';
import { BOARD_COLUMNS, COLUMNS } from './taskModel';
import { Column } from './TaskBoard';
import { isAllSelected } from './taskFilterUtils';
import type { FilterOption, FilterSelection } from './taskFilterUtils';

export type TaskGroupBy = 'board' | 'initiative' | 'assignee';

export type TaskGroup = {
  id: string;
  title: string;
  tasks: Task[];
  boardId?: string;
};

type BoardTaskColumnsProps = {
  currentPage: AppPage;
  isMobileLayout: boolean;
  filteredTasks: Task[];
  taskGroups: TaskGroup[];
  visibleColumns: ColumnType[];
  boards: Board[];
  boardFilterOptions: FilterOption[];
  boardFilterIds: FilterSelection;
  groupBy: TaskGroupBy;
  isSavingBoardOrder: boolean;
  activeTask: Task | null;
  selectedBoardId: string;
  onMoveBoard: (boardId: string, direction: -1 | 1) => void;
  onMoveBacklogTaskToTodo: (taskId: string) => void;
  onSelectTask: (task: Task, boardId: string) => void;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
};

export function BoardTaskColumns({
  currentPage,
  isMobileLayout,
  filteredTasks,
  taskGroups,
  visibleColumns,
  boards,
  boardFilterOptions,
  boardFilterIds,
  groupBy,
  isSavingBoardOrder,
  activeTask,
  selectedBoardId,
  onMoveBoard,
  onMoveBacklogTaskToTodo,
  onSelectTask,
  onDragStart,
  onDragEnd,
}: BoardTaskColumnsProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );
  const isBacklog = currentPage === 'backlog';
  const moveBacklogTask = isBacklog ? onMoveBacklogTaskToTodo : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {isMobileLayout ? (
        <div
          role="region"
          aria-label={isBacklog ? 'Mobile backlog tasks' : 'Mobile active task sections'}
          className="mobile-task-columns pb-4"
        >
          {(isBacklog ? COLUMNS.filter((column) => column.id === 'backlog') : BOARD_COLUMNS).map((column) => (
            <Column
              key={`mobile-${column.id}`}
              column={column}
              tasks={filteredTasks.filter((task) => task.columnId === column.id)}
              onMoveToTodo={moveBacklogTask}
              onSelectTask={(task) => onSelectTask(task, task.boardId ?? selectedBoardId)}
              droppableId={`mobile:${column.id}`}
              taskIdPrefix="mobile"
              sortByCompleteBy={isBacklog}
              disableDrag={isMobileLayout}
            />
          ))}
        </div>
      ) : (
        <div role="region" aria-label={isBacklog ? 'Backlog tasks' : 'Kanban board columns'} className="space-y-6 pb-4">
          {taskGroups.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No tasks to display.</p>
          ) : taskGroups.map((group) => {
            const boardId = group.boardId;
            const groupTasks = isBacklog
              ? group.tasks.filter((task) => task.columnId === 'backlog')
              : group.tasks;
            return (
              <section key={group.id} aria-label={`${group.title} tasks`} className="space-y-2">
                <header className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-gray-800">{group.title}</h2>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{groupTasks.length} tasks</span>
                    {currentPage === 'board' && groupBy === 'board' && isAllSelected(boardFilterOptions, boardFilterIds) && boardId && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Move ${group.title} up`}
                          title="Move board up"
                          disabled={isSavingBoardOrder || boards[0]?.id === boardId}
                          onClick={() => onMoveBoard(boardId, -1)}
                          className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-200 disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${group.title} down`}
                          title="Move board down"
                          disabled={isSavingBoardOrder || boards[boards.length - 1]?.id === boardId}
                          onClick={() => onMoveBoard(boardId, 1)}
                          className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-200 disabled:opacity-40"
                        >
                          ↓
                        </button>
                      </div>
                    )}
                  </div>
                </header>
                <div className={`grid items-start gap-4 ${isBacklog ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'}`}>
                  {visibleColumns.map((column) => (
                    <Column
                      key={`${group.id}-${column.id}`}
                      column={column}
                      tasks={groupTasks.filter((task) => task.columnId === column.id)}
                      onMoveToTodo={moveBacklogTask}
                      onSelectTask={(task) => onSelectTask(task, task.boardId ?? selectedBoardId)}
                      droppableId={`${group.id}:${column.id}`}
                      taskIdPrefix={group.id}
                      hideColumnTitle={isBacklog}
                      sortByCompleteBy={isBacklog}
                      disableDrag={isMobileLayout}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <DragOverlay>
        {activeTask ? (
          <div className="bg-white p-4 rounded-lg shadow-2xl border-2 border-blue-400 rotate-2 opacity-90 cursor-grabbing">
            <p className="text-gray-800 text-sm font-medium">{activeTask.title}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
