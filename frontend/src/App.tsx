import { useCallback, useState } from 'react';
import { AuthWrapper } from './Auth';
import type { Task } from './taskModel';
import { AuthenticatedBoard } from './AuthenticatedBoard';

// --- Main App Component ---
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const handleAuthenticated = useCallback(() => setIsAuthenticated(true), []);

  if (!isAuthenticated) {
    return <AuthWrapper onAuthenticated={handleAuthenticated} />;
  }

  return <AuthenticatedBoard tasks={tasks} setTasks={setTasks} onLoggedOut={() => setIsAuthenticated(false)} />;
}

export { AuthenticatedBoard } from './AuthenticatedBoard';
export type { Task } from './taskModel';
