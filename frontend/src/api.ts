// frontend/src/api.ts

// 1. Define types matching your Go structs
export interface Board {
  id: string;
  title: string;
  owner_id: string;
}

export interface ApiTask {
  id: string;
  title: string;
  description: string | null;
  column_id: string;
  state: 'Backlog' | 'ToDo' | 'InProgress' | 'Complete';
  priority: 'Low' | 'Medium' | 'High';
  assigned_to_id: string | null;
  complete_by: string | null;
  completed_at: string | null;
}

export interface TaskAssignee {
  id: string;
  full_name: string;
}

export interface UserProfile {
  username: string;
  full_name: string;
  email: string;
  role: 'admin' | 'user';
}

export interface AdminUser extends UserProfile {
  username: string;
}

export interface CreateTaskRequest {
  board_id: string;
  title: string;
  description: string;
  assigned_to_id: string;
  state: 'Backlog' | 'ToDo';
  priority: 'Low' | 'Medium' | 'High';
  complete_by: string | null;
}

export interface UpdateTaskRequest {
  title: string;
  description: string;
  priority: ApiTask['priority'];
  state: ApiTask['state'];
  complete_by: string | null;
}

// 2. Wrap standard fetch calls
export const checkHealth = async () => {
  const res = await fetch('/api/health');
  return res.text();
};

export const createBoard = async (title: string, ownerId: string): Promise<Board> => {
  const res = await fetch('/api/boards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, owner_id: ownerId })
  });
  if (!res.ok) throw new Error("Failed to create board");
  return res.json();
};

export const getTasks = async (): Promise<ApiTask[]> => {
  const res = await fetch('/api/tasks', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Failed to load tasks');
  return res.json();
};

export const getBoards = async (): Promise<Board[]> => {
  const res = await fetch('/api/boards', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const getTaskAssignees = async (): Promise<TaskAssignee[]> => {
  const res = await fetch('/api/users', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Failed to load users');
  return res.json();
};

export const getProfile = async (): Promise<UserProfile> => {
  const res = await fetch('/api/profile', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const logout = async (): Promise<void> => {
  const res = await fetch('/api/logout', {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(await res.text());
};

export const getAdminUsers = async (): Promise<AdminUser[]> => {
  const res = await fetch('/api/admin/users', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const createUser = async (user: {
  username: string;
  email: string;
  password: string;
}): Promise<AdminUser> => {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(user),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const promoteUserToAdmin = async (username: string): Promise<AdminUser> => {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ role: 'admin' }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const updateProfile = async (profile: Pick<UserProfile, 'full_name' | 'email'>): Promise<UserProfile> => {
  const res = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const updatePassword = async (passwords: {
  current_password: string;
  new_password: string;
  confirm_password: string;
}): Promise<void> => {
  const res = await fetch('/api/profile/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(passwords),
  });
  if (!res.ok) throw new Error(await res.text());
};

export const createTask = async (task: CreateTaskRequest): Promise<ApiTask> => {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(task),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const moveTask = async (
  taskId: string,
  state: ApiTask['state'],
): Promise<ApiTask> => {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ state }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const updateTask = async (
  taskId: string,
  task: UpdateTaskRequest,
): Promise<ApiTask> => {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(task),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};