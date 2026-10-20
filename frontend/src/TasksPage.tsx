import { useMemo, useState } from 'react';
import type { Board, Initiative, TaskAssignee } from './api';
import type { Task } from './taskModel';

type PageSize = 25 | 50 | 100;

const TASK_STATE_ORDER: Record<Task['state'], number> = {
  InProgress: 0,
  ToDo: 1,
  Backlog: 2,
  Complete: 3,
};

const TASK_STATE_LABELS: Record<Task['state'], string> = {
  InProgress: 'In Progress',
  ToDo: 'To Do',
  Backlog: 'Backlog',
  Complete: 'Complete',
};

export function TasksPage({
  tasks,
  boards,
  initiatives,
  assignees,
  taskInitiatives,
  isLoading,
  isMobileLayout,
  loadError,
  isInitiativeLoading,
  initiativeError,
  onRetryInitiatives,
  onSelectTask,
}: {
  tasks: Task[];
  boards: Board[];
  initiatives: Initiative[];
  assignees: TaskAssignee[];
  taskInitiatives: Record<string, Initiative[]>;
  isLoading: boolean;
  isMobileLayout: boolean;
  loadError: string;
  isInitiativeLoading: boolean;
  initiativeError: string;
  onRetryInitiatives: () => void;
  onSelectTask: (task: Task) => void;
}) {
  const [stateFilter, setStateFilter] = useState('');
  const [boardFilter, setBoardFilter] = useState('');
  const [initiativeFilter, setInitiativeFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  const filteredTasks = useMemo(() => tasks
    .filter((task) => !stateFilter || task.state === stateFilter)
    .filter((task) => !boardFilter || task.boardId === boardFilter)
    .filter((task) => !initiativeFilter
      || (taskInitiatives[task.id] ?? []).some((initiative) => initiative.id === initiativeFilter))
    .filter((task) => assigneeFilter === 'all'
      || (assigneeFilter === 'unassigned'
        ? !task.assignedToId
        : task.assignedToId === assigneeFilter.slice('assignee:'.length)))
    .sort((left, right) => TASK_STATE_ORDER[left.state] - TASK_STATE_ORDER[right.state]),
  [assigneeFilter, boardFilter, initiativeFilter, stateFilter, taskInitiatives, tasks]);

  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const visiblePage = Math.min(currentPage, pageCount);
  const firstTaskIndex = (visiblePage - 1) * pageSize;
  const pageTasks = filteredTasks.slice(firstTaskIndex, firstTaskIndex + pageSize);

  const resetPage = () => setCurrentPage(1);
  const rangeStart = filteredTasks.length === 0 ? 0 : firstTaskIndex + 1;
  const rangeEnd = firstTaskIndex + pageTasks.length;
  const activeFilterCount = Number(Boolean(stateFilter))
    + Number(Boolean(boardFilter))
    + Number(Boolean(initiativeFilter))
    + Number(assigneeFilter !== 'all');

  const filterControls = (
    <>
      <label className="tasks-filter-field flex items-center gap-2 text-sm font-medium text-gray-700">
        <span>State</span>
        <select
          aria-label="Filter by state"
          value={stateFilter}
          onChange={(event) => {
            setStateFilter(event.target.value);
            resetPage();
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2"
        >
          <option value="">All states</option>
          <option value="InProgress">In Progress</option>
          <option value="ToDo">To Do</option>
          <option value="Backlog">Backlog</option>
          <option value="Complete">Complete</option>
        </select>
      </label>
      <label className="tasks-filter-field flex items-center gap-2 text-sm font-medium text-gray-700">
        <span>Board</span>
        <select
          aria-label="Filter by board"
          value={boardFilter}
          onChange={(event) => {
            setBoardFilter(event.target.value);
            resetPage();
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2"
        >
          <option value="">All boards</option>
          {boards.map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}
        </select>
      </label>
      <label className="tasks-filter-field flex items-center gap-2 text-sm font-medium text-gray-700">
        <span>Initiative</span>
        <select
          aria-label="Filter by initiative"
          value={initiativeFilter}
          disabled={isInitiativeLoading || Boolean(initiativeError)}
          onChange={(event) => {
            setInitiativeFilter(event.target.value);
            resetPage();
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 disabled:opacity-60"
        >
          <option value="">All initiatives</option>
          {initiatives.map((initiative) => (
            <option key={initiative.id} value={initiative.id}>{initiative.title}</option>
          ))}
        </select>
      </label>
      <label className="tasks-filter-field flex items-center gap-2 text-sm font-medium text-gray-700">
        <span>Assignee</span>
        <select
          aria-label="Filter by assignee"
          value={assigneeFilter}
          onChange={(event) => {
            setAssigneeFilter(event.target.value);
            resetPage();
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2"
        >
          <option value="all">All assignees</option>
          <option value="unassigned">Unassigned</option>
          {assignees.map((assignee) => (
            <option key={assignee.id} value={`assignee:${assignee.id}`}>{assignee.full_name}</option>
          ))}
        </select>
      </label>
    </>
  );

  return (
    <section aria-labelledby="tasks-page-title" className="tasks-page mx-auto w-full max-w-7xl space-y-4">
      <div className="tasks-page-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="tasks-page-title" className="text-2xl font-bold text-gray-900">All tasks</h2>
          <p className="text-sm text-gray-500">{filteredTasks.length} tasks</p>
        </div>
        <div className="tasks-page-header-controls flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <span>Tasks per page</span>
            <select
              aria-label="Tasks per page"
              value={pageSize}
              onChange={(event) => {
                const requestedSize = Number(event.target.value);
                if (requestedSize === 25 || requestedSize === 50 || requestedSize === 100) {
                  setPageSize(requestedSize);
                  resetPage();
                }
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
          {isMobileLayout && (
            <button
              type="button"
              aria-label="Open filters"
              aria-haspopup="dialog"
              aria-expanded={isMobileFiltersOpen}
              onClick={() => setIsMobileFiltersOpen(true)}
              className="mobile-filter-trigger relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M7 12h10m-7 5h4" />
                <circle cx="8" cy="7" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="11" cy="17" r="1.5" fill="currentColor" stroke="none" />
              </svg>
              {activeFilterCount > 0 && (
                <span aria-label={`${activeFilterCount} active filters`} className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[0.65rem] font-semibold leading-none text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {!isMobileLayout && <div className="tasks-page-filters flex flex-wrap items-center gap-3">{filterControls}</div>}
      {isMobileLayout && (
        <>
          <button
            type="button"
            aria-label="Close task filters"
            aria-hidden={!isMobileFiltersOpen}
            disabled={!isMobileFiltersOpen}
            className={`mobile-filter-backdrop ${isMobileFiltersOpen ? 'mobile-filter-backdrop-open' : ''}`}
            onClick={() => setIsMobileFiltersOpen(false)}
          />
          <section
            role={isMobileFiltersOpen ? 'dialog' : undefined}
            aria-modal={isMobileFiltersOpen ? 'true' : undefined}
            aria-hidden={!isMobileFiltersOpen}
            inert={!isMobileFiltersOpen}
            aria-label="Task filters"
            className={`mobile-filter-panel ${isMobileFiltersOpen ? 'mobile-filter-panel-open' : ''}`}
          >
            <header className="flex items-center justify-between border-b border-gray-200 px-4 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
              <button
                type="button"
                aria-label="Close filters"
                onClick={() => setIsMobileFiltersOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>
            <div className="tasks-page-filter-controls space-y-4 p-4">{filterControls}</div>
          </section>
        </>
      )}

      {loadError && <p role="alert" className="rounded bg-red-100 p-3 text-sm text-red-700">{loadError}</p>}
      {initiativeError && (
        <div className="flex items-center gap-3 rounded bg-red-100 p-3 text-sm text-red-700">
          <p role="alert">{initiativeError}</p>
          <button type="button" onClick={onRetryInitiatives} className="font-medium underline">Retry</button>
        </div>
      )}

      {isMobileLayout ? (
        <ul aria-label="Tasks" className="tasks-mobile-list">
          {isLoading ? (
            <li role="status" className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">Loading tasks…</li>
          ) : pageTasks.length === 0 ? (
            <li className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">No tasks to display.</li>
          ) : pageTasks.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => onSelectTask(task)}
                className="task-list-mobile-card w-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 flex-1 font-semibold text-gray-900">{task.title}</span>
                  <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{TASK_STATE_LABELS[task.state]}</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{task.priority} priority</p>
                <div className="task-list-mobile-metadata mt-3 grid grid-cols-1 gap-1 text-xs text-gray-600">
                  <span>Board · {boards.find((board) => board.id === task.boardId)?.title ?? 'Unknown board'}</span>
                  <span>Initiative · {(taskInitiatives[task.id] ?? []).map((initiative) => initiative.title).join(', ') || 'None'}</span>
                  <span>Assignee · {assignees.find((assignee) => assignee.id === task.assignedToId)?.full_name ?? (task.assignedToId || 'Unassigned')}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-3">Task</th>
              <th scope="col" className="px-4 py-3">State</th>
              <th scope="col" className="px-4 py-3">Board</th>
              <th scope="col" className="px-4 py-3">Initiative</th>
              <th scope="col" className="px-4 py-3">Assignee</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={5} role="status" className="px-4 py-10 text-center text-gray-500">Loading tasks…</td></tr>
            ) : pageTasks.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">No tasks to display.</td></tr>
            ) : pageTasks.map((task) => (
              <tr key={task.id} className="hover:bg-gray-50">
                <td className="max-w-sm px-4 py-3">
                  <button type="button" onClick={() => onSelectTask(task)} className="block max-w-full truncate text-left font-medium text-blue-700 hover:underline">
                    {task.title}
                  </button>
                  <p className="mt-1 truncate text-xs text-gray-500">{task.priority} priority</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-700">{TASK_STATE_LABELS[task.state]}</td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                  {boards.find((board) => board.id === task.boardId)?.title ?? 'Unknown board'}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {(taskInitiatives[task.id] ?? []).map((initiative) => initiative.title).join(', ') || 'No initiative'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                  {assignees.find((assignee) => assignee.id === task.assignedToId)?.full_name ?? (task.assignedToId || 'Unassigned')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <div className="tasks-page-pagination flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
        <p aria-live="polite">
          Showing {rangeStart}–{rangeEnd} of {filteredTasks.length} tasks
        </p>
        <div className="flex items-center gap-3">
          <span>Page {visiblePage} of {pageCount}</span>
          <button
            type="button"
            aria-label="Previous page"
            disabled={visiblePage <= 1 || isLoading}
            onClick={() => setCurrentPage(Math.max(1, visiblePage - 1))}
            className="rounded-lg border border-gray-300 px-3 py-2 font-medium disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            aria-label="Next page"
            disabled={visiblePage >= pageCount || isLoading}
            onClick={() => setCurrentPage(Math.min(pageCount, visiblePage + 1))}
            className="rounded-lg border border-gray-300 px-3 py-2 font-medium disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
