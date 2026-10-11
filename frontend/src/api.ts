// frontend/src/api.ts

// 1. Define types matching your Go structs
export interface Board {
  board_id: string;
  title: string;
  owner_id: string;
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