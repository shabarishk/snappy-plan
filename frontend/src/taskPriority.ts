export type TaskPriority = 'Low' | 'Medium' | 'High';

const PRIORITY_RANK: Record<TaskPriority, number> = { High: 0, Medium: 1, Low: 2 };

export function sortTasksByPriority<T extends { priority: TaskPriority }>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}

export function sortTasksByCompleteByAndPriority<
  T extends { completeBy?: string | null; priority: TaskPriority },
>(tasks: readonly T[]): T[] {
  return [...tasks].sort((left, right) => {
    const leftDueDate = left.completeBy ? Date.parse(left.completeBy) : Number.NaN;
    const rightDueDate = right.completeBy ? Date.parse(right.completeBy) : Number.NaN;
    const leftHasDueDate = Number.isFinite(leftDueDate);
    const rightHasDueDate = Number.isFinite(rightDueDate);

    if (leftHasDueDate && rightHasDueDate && leftDueDate !== rightDueDate) {
      return leftDueDate - rightDueDate;
    }
    if (leftHasDueDate !== rightHasDueDate) return leftHasDueDate ? -1 : 1;
    return PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  });
}
