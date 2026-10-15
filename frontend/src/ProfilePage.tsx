import { useEffect, useRef, useState } from 'react';
import { updateProfile, updateProfilePicture } from './api';
import type { UserProfile } from './api';

const cropSize = 256;
const maxImageSize = 5 * 1024 * 1024;

type CropImage = {
  url: string;
  image: HTMLImageElement;
};

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
  const [pictureError, setPictureError] = useState('');
  const [selectedImage, setSelectedImage] = useState<CropImage | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0.5, y: 0.5 });
  const [isSavingPicture, setIsSavingPicture] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    if (!selectedImage) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSavingPicture) setSelectedImage(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isSavingPicture, selectedImage]);

  useEffect(() => () => {
    if (selectedImage) URL.revokeObjectURL(selectedImage.url);
  }, [selectedImage]);

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

  const handleImageSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPictureError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPictureError('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > maxImageSize) {
      setPictureError('Choose an image smaller than 5 MB.');
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setZoom(1);
      setPan({ x: 0.5, y: 0.5 });
      setSelectedImage({ url, image });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setPictureError('This image could not be opened. Choose a different image.');
    };
    image.src = url;
  };

  const saveCroppedPicture = async () => {
    if (!selectedImage || isSavingPicture) return;
    const { image } = selectedImage;
    const scale = Math.max(cropSize / image.naturalWidth, cropSize / image.naturalHeight) * zoom;
    const sourceWidth = cropSize / scale;
    const sourceHeight = cropSize / scale;
    const sourceX = (image.naturalWidth - sourceWidth) * pan.x;
    const sourceY = (image.naturalHeight - sourceHeight) * pan.y;
    const canvas = document.createElement('canvas');
    canvas.width = cropSize;
    canvas.height = cropSize;
    const context = canvas.getContext('2d');
    if (!context) {
      setPictureError('Your browser could not crop this image.');
      return;
    }

    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, cropSize, cropSize);
    setPictureError('');
    setIsSavingPicture(true);
    try {
      const savedProfile = await updateProfilePicture(canvas.toDataURL('image/jpeg', 0.82));
      onSaved(savedProfile);
      setSelectedImage(null);
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : 'Failed to update profile picture');
    } finally {
      setIsSavingPicture(false);
    }
  };

  const removePicture = async () => {
    if (!profile.profile_picture || isSavingPicture) return;
    setPictureError('');
    setIsSavingPicture(true);
    try {
      onSaved(await updateProfilePicture(null));
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : 'Failed to remove profile picture');
    } finally {
      setIsSavingPicture(false);
    }
  };

  const imageScale = selectedImage
    ? Math.max(cropSize / selectedImage.image.naturalWidth, cropSize / selectedImage.image.naturalHeight) * zoom
    : 1;
  const imageWidth = selectedImage ? selectedImage.image.naturalWidth * imageScale : cropSize;
  const imageHeight = selectedImage ? selectedImage.image.naturalHeight * imageScale : cropSize;

  return (
    <>
      <section aria-label="Profile details" className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-6 rounded-xl bg-white p-6 shadow-sm md:grid-cols-[minmax(0,1fr)_16rem]">
        <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
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
        <aside aria-label="Profile picture" className="flex flex-col items-center gap-3">
          <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-gray-200 bg-gray-50">
            {profile.profile_picture
              ? <img src={profile.profile_picture} alt="Current profile" className="h-40 w-40 rounded-full object-cover" />
              : <span aria-hidden="true" className="flex h-40 w-40 items-center justify-center rounded-full bg-blue-100 text-5xl font-bold text-blue-700">
                {profile.full_name.trim().charAt(0).toUpperCase() || profile.username.charAt(0).toUpperCase()}
              </span>}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleImageSelected}
          />
          <div className="flex w-full gap-2">
            <button
              type="button"
              disabled={isSavingPicture}
              onClick={() => fileInputRef.current?.click()}
              className="min-w-0 flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Update photo
            </button>
            <button
              type="button"
              disabled={!profile.profile_picture || isSavingPicture}
              onClick={() => void removePicture()}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingPicture && !selectedImage ? 'Removing…' : 'Remove'}
            </button>
          </div>
          {pictureError && <p role="alert" className="w-full text-sm text-red-700">{pictureError}</p>}
        </aside>
      </section>
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSavingPicture) setSelectedImage(null);
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="crop-picture-title" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="crop-picture-title" className="text-lg font-bold text-gray-900">Crop profile picture</h2>
                <p className="mt-1 text-sm text-gray-600">Drag the image to reposition it, then adjust the zoom.</p>
              </div>
              <button
                type="button"
                aria-label="Close crop dialog"
                disabled={isSavingPicture}
                onClick={() => setSelectedImage(null)}
                className="rounded-md px-2 py-1 text-gray-500 hover:bg-gray-100"
              >×</button>
            </div>
            <div
              className="relative mx-auto aspect-square w-64 touch-none overflow-hidden rounded-full bg-gray-100"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                dragStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
              }}
              onPointerMove={(event) => {
                const start = dragStartRef.current;
                if (!start || !selectedImage) return;
                const width = selectedImage.image.naturalWidth * imageScale;
                const height = selectedImage.image.naturalHeight * imageScale;
                setPan({
                  x: width <= cropSize ? 0.5 : Math.max(0, Math.min(1, start.panX + (event.clientX - start.x) / (cropSize - width))),
                  y: height <= cropSize ? 0.5 : Math.max(0, Math.min(1, start.panY + (event.clientY - start.y) / (cropSize - height))),
                });
              }}
              onPointerUp={() => { dragStartRef.current = null; }}
              onPointerCancel={() => { dragStartRef.current = null; }}
            >
              <img
                src={selectedImage.url}
                alt="Crop preview"
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{
                  width: `${imageWidth}px`,
                  height: `${imageHeight}px`,
                  left: `${(cropSize - imageWidth) * pan.x}px`,
                  top: `${(cropSize - imageHeight) * pan.y}px`,
                }}
              />
            </div>
            <label htmlFor="profile-picture-zoom" className="mb-1 mt-5 block text-sm font-medium text-gray-700">Zoom</label>
            <input
              id="profile-picture-zoom"
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="w-full"
            />
            {pictureError && <p role="alert" className="mt-3 text-sm text-red-700">{pictureError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" disabled={isSavingPicture} onClick={() => setSelectedImage(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
              <button type="button" disabled={isSavingPicture} onClick={() => void saveCroppedPicture()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {isSavingPicture ? 'Saving…' : 'Save picture'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
