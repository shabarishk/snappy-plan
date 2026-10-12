import { useState, useEffect } from 'react';

export function AuthWrapper({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [view, setView] = useState<'loading' | 'setup' | 'login' | 'error'>('loading');

  useEffect(() => {
    const checkAuth = async () => {
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
        const setupData: { setup_required: boolean } = await setupRes.json();
        setView(setupData.setup_required ? 'setup' : 'login');
      } catch (err) {
        console.error('Failed to initialize authentication', err);
        setView('error');
      }
    };

    void checkAuth();
  }, [onAuthenticated]);

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

  if (view === 'setup') return <SetupScreen onComplete={() => setView('login')} />;
  return <LoginScreen onLoginSuccess={onAuthenticated} />;
}

function SetupScreen({ onComplete }: { onComplete: () => void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, full_name: fullName, password }),
      });

      if (!res.ok) {
        setError('Setup failed. Please try again.');
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