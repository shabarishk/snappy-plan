import { useEffect, useState } from 'react';
import { createBoard as persistCreateBoard, getBoardMembers, updateBoardMembers } from './api';
import type { Board, TaskAssignee } from './api';

export function CreateBoardOverlay({
  users,
  onClose,
  onCreated,
}: {
  users: TaskAssignee[];
  onClose: () => void;
  onCreated: (board: Board) => void;
}) {
  const [title, setTitle] = useState('');
  const [userIds, setUserIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSaving(true);
    try {
      onCreated(await persistCreateBoard(title, userIds));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create board');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="create-board-title" className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="create-board-title" className="text-xl font-bold text-gray-800">Create a new board</h2>
          <button type="button" aria-label="Close create board form" onClick={onClose} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-board-title" className="mb-1 block text-sm font-medium text-gray-700">Board name</label>
            <input id="new-board-title" required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-gray-300 p-2" />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-gray-700">Users who can access this board</legend>
            {users.length === 0 ? <p className="text-sm text-gray-500">No other users are available.</p> : users.map((user) => (
              <label key={user.id} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={userIds.includes(user.id)}
                  onChange={(event) => setUserIds((current) => event.target.checked
                    ? [...current, user.id]
                    : current.filter((id) => id !== user.id))}
                />
                {user.full_name} ({user.id})
              </label>
            ))}
          </fieldset>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={isSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {isSaving ? 'Creating…' : 'Create board'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ManageBoardOverlay({
  board,
  users,
  onClose,
  onDeleteBoard,
}: {
  board: Board;
  users: TaskAssignee[];
  onClose: () => void;
  onDeleteBoard: (board: Board) => Promise<void>;
}) {
  const [userIds, setUserIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getBoardMembers(board.id)
      .then((ids) => { if (!cancelled) setUserIds(ids); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load board access'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [board.id]);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSaving(true);
    try {
      await updateBoardMembers(board.id, userIds);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update board access');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    setError('');
    setIsDeleting(true);
    try {
      await onDeleteBoard(board);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete board');
      setIsConfirmingDelete(false);
      setIsDeleting(false);
    }
  };

  const selectableUsers = users.filter((user) => user.id !== board.owner_id);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="manage-board-title" className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="manage-board-title" className="text-xl font-bold text-gray-800">Manage {board.title}</h2>
          <button type="button" aria-label="Close manage board form" onClick={onClose} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100">×</button>
        </div>
        <form onSubmit={handleSave} className="space-y-4">
          <fieldset className="max-h-64 space-y-2 overflow-y-auto">
            <legend className="mb-1 text-sm font-medium text-gray-700">Users who can access this board</legend>
            {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : selectableUsers.length === 0 ? <p className="text-sm text-gray-500">No other users are available.</p> : selectableUsers.map((user) => (
              <label key={user.id} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={userIds.includes(user.id)}
                  onChange={(event) => setUserIds((current) => event.target.checked
                    ? [...current, user.id]
                    : current.filter((id) => id !== user.id))}
                />
                {user.full_name} ({user.id})
              </label>
            ))}
          </fieldset>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={isLoading || isSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {isSaving ? 'Saving…' : 'Save access'}
            </button>
          </div>
        </form>
        <div className="mt-6 border-t border-gray-200 pt-4">
          <button type="button" onClick={() => setIsConfirmingDelete(true)} className="rounded-lg px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
            Delete board
          </button>
        </div>
        {isConfirmingDelete && (
          <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
            <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-delete-title" className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
              <h3 id="confirm-delete-title" className="text-lg font-bold text-gray-800">This option will delete the board</h3>
              <div className="mt-5 flex justify-end gap-3">
                <button type="button" onClick={() => setIsConfirmingDelete(false)} disabled={isDeleting} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
                <button type="button" onClick={() => void handleConfirmDelete()} disabled={isDeleting} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                  {isDeleting ? 'Deleting…' : 'Confirm'}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

export function BoardsPage({
  boards,
  users,
  username,
  onOpenBoard,
  onCreateBoard,
  onDeleteBoard,
}: {
  boards: Board[];
  users: TaskAssignee[];
  username: string;
  onOpenBoard: (board: Board) => void;
  onCreateBoard: () => void;
  onDeleteBoard: (board: Board) => Promise<void>;
}) {
  const [managingBoard, setManagingBoard] = useState<Board | null>(null);

  return (
    <section aria-labelledby="boards-title" className="mx-auto flex h-full max-w-3xl flex-col">
      <header className="mb-6">
        <h2 id="boards-title" className="text-2xl font-bold text-gray-900">Your boards</h2>
        <p className="mt-1 text-sm text-gray-600">Manage your boards and the boards shared with you.</p>
      </header>
      <ul aria-label="Boards" className="min-h-0 flex-1 overflow-y-auto divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
        {boards.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-gray-500">You don't have any boards yet. Create one below to get started.</li>
        ) : boards.map((board) => {
          const isOwner = board.owner_id === username;
          return (
            <li key={board.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-gray-900">{board.title}</h3>
                <p className="text-sm text-gray-500">{isOwner ? 'Created by you' : 'Shared with you'}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => onOpenBoard(board)} className="rounded-lg px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
                  Open board
                </button>
                {isOwner && (
                  <button
                    type="button"
                    aria-label={`Manage ${board.title}`}
                    onClick={() => setManagingBoard(board)}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                  >
                    Manage
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto border-t border-gray-200 pt-5">
        <button type="button" onClick={onCreateBoard} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700">
          + Create new board
        </button>
      </div>
      {managingBoard && (
        <ManageBoardOverlay
          board={managingBoard}
          users={users}
          onClose={() => setManagingBoard(null)}
          onDeleteBoard={onDeleteBoard}
        />
      )}
    </section>
  );
}