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
      .mockResolvedValueOnce(response({ launch_required: false }))
      .mockResolvedValueOnce(response({ authenticated: false }))
      .mockResolvedValueOnce(response({ setup_required: true }))
      .mockResolvedValueOnce(response({ message: 'Admin account created' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthWrapper onAuthenticated={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Initialize Snappy Plan' });

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'AdminUser1' } });
    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Admin User' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Create Admin Account' }).closest('form')!);

    await screen.findByRole('heading', { name: 'Welcome Back' });
    expect(fetchMock).toHaveBeenCalledWith('/api/setup', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        username: 'AdminUser1',
        email: 'admin@example.com',
        full_name: 'Admin User',
        password: 'password123',
      }),
    }));
  });

  it('shows login when setup is complete and calls back after successful login', async () => {
    const onAuthenticated = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ launch_required: false }))
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ launch_required: false }))
      .mockResolvedValueOnce(response({ authenticated: true }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthWrapper onAuthenticated={onAuthenticated} />);

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows an error instead of falling through to login when status checks fail', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ launch_required: false }))
      .mockResolvedValueOnce(response({}, false)));

    render(<AuthWrapper onAuthenticated={vi.fn()} />);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Unable to connect to Snappy Plan. Please refresh the page and try again.',
    );
  });

  it('shows a recoverable error when account setup is rejected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ launch_required: false }))
      .mockResolvedValueOnce(response({ authenticated: false }))
      .mockResolvedValueOnce(response({ setup_required: true }))
      .mockResolvedValueOnce(response({}, false));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthWrapper onAuthenticated={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Initialize Snappy Plan' });
    fireEvent.submit(screen.getByRole('button', { name: 'Create Admin Account' }).closest('form')!);

    expect(await screen.findByText('Setup failed. Check the launch setup key and try again.')).toBeTruthy();
  });

  it('shows a recoverable error when login is rejected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ launch_required: false }))
      .mockResolvedValueOnce(response({ authenticated: false }))
      .mockResolvedValueOnce(response({ setup_required: false }))
      .mockResolvedValueOnce(response({}, false));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthWrapper onAuthenticated={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Welcome Back' });
    fireEvent.submit(screen.getByRole('button', { name: 'Log In' }).closest('form')!);

    expect(await screen.findByText('Invalid email or password')).toBeTruthy();
  });

  it('reports network failures during setup and login', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const setupFetch = vi.fn()
      .mockResolvedValueOnce(response({ launch_required: false }))
      .mockResolvedValueOnce(response({ authenticated: false }))
      .mockResolvedValueOnce(response({ setup_required: true }))
      .mockRejectedValueOnce(new Error('network error'));
    vi.stubGlobal('fetch', setupFetch);
    const { unmount } = render(<AuthWrapper onAuthenticated={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Initialize Snappy Plan' });
    fireEvent.submit(screen.getByRole('button', { name: 'Create Admin Account' }).closest('form')!);
    expect(await screen.findByText('Setup failed. Please check backend logs.')).toBeTruthy();
    unmount();

    const loginFetch = vi.fn()
      .mockResolvedValueOnce(response({ launch_required: false }))
      .mockResolvedValueOnce(response({ authenticated: false }))
      .mockResolvedValueOnce(response({ setup_required: false }))
      .mockRejectedValueOnce(new Error('network error'));
    vi.stubGlobal('fetch', loginFetch);
    render(<AuthWrapper onAuthenticated={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Welcome Back' });
    fireEvent.submit(screen.getByRole('button', { name: 'Log In' }).closest('form')!);
    expect(await screen.findByText('Invalid email or password')).toBeTruthy();
    expect(consoleError).toHaveBeenCalled();
  });

  it('configures PostgreSQL before showing the initial admin setup', async () => {
    const setupToken = '0123456789abcdef0123456789abcdef';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ launch_required: true }))
      .mockResolvedValueOnce(response({}, true))
      .mockResolvedValueOnce(response({ authenticated: false }))
      .mockResolvedValueOnce(response({ setup_required: true, setup_token_required: true }));
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthWrapper onAuthenticated={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Launch Snappy Plan' });
    fireEvent.change(screen.getByLabelText('Launch setup key'), { target: { value: setupToken } });
    fireEvent.change(screen.getByLabelText('PostgreSQL host'), { target: { value: 'postgres-db' } });
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '5432' } });
    fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'snappyplan' } });
    fireEvent.change(screen.getByLabelText('Database username'), { target: { value: 'snappy' } });
    fireEvent.change(screen.getByLabelText('Database password'), { target: { value: 'db-secret' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Connect and prepare database' }).closest('form')!);

    await screen.findByRole('heading', { name: 'Initialize Snappy Plan' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/launch/configure', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Setup-Token': setupToken }),
      body: JSON.stringify({
        host: 'postgres-db',
        port: 5432,
        database: 'snappyplan',
        username: 'snappy',
        password: 'db-secret',
      }),
    }));
    expect((screen.getByLabelText('Launch setup key') as HTMLInputElement).value).toBe(setupToken);
  });
});
