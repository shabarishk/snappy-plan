import { useState } from 'react';
import { updateProfile } from './api';
import type { UserProfile } from './api';

export function ProfilePage({
  profile,
  onSaved,
}: {
  profile: UserProfile;
  onSaved: (profile: UserProfile) => void;
}) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [email, setEmail] = useState(profile.email);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSaving(true);
    try {
      const savedProfile = await updateProfile({ full_name: fullName, email });
      setFullName(savedProfile.full_name);
      setEmail(savedProfile.email);
      setIsEditing(false);
      onSaved(savedProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section aria-label="Profile details" className="mx-auto w-full max-w-2xl rounded-xl bg-white p-6 shadow-sm">
      <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Username</span>
            <p className="rounded-lg bg-gray-50 p-2 text-gray-700">{profile.username}</p>
          </div>
          <div>
            <label htmlFor="profile-full-name" className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
            <input
              id="profile-full-name"
              type="text"
              required
              maxLength={100}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              disabled={!isEditing || isSaving}
              className="w-full rounded-lg border border-gray-300 p-2 disabled:border-transparent disabled:bg-gray-50 disabled:text-gray-700"
            />
          </div>
          <div>
            <label htmlFor="profile-email" className="mb-1 block text-sm font-medium text-gray-700">Email address</label>
            <input
              id="profile-email"
              type="email"
              required
              maxLength={255}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={!isEditing || isSaving}
              className="w-full rounded-lg border border-gray-300 p-2 disabled:border-transparent disabled:bg-gray-50 disabled:text-gray-700"
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            {isEditing ? (
              <>
                <button type="button" disabled={isSaving} onClick={() => {
                  setFullName(profile.full_name);
                  setEmail(profile.email);
                  setError('');
                  setIsEditing(false);
                }} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
                <button type="submit" disabled={isSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {isSaving ? 'Saving…' : 'Save changes'}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setIsEditing(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Edit profile</button>
            )}
          </div>
      </form>
    </section>
  );
}