import { useState } from 'react';
import { updatePassword } from './api';

export function SettingsPage() {
  const [selectedSection, setSelectedSection] = useState<'profile-settings'>('profile-settings');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setIsSaving(true);
    try {
      await updatePassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Password updated successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section aria-label="Settings" className="mx-auto w-full max-w-5xl">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="rounded-xl bg-white p-2 shadow-sm">
          <button
            type="button"
            aria-current={selectedSection === 'profile-settings' ? 'page' : undefined}
            onClick={() => setSelectedSection('profile-settings')}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${selectedSection === 'profile-settings' ? 'bg-blue-100 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            Profile settings
          </button>
        </nav>
        <div className="rounded-xl bg-white p-6 shadow-sm">
          {selectedSection === 'profile-settings' && (
            <section aria-labelledby="password-settings-title">
              <div className="mb-6 border-b border-gray-100 pb-4">
                <h3 id="password-settings-title" className="text-lg font-bold text-gray-800">Change password</h3>
                <p className="mt-1 text-sm text-gray-500">Enter your current password and choose a new one.</p>
              </div>
              <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
                <div>
                  <label htmlFor="current-password" className="mb-1 block text-sm font-medium text-gray-700">Current password</label>
                  <input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    disabled={isSaving}
                    className="w-full rounded-lg border border-gray-300 p-2"
                  />
                </div>
                <div>
                  <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-gray-700">New password</label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={72}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    disabled={isSaving}
                    className="w-full rounded-lg border border-gray-300 p-2"
                  />
                </div>
                <div>
                  <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-gray-700">Re-enter new password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={72}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    disabled={isSaving}
                    className="w-full rounded-lg border border-gray-300 p-2"
                  />
                </div>
                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                {success && <p role="status" className="text-sm text-green-700">{success}</p>}
                <div className="border-t border-gray-100 pt-4">
                  <button type="submit" disabled={isSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    {isSaving ? 'Saving…' : 'Save password'}
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}