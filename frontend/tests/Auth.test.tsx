import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthWrapper } from '../src/Auth';

const response = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AuthWrapper', () => {
  it('shows the setup wizard when no users exist, then routes to login after setup', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ authenticated: false }))
      .mockResolvedValueOnce(response({ setup_required: true }))
      .mockResolvedValueOnce(response({ message: 'Admin account created' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthWrapper onAuthenticated={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Initialize Snappy Plan' });

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Admin User' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Create Admin Account' }).closest('form')!);

    await screen.findByRole('heading', { name: 'Welcome Back' });
    expect(fetchMock).toHaveBeenCalledWith('/api/setup', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@example.com',
        full_name: 'Admin User',
        password: 'password123',
      }),
    }));
  });

  it('shows login when setup is complete and calls back after successful login', async () => {
    const onAuthenticated = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ authenticated: false }))
      .mockResolvedValueOnce(response({ setup_required: false }))
      .mockResolvedValueOnce(response({ message: 'Logged in' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthWrapper onAuthenticated={onAuthenticated} />);
    await screen.findByRole('heading', { name: 'Welcome Back' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Log In' }).closest('form')!);

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/login', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
    }));
  });

  it('restores an existing cookie session without checking setup status', async () => {
    const onAuthenticated = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ authenticated: true }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthWrapper onAuthenticated={onAuthenticated} />);

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('shows an error instead of falling through to login when status checks fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({}, false)));

    render(<AuthWrapper onAuthenticated={vi.fn()} />);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Unable to connect to Snappy Plan. Please refresh the page and try again.',
    );
  });
});
