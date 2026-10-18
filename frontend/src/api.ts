// frontend/src/api.ts

// 1. Define types matching your Go structs
export interface Board {
  id: string;
  title: string;
  owner_id: string;
  is_personal: boolean;
}

export interface Initiative {
  id: string;
  title: string;
  description: string | null;
  complete_by: string | null;
  assigned_to_id: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  assigned_to_name?: string | null;
  task_count?: number;
  completed_task_count?: number;
}

export interface InitiativeDetail {
  initiative: Initiative;
  tasks: ApiTask[];
}

export interface AdminBoard extends Board {
  owner_name: string;
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
  legal_name?: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  body: string;
  author_username: string;
  author_name: string;
  created_at: string;
}

const isTaskComment = (value: unknown): value is TaskComment =>
  typeof value === 'object'
  && value !== null
  && 'id' in value
  && typeof value.id === 'string'
  && 'task_id' in value
  && typeof value.task_id === 'string'
  && 'body' in value
  && typeof value.body === 'string'
  && 'author_username' in value
  && typeof value.author_username === 'string'
  && 'author_name' in value
  && typeof value.author_name === 'string'
  && 'created_at' in value
  && typeof value.created_at === 'string';

export interface UserProfile {
  username: string;
  full_name: string;
  preferred_name: string;
  email: string;
  role: 'admin' | 'user';
  profile_picture?: string | null;
}

export interface UserNotification {
  id: string;
  message: string;
  created_at: string;
  read_at: string | null;
}

const isUserNotification = (value: unknown): value is UserNotification =>
  typeof value === 'object'
  && value !== null
  && 'id' in value
  && typeof value.id === 'string'
  && 'message' in value
  && typeof value.message === 'string'
  && 'created_at' in value
  && typeof value.created_at === 'string'
  && 'read_at' in value
  && (typeof value.read_at === 'string' || value.read_at === null);

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
  board_id: string;
  title: string;
  description: string;
  priority: ApiTask['priority'];
  state: ApiTask['state'];
  assigned_to_id: string;
  complete_by: string | null;
}

export interface InitiativeRequest {
  title: string;
  description: string;
  complete_by: string | null;
  assigned_to_id: string;
}

// 2. Wrap standard fetch calls
export const checkHealth = async () => {
  const res = await fetch('/api/health');
  return res.text();
};

export const createBoard = async (title: string, userIds: string[]): Promise<Board> => {
  const res = await fetch('/api/boards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ title, user_ids: userIds })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const getTasks = async (boardId?: string): Promise<ApiTask[]> => {
  const path = boardId ? `/api/tasks?board_id=${encodeURIComponent(boardId)}` : '/api/tasks';
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Failed to load tasks');
  return res.json();
};

export const getInitiatives = async (): Promise<Initiative[]> => {
  const res = await fetch('/api/initiatives', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const createInitiative = async (initiative: InitiativeRequest): Promise<Initiative> => {
  const res = await fetch('/api/initiatives', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(initiative),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const getInitiative = async (initiativeId: string): Promise<InitiativeDetail> => {
  const res = await fetch(`/api/initiatives/${encodeURIComponent(initiativeId)}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const updateInitiative = async (initiativeId: string, initiative: InitiativeRequest): Promise<Initiative> => {
  const res = await fetch(`/api/initiatives/${encodeURIComponent(initiativeId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(initiative),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const addTaskToInitiative = async (initiativeId: string, taskId: string): Promise<void> => {
  const res = await fetch(`/api/initiatives/${encodeURIComponent(initiativeId)}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ task_id: taskId }),
  });
  if (!res.ok) throw new Error(await res.text());
};

export const removeTaskFromInitiative = async (initiativeId: string, taskId: string): Promise<void> => {
  const res = await fetch(`/api/initiatives/${encodeURIComponent(initiativeId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(await res.text());
};

export const getBoards = async (): Promise<Board[]> => {
  const res = await fetch('/api/boards', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const updateBoardOrder = async (boardIds: string[]): Promise<void> => {
  const res = await fetch('/api/boards/order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ board_ids: boardIds }),
  });
  if (!res.ok) throw new Error(await res.text());
};

export const deleteBoard = async (boardId: string): Promise<void> => {
  const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(await res.text());
};

export const getBoardMembers = async (boardId: string): Promise<string[]> => {
  const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/members`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).user_ids;
};

export const updateBoardMembers = async (boardId: string, userIds: string[]): Promise<string[]> => {
  const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/members`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_ids: userIds }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).user_ids;
};

export const getTaskAssignees = async (): Promise<TaskAssignee[]> => {
  const res = await fetch('/api/users', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Failed to load users');
  return res.json();
};

export const getTaskComments = async (taskId: string): Promise<TaskComment[]> => {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await res.text());
  const comments: unknown = await res.json();
  if (!Array.isArray(comments) || !comments.every(isTaskComment)) {
    throw new Error('Invalid task comments response');
  }
  return comments;
};

export const createTaskComment = async (taskId: string, body: string): Promise<TaskComment> => {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(await res.text());
  const comment: unknown = await res.json();
  if (!isTaskComment(comment)) throw new Error('Invalid task comment response');
  return comment;
};

export const getProfile = async (): Promise<UserProfile> => {
  const res = await fetch('/api/profile', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const getNotifications = async (): Promise<UserNotification[]> => {
  const res = await fetch('/api/notifications', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await res.text());
  const notifications: unknown = await res.json();
  if (!Array.isArray(notifications) || !notifications.every(isUserNotification)) {
    throw new Error('Invalid notifications response');
  }
  return notifications.filter(isUserNotification);
};

export const markNotificationRead = async (notificationId: string): Promise<void> => {
  const res = await fetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'PATCH',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(await res.text());
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

export const getAdminBoards = async (): Promise<AdminBoard[]> => {
  const res = await fetch('/api/admin/boards', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const createUser = async (user: {
  username: string;
  full_name: string;
  preferred_name: string;
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

export const deleteAdminUser = async (username: string): Promise<void> => {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(await res.text());
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

export const updateProfile = async (profile: Pick<UserProfile, 'full_name' | 'preferred_name' | 'email'>): Promise<UserProfile> => {
  const res = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const updateProfilePicture = async (profilePicture: string | null): Promise<UserProfile> => {
  const res = await fetch('/api/profile/picture', {
    method: profilePicture ? 'PUT' : 'DELETE',
    headers: profilePicture ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
    body: profilePicture ? JSON.stringify({ profile_picture: profilePicture }) : undefined,
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