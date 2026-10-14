import type { TaskPriority } from './taskPriority';
import type { ApiTask } from './api';

export // --- Types ---
type TaskState = 'Backlog' | 'ToDo' | 'InProgress' | 'Complete';

export type ColumnId = 'backlog' | 'todo' | 'in-progress' | 'complete';

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

export type ColumnType = { id: ColumnId; title: string };

export const COLUMNS: ColumnType[] = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'todo', title: 'To Do' },
  { id: 'in-progress', title: 'In Progress' },
  { id: 'complete', title: 'Complete' },
];

export const BOARD_COLUMNS = COLUMNS.filter((column) => column.id !== 'backlog');

export const COLUMN_STATES: Record<ColumnId, TaskState> = {
  backlog: 'Backlog',
  todo: 'ToDo',
  'in-progress': 'InProgress',
  complete: 'Complete',
};

export function toBoardTask(task: ApiTask): Task {
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

export function moveTaskToColumn(task: Task, columnId: ColumnId): Task {
  if (task.columnId === columnId) return task;
  return {
    ...task,
    columnId,
    state: COLUMN_STATES[columnId],
    completedAt: columnId === 'complete' ? task.completedAt ?? new Date().toISOString() : null,
  };
}