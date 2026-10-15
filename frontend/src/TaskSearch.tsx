import { useEffect, useMemo, useRef, useState } from 'react';
import { getTasks } from './api';
import type { Board } from './api';
import type { Task } from './taskModel';
import { toBoardTask } from './taskModel';

type SearchTask = {
  task: Task;
  boardId: string;
  boardTitle: string;
};

export function TaskSearch({
  boards,
  onSelectTask,
}: {
  boards: Board[];
  onSelectTask: (task: Task, boardId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState<SearchTask[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const isRequesting = useRef(false);
  const hasLoadedTasks = useRef(false);
  const loadedBoardIds = useRef('');

  const loadTasks = (refresh = false) => {
    const boardIds = boards.map((board) => board.id).join(',');
    if (loadedBoardIds.current !== boardIds) hasLoadedTasks.current = false;
    if (isRequesting.current || (hasLoadedTasks.current && !refresh)) return;
    isRequesting.current = true;
    setIsLoading(true);
    setError('');
    Promise.all(boards.map(async (board) => ({
      board,
      tasks: await getTasks(board.id),
    })))
      .then((boardTasks) => {
        setTasks(boardTasks.flatMap(({ board, tasks: boardTasksForBoard }) =>
          boardTasksForBoard.map((task) => ({
            task: toBoardTask(task),
            boardId: board.id,
            boardTitle: board.title,
          }))
        ));
        hasLoadedTasks.current = true;
        loadedBoardIds.current = boardIds;
      })
      .catch((err: unknown) => {
        hasLoadedTasks.current = false;
        setError(err instanceof Error ? err.message : 'Failed to search tasks');
      })
      .finally(() => {
        isRequesting.current = false;
        setIsLoading(false);
      });
  };

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  const matchingTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return [];
    return tasks.filter(({ task }) =>
      task.title.toLocaleLowerCase().includes(normalizedQuery)
      || task.description?.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [query, tasks]);

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <label htmlFor="task-search" className="sr-only">Search tasks</label>
      <input
        id="task-search"
        type="search"
        role="searchbox"
        autoComplete="off"
        placeholder="Search tasks…"
        value={query}
        onFocus={() => {
          setIsOpen(true);
          loadTasks(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          loadTasks();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setIsOpen(false);
        }}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
      />
      {isOpen && (
        <div role="listbox" aria-label="Task search results" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {isLoading ? (
            <p role="status" className="px-3 py-2 text-sm text-gray-500">Searching tasks…</p>
          ) : error ? (
            <div className="px-3 py-2">
              <p role="alert" className="text-sm text-red-700">{error}</p>
              <button type="button" onClick={() => loadTasks(true)} className="mt-2 text-sm font-medium text-blue-700 hover:underline">Retry search</button>
            </div>
          ) : !query.trim() ? (
            <p className="px-3 py-2 text-sm text-gray-500">Type to search tasks across your boards.</p>
          ) : matchingTasks.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">No matching tasks found.</p>
          ) : matchingTasks.map(({ task, boardId, boardTitle }) => (
            <button
              key={`${boardId}-${task.id}`}
              type="button"
              role="option"
              aria-label={`${task.title} — ${boardTitle}`}
              onClick={() => {
                onSelectTask(task, boardId);
                setQuery('');
                setIsOpen(false);
              }}
              className="block w-full px-3 py-2 text-left hover:bg-blue-50"
            >
              <span className="block truncate text-sm font-medium text-gray-800">{task.title}</span>
              <span className="block truncate text-xs text-gray-500">{boardTitle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
