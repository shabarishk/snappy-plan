export type TaskPriority = 'Low' | 'Medium' | 'High';

const PRIORITY_RANK: Record<TaskPriority, number> = { High: 0, Medium: 1, Low: 2 };

export function sortTasksByPriority<T extends { priority: TaskPriority }>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}
