import { useState, useEffect } from 'react';

export function AuthWrapper({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [view, setView] = useState<'loading' | 'launch' | 'reconnecting' | 'setup' | 'login' | 'error'>('loading');
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);
  const [setupToken, setSetupToken] = useState('');
  const [reconnectError, setReconnectError] = useState('');

  useEffect(() => {
    const checkAuth = async (token = '') => {
      try {
        const launchRes = await fetch('/api/launch/status', { credentials: 'same-origin' });
        if (!launchRes.ok) throw new Error('Failed to check launch status');
        const launchData: { launch_required: boolean; database_ready?: boolean } = await launchRes.json();
        if (launchData.launch_required) {
          setView('launch');
          return;
        }
        if (launchData.database_ready === false) {
          setView('reconnecting');
          return;
        }

        const authRes = await fetch('/api/auth/status', { credentials: 'same-origin' });
        if (!authRes.ok) throw new Error('Failed to check authentication status');
        const authData: { authenticated: boolean } = await authRes.json();
        if (authData.authenticated) {
          onAuthenticated();
          return;
        }

        const setupRes = await fetch('/api/setup/status', { credentials: 'same-origin' });
        if (!setupRes.ok) throw new Error('Failed to check setup status');
        const setupData: { setup_required: boolean; setup_token_required?: boolean } = await setupRes.json();
        setSetupTokenRequired(setupData.setup_token_required ?? false);
        if (token) setSetupToken(token);
        setView(setupData.setup_required ? 'setup' : 'login');
      } catch (err) {
        console.error('Failed to initialize authentication', err);
        setView('error');
      }
    };

    void checkAuth();
  }, [onAuthenticated]);

  useEffect(() => {
    if (view !== 'reconnecting') return;
    let cancelled = false;
    const checkDatabase = async () => {
      try {
        const launchRes = await fetch('/api/launch/status', { credentials: 'same-origin' });
        if (!launchRes.ok) throw new Error('Failed to check database connection');
        const launchData: { launch_required: boolean; database_ready?: boolean } = await launchRes.json();
        if (cancelled) return;
        if (launchData.launch_required) {
          setView('launch');
          return;
        }
        if (launchData.database_ready === false) return;

        const authRes = await fetch('/api/auth/status', { credentials: 'same-origin' });
        if (!authRes.ok) throw new Error('Failed to check authentication status');
        const authData: { authenticated: boolean } = await authRes.json();
        if (cancelled) return;
        if (authData.authenticated) {
          onAuthenticated();
          return;
        }
        const setupRes = await fetch('/api/setup/status', { credentials: 'same-origin' });
        if (!setupRes.ok) throw new Error('Failed to check setup status');
        const setupData: { setup_required: boolean; setup_token_required?: boolean } = await setupRes.json();
        if (cancelled) return;
        setSetupTokenRequired(setupData.setup_token_required ?? false);
        setView(setupData.setup_required ? 'setup' : 'login');
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to reconnect to Snappy Plan', err);
          setReconnectError('Still unable to reach the database. Snappy Plan will keep retrying automatically.');
        }
      }
    };

    void checkDatabase();
    const interval = window.setInterval(() => void checkDatabase(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [view, onAuthenticated]);

  if (view === 'loading') {
    return (
      <div className="h-screen bg-gray-200 flex items-center justify-center">
        <div className="animate-pulse text-blue-600 font-bold text-xl">Loading Snappy Plan...</div>
      </div>
    );
  }

  if (view === 'error') {
    return (
      <div className="h-screen bg-gray-200 flex items-center justify-center p-4">
        <div role="alert" className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md text-center text-red-700">
          Unable to connect to Snappy Plan. Please refresh the page and try again.
        </div>
      </div>
    );
  }

  if (view === 'reconnecting') {
    return (
      <div className="min-h-screen bg-gray-200 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md text-center">
          <h1 className="text-2xl font-extrabold text-gray-800">Reconnecting to PostgreSQL</h1>
          <p className="text-sm text-gray-600 mt-3">Your saved database configuration was found. Snappy Plan is retrying the connection; this page will continue automatically when the database is ready.</p>
          {reconnectError && <p role="alert" className="mt-4 text-sm text-amber-700">{reconnectError}</p>}
          <button type="button" onClick={() => setView('launch')} className="mt-5 text-sm text-blue-700 underline">
            Change database connection settings
          </button>
        </div>
      </div>
    );
  }

  if (view === 'launch') {
    return <LaunchScreen onComplete={(token) => {
      setSetupToken(token);
      setView('loading');
      void refreshAfterLaunch(token);
    }} />;
  }
  if (view === 'setup') {
    return <SetupScreen
      onComplete={() => {
        setSetupToken('');
        setSetupTokenRequired(false);
        setView('login');
      }}
      tokenRequired={setupTokenRequired}
      setupToken={setupToken}
      setSetupToken={setSetupToken}
    />;
  }
  return <LoginScreen onLoginSuccess={onAuthenticated} />;

  async function refreshAfterLaunch(token: string) {
    try {
      const authRes = await fetch('/api/auth/status', { credentials: 'same-origin' });
      if (!authRes.ok) throw new Error('Failed to check authentication status');
      const authData: { authenticated: boolean } = await authRes.json();
      if (authData.authenticated) {
        onAuthenticated();
        return;
      }
      const setupRes = await fetch('/api/setup/status', { credentials: 'same-origin' });
      if (!setupRes.ok) throw new Error('Failed to check setup status');
      const setupData: { setup_required: boolean; setup_token_required?: boolean } = await setupRes.json();
      setSetupTokenRequired(setupData.setup_token_required ?? false);
      setSetupToken(token);
      setView(setupData.setup_required ? 'setup' : 'login');
    } catch (err) {
      console.error('Failed to initialize authentication', err);
      setView('error');
    }
  }
}

function LaunchScreen({ onComplete }: { onComplete: (token: string) => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('snappyplan');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/launch/configure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Setup-Token': setupToken,
        },
        body: JSON.stringify({ host, port: Number(port), database, username, password }),
      });
      if (!res.ok) {
        const message = await res.text();
        setError(message.trim() || 'Could not configure PostgreSQL. Check the settings and try again.');
        return;
      }
      onComplete(setupToken);
    } catch (err) {
      console.error('Failed to configure PostgreSQL', err);
      setError('Unable to reach Snappy Plan. Check the container logs and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-200 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl mx-auto mb-4">S</div>
          <h1 className="text-2xl font-extrabold text-gray-800">Launch Snappy Plan</h1>
          <p className="text-sm text-gray-500 mt-2">Connect to PostgreSQL to prepare the application database.</p>
        </div>

        {error && <div role="alert" className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>}
        <form onSubmit={handleLaunch} className="space-y-3">
          <div>
            <label htmlFor="launch-token" className="block text-sm font-medium text-gray-700 mb-1">Launch setup key</label>
            <input id="launch-token" type="password" autoComplete="off" required minLength={32} value={setupToken} onChange={(e) => setSetupToken(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" />
            <p className="text-xs text-gray-500 mt-1">Use the 32-character-or-longer secret configured in the Unraid template.</p>
          </div>
          <div>
            <label htmlFor="database-host" className="block text-sm font-medium text-gray-700 mb-1">PostgreSQL host</label>
            <input id="database-host" type="text" required value={host} onChange={(e) => setHost(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" placeholder="PostgreSQL container name on proxynet" />
            <p className="text-xs text-gray-500 mt-1">On a shared proxynet, use the PostgreSQL container name or network alias, not localhost.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="database-port" className="block text-sm font-medium text-gray-700 mb-1">Port</label>
              <input id="database-port" type="number" min="1" max="65535" required value={port} onChange={(e) => setPort(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label htmlFor="database-name" className="block text-sm font-medium text-gray-700 mb-1">Database</label>
              <input id="database-name" type="text" required value={database} onChange={(e) => setDatabase(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
          <div>
            <label htmlFor="database-username" className="block text-sm font-medium text-gray-700 mb-1">Database username</label>
            <input id="database-username" type="text" required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label htmlFor="database-password" className="block text-sm font-medium text-gray-700 mb-1">Database password</label>
            <input id="database-password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" />
          </div>
          <button type="submit" disabled={submitting} className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">
            {submitting ? 'Connecting to PostgreSQL…' : 'Connect and prepare database'}
          </button>
        </form>
        <p className="text-xs text-gray-500 mt-4">The database must already exist. Snappy Plan will apply its schema, then show the administrator setup page. Use HTTPS or a trusted LAN connection during setup.</p>
      </div>
    </div>
  );
}

function SetupScreen({
  onComplete,
  tokenRequired,
  setupToken,
  setSetupToken,
}: {
  onComplete: () => void;
  tokenRequired: boolean;
  setupToken: string;
  setSetupToken: (token: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tokenRequired ? { 'X-Setup-Token': setupToken } : {}),
        },
        body: JSON.stringify({ username, email, full_name: fullName, password }),
      });

      if (!res.ok) {
        setError('Setup failed. Check the launch setup key and try again.');
        return;
      }
      onComplete();
    } catch (err) {
      console.error('Failed to create admin account', err);
      setError('Setup failed. Please check backend logs.');
    }
  };

  return (
    <div className="h-screen bg-gray-200 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl mx-auto mb-4">S</div>
          <h1 className="text-2xl font-extrabold text-gray-800">Initialize Snappy Plan</h1>
          <p className="text-sm text-gray-500 mt-2">Create the master admin account.</p>
        </div>
        
        {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>}

        <form onSubmit={handleSetup} className="space-y-4">
          {tokenRequired && (
            <div>
              <label htmlFor="admin-setup-token" className="block text-sm font-medium text-gray-700 mb-1">Launch setup key</label>
              <input id="admin-setup-token" type="password" autoComplete="off" required minLength={32} value={setupToken} onChange={(e) => setSetupToken(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          )}
          <div>
            <label htmlFor="setup-username" className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input id="setup-username" type="text" required minLength={1} maxLength={32} pattern="[A-Za-z0-9]+" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Choose a username" />
          </div>
          <div>
            <label htmlFor="setup-full-name" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input id="setup-full-name" type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="John Doe" />
          </div>
          <div>
            <label htmlFor="setup-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input id="setup-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="admin@family.local" />
          </div>
          <div>
            <label htmlFor="setup-password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input id="setup-password" type="password" required minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="••••••••" />
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors">
            Create Admin Account
          </button>
        </form>
      </div>
    </div>
  );
}

function LoginScreen({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setError('Invalid email or password');
        return;
      }
      onLoginSuccess();
    } catch (err) {
      console.error('Failed to log in', err);
      setError('Invalid email or password');
    }
  };

  return (
    <div className="h-screen bg-gray-200 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl mx-auto mb-4">S</div>
          <h1 className="text-2xl font-extrabold text-gray-800">Welcome Back</h1>
          <p className="text-sm text-gray-500 mt-2">Log in to your family board.</p>
        </div>

        {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input id="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input id="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors">
            Log In
          </button>
        </form>
      </div>
    </div>
  );
}