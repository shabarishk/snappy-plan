import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from '../src/ProfilePage';
import { updateProfile, updateProfilePicture } from '../src/api';
import type { UserProfile } from '../src/api';

vi.mock('../src/api', () => ({
  updateProfile: vi.fn(),
  updateProfilePicture: vi.fn(),
}));

const profile: UserProfile = {
  username: 'boardowner',
  full_name: 'Board Owner',
  preferred_name: 'Sam',
  email: 'owner@example.com',
  role: 'user',
  profile_picture: null,
};

const savedPictureProfile: UserProfile = {
  ...profile,
  profile_picture: 'data:image/jpeg;base64,cropped',
};

function selectImage(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('Profile picture input was not rendered');
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.mocked(updateProfile).mockReset();
    vi.mocked(updateProfilePicture).mockReset();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('Image', class {
      naturalWidth = 512;
      naturalHeight = 384;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        if (value.includes('broken')) this.onerror?.();
        else this.onload?.();
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves preferred name changes and reports update failures', async () => {
    const onSaved = vi.fn();
    vi.mocked(updateProfile).mockRejectedValueOnce(new Error('Profile update failed'));
    const { rerender } = render(<ProfilePage profile={profile} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    fireEvent.change(screen.getByLabelText('Preferred name'), { target: { value: '  Casey  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Profile update failed');
    expect(updateProfile).toHaveBeenCalledWith({
      full_name: 'Board Owner',
      preferred_name: '  Casey  ',
      email: 'owner@example.com',
    });
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByLabelText('Preferred name') as HTMLInputElement).value).toBe('Sam');

    vi.mocked(updateProfile).mockResolvedValueOnce({ ...profile, preferred_name: 'Casey' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    fireEvent.change(screen.getByLabelText('Preferred name'), { target: { value: 'Casey' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...profile, preferred_name: 'Casey' }));
    rerender(<ProfilePage profile={{ ...profile, preferred_name: 'Casey' }} onSaved={onSaved} />);
  });

  it('validates the selected image and handles failed image decoding', async () => {
    const { container } = render(<ProfilePage profile={profile} onSaved={vi.fn()} />);
    selectImage(container, new File(['image'], 'unsupported.gif', { type: 'image/gif' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Choose a JPEG, PNG, or WebP image.');

    selectImage(container, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Choose an image smaller than 5 MB.');

    selectImage(container, new File(['image'], 'broken.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'This image could not be opened. Choose a different image.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('crops, saves, and removes a profile picture', async () => {
    const onSaved = vi.fn();
    vi.mocked(updateProfilePicture)
      .mockResolvedValueOnce(savedPictureProfile)
      .mockResolvedValueOnce(profile);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(savedPictureProfile.profile_picture!);

    const { container, rerender } = render(<ProfilePage profile={profile} onSaved={onSaved} />);
    selectImage(container, new File(['image'], 'portrait.png', { type: 'image/png' }));
    const cropFrame = screen.getByAltText('Crop preview').parentElement;
    if (!cropFrame) throw new Error('Crop preview frame was not rendered');
    Object.defineProperty(cropFrame, 'setPointerCapture', { configurable: true, value: vi.fn() });
    fireEvent.pointerDown(cropFrame, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(cropFrame, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(cropFrame, { pointerId: 1 });
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save picture' }));

    await waitFor(() => expect(updateProfilePicture).toHaveBeenNthCalledWith(1, savedPictureProfile.profile_picture));
    expect(onSaved).toHaveBeenCalledWith(savedPictureProfile);
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<ProfilePage profile={savedPictureProfile} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(updateProfilePicture).toHaveBeenNthCalledWith(2, null));
    expect(onSaved).toHaveBeenLastCalledWith(profile);
  });

  it('shows crop and removal errors', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container, rerender } = render(<ProfilePage profile={profile} onSaved={vi.fn()} />);
    selectImage(container, new File(['image'], 'portrait.png', { type: 'image/png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save picture' }));
    expect(await screen.findAllByText('Your browser could not crop this image.')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    getContext.mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,cropped');
    vi.mocked(updateProfilePicture).mockRejectedValueOnce(new Error('Picture upload failed'));
    selectImage(container, new File(['image'], 'portrait.png', { type: 'image/png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save picture' }));
    expect(await screen.findAllByText('Picture upload failed')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close crop dialog' }));

    vi.mocked(updateProfilePicture).mockRejectedValueOnce(new Error('Picture removal failed'));
    rerender(<ProfilePage profile={savedPictureProfile} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Picture removal failed')).toBeTruthy();
  });
});
