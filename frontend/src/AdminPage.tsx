import { useEffect, useState } from 'react';
import { createUser, deleteAdminUser, deleteBoard as persistDeleteBoard, getAdminBoards, getAdminUsers, promoteUserToAdmin } from './api';
import type { AdminBoard, AdminUser } from './api';
import { ManageBoardOverlay } from './BoardComponents';

export function AdminPage({ currentUsername }: { currentUsername: string }) {
  const [selectedSection, setSelectedSection] = useState<'users' | 'boards'>('users');
  const [managingBoard, setManagingBoard] = useState<AdminBoard | null>(null);
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [boards, setBoards] = useState<AdminBoard[]>([]);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [createUserError, setCreateUserError] = useState('');
  const [deleteUserError, setDeleteUserError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [boardsError, setBoardsError] = useState('');
  const [isBoardsLoading, setIsBoardsLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAdminUsers()
      .then((loadedUsers) => {
        if (!cancelled) setUsers(loadedUsers);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load users');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAdminBoards()
      .then((loadedBoards) => {
        if (!cancelled) setBoards(loadedBoards);
      })
      .catch((err: unknown) => {
        if (!cancelled) setBoardsError(err instanceof Error ? err.message : 'Failed to load boards');
      })
      .finally(() => {
        if (!cancelled) setIsBoardsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const closeCreateUser = () => {
    setIsCreateUserOpen(false);
    setUsername('');
    setFullName('');
    setPreferredName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setCreateUserError('');
  };

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateUserError('');
    if (password !== confirmPassword) {
      setCreateUserError('Passwords do not match.');
      return;
    }
    setError('');
    setSuccess('');
    setIsSaving(true);
    try {
      const newUser = await createUser({ username, full_name: fullName, preferred_name: preferredName, email, password });
      setUsers((currentUsers) => [...currentUsers, newUser].sort((left, right) =>
        left.full_name.localeCompare(right.full_name) || left.username.localeCompare(right.username)
      ));
      setUsername('');
      setFullName('');
      setPreferredName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setSuccess(`User ${newUser.username} created.`);
      setIsCreateUserOpen(false);
      getAdminBoards()
        .then(setBoards)
        .catch((err: unknown) => setBoardsError(err instanceof Error ? err.message : 'Failed to load boards'));
    } catch (err) {
      setCreateUserError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePromoteUser = async (user: AdminUser) => {
    setError('');
    setSuccess('');
    setIsSaving(true);
    try {
      const updatedUser = await promoteUserToAdmin(user.username);
      setUsers((currentUsers) => currentUsers.map((currentUser) =>
        currentUser.username === updatedUser.username ? updatedUser : currentUser
      ));
      setSuccess(`${updatedUser.username} is now an administrator.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote user');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete || isDeletingUser) return;
    setDeleteUserError('');
    setIsDeletingUser(true);
    try {
      await deleteAdminUser(userToDelete.username);
      setUsers((currentUsers) => currentUsers.filter((user) => user.username !== userToDelete.username));
      setSuccess(`User ${userToDelete.username} deleted. Their remaining boards are now yours.`);
      setUserToDelete(null);
      setBoardsError('');
      getAdminBoards()
        .then(setBoards)
        .catch((err: unknown) => setBoardsError(err instanceof Error ? err.message : 'Failed to load boards'));
    } catch (err) {
      setDeleteUserError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setIsDeletingUser(false);
    }
  };

  return (
    <section aria-label="Admin" className="admin-page mx-auto w-full max-w-7xl">
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Admin sections" className="admin-section-nav rounded-xl bg-white p-2 shadow-sm">
          <button
            type="button"
            aria-current={selectedSection === 'users' ? 'page' : undefined}
            onClick={() => setSelectedSection('users')}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${selectedSection === 'users' ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            User management
          </button>
          <button
            type="button"
            aria-current={selectedSection === 'boards' ? 'page' : undefined}
            onClick={() => setSelectedSection('boards')}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${selectedSection === 'boards' ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            Board management
          </button>
        </nav>
        <div className="admin-content min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      {selectedSection === 'users' ? (
      <section aria-labelledby="user-management-title" className="space-y-4">
        <div className="admin-section-header flex items-center justify-between gap-4">
          <h2 id="user-management-title" className="text-xl font-bold text-gray-800">User management</h2>
          <button type="button" onClick={() => setIsCreateUserOpen(true)} className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            + New user
          </button>
        </div>

        <section aria-labelledby="manage-users-title" className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
        <h2 id="manage-users-title" className="mb-4 text-lg font-bold text-gray-800">Manage users</h2>
        {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
        {success && <p role="status" className="mb-3 text-sm text-green-700">{success}</p>}
        {isLoading ? (
          <p className="text-sm text-gray-600">Loading users…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th scope="col" className="px-3 py-2 font-medium">Username</th>
                  <th scope="col" className="px-3 py-2 font-medium">Email</th>
                  <th scope="col" className="px-3 py-2 font-medium">Role</th>
                  <th scope="col" className="px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.username} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-3 font-medium text-gray-800">{user.username}</td>
                    <td className="px-3 py-3 text-gray-600">{user.email}</td>
                    <td className="px-3 py-3 capitalize text-gray-600">{user.role}</td>
                    <td className="px-3 py-3">
                      {user.role === 'user' && user.username !== currentUsername ? (
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={isSaving || isDeletingUser} onClick={() => void handlePromoteUser(user)} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                            Make admin
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete user ${user.username}`}
                            disabled={isSaving || isDeletingUser}
                            onClick={() => {
                              setDeleteUserError('');
                              setUserToDelete(user);
                            }}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      ) : user.username === currentUsername ? (
                        <span className="text-xs text-gray-500">You</span>
                      ) : (
                        <span className="text-xs text-gray-500">Administrator</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </section>
        {isCreateUserOpen && (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
            <section role="dialog" aria-modal="true" aria-labelledby="create-user-title" className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl sm:p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 id="create-user-title" className="text-xl font-bold text-gray-800">Create user</h2>
                <button type="button" aria-label="Close create user form" onClick={closeCreateUser} disabled={isSaving} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50">×</button>
              </div>
              <form onSubmit={handleCreateUser} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="admin-username" className="mb-1 block text-sm font-medium text-gray-700">Username</label>
                  <input id="admin-username" required minLength={1} maxLength={32} pattern="[A-Za-z0-9]+" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={isSaving} className="w-full rounded-lg border border-gray-300 p-2" />
                </div>
                <div>
                  <label htmlFor="admin-full-name" className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
                  <input id="admin-full-name" required maxLength={100} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={isSaving} className="w-full rounded-lg border border-gray-300 p-2" />
                </div>
                <div>
                  <label htmlFor="admin-preferred-name" className="mb-1 block text-sm font-medium text-gray-700">Preferred name</label>
                  <input id="admin-preferred-name" maxLength={100} autoComplete="nickname" value={preferredName} onChange={(event) => setPreferredName(event.target.value)} disabled={isSaving} className="w-full rounded-lg border border-gray-300 p-2" />
                </div>
                <div>
                  <label htmlFor="admin-email" className="mb-1 block text-sm font-medium text-gray-700">Email address</label>
                  <input id="admin-email" type="email" required maxLength={255} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={isSaving} className="w-full rounded-lg border border-gray-300 p-2" />
                </div>
                <div>
                  <label htmlFor="admin-password" className="mb-1 block text-sm font-medium text-gray-700">Password</label>
                  <input id="admin-password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={isSaving} className="w-full rounded-lg border border-gray-300 p-2" />
                </div>
                <div>
                  <label htmlFor="admin-confirm-password" className="mb-1 block text-sm font-medium text-gray-700">Confirm password</label>
                  <input id="admin-confirm-password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={isSaving} className="w-full rounded-lg border border-gray-300 p-2" />
                </div>
                {createUserError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{createUserError}</p>}
                <div className="flex justify-end gap-3 border-t border-gray-100 pt-4 sm:col-span-2">
                  <button type="button" onClick={closeCreateUser} disabled={isSaving} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
                  <button type="submit" disabled={isSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    {isSaving ? 'Saving…' : 'Create user'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
        {userToDelete && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
            <section role="alertdialog" aria-modal="true" aria-labelledby="delete-user-title" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
              <h2 id="delete-user-title" className="text-xl font-bold text-gray-800">Delete user {userToDelete.username}?</h2>
              <p className="mt-3 text-sm text-gray-600">
                This permanently deletes the account and its personal board. Tasks assigned to them on retained boards become unassigned; tasks on their personal board are deleted with it. Their other boards transfer to you, and initiatives they created are deleted.
              </p>
              {deleteUserError && <p role="alert" className="mt-3 text-sm text-red-700">{deleteUserError}</p>}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={isDeletingUser}
                  onClick={() => {
                    setUserToDelete(null);
                    setDeleteUserError('');
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeletingUser}
                  onClick={() => void handleDeleteUser()}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isDeletingUser ? 'Deleting…' : 'Confirm delete'}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
      ) : (
      <section aria-labelledby="manage-boards-title" className="space-y-4">
        <h2 id="manage-boards-title" className="text-xl font-bold text-gray-800">Board management</h2>
        <section aria-label="All boards" className="rounded-xl bg-white p-4 shadow-sm sm:p-6">
          <h3 className="mb-4 text-lg font-bold text-gray-800">All boards</h3>
          {boardsError && <p role="alert" className="mb-3 text-sm text-red-700">{boardsError}</p>}
          {isBoardsLoading ? (
            <p className="text-sm text-gray-600">Loading boards…</p>
          ) : boards.length === 0 ? (
            <p className="text-sm text-gray-600">No boards found.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {boards.map((board) => (
                <li key={board.id} className="admin-board-row flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800">{board.title}</p>
                    <p className="mt-1 text-sm text-gray-500">Owned by {board.owner_name} ({board.owner_id})</p>
                  </div>
                  <button type="button" aria-label={`Manage ${board.title}`} onClick={() => setManagingBoard(board)} className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                    Manage
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
      )}
      {managingBoard && (
        <ManageBoardOverlay
          board={managingBoard}
          users={users.map((user) => ({
            id: user.username,
            full_name: user.preferred_name?.trim() || user.full_name,
          }))}
          onClose={() => setManagingBoard(null)}
          onDeleteBoard={async (board) => {
            await persistDeleteBoard(board.id);
            setBoards((current) => current.filter((item) => item.id !== board.id));
          }}
        />
      )}
        </div>
      </div>
    </section>
  );
}