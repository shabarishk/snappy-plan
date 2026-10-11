-- name: CreateUser :one
INSERT INTO users (email, password_hash, full_name)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = $1 LIMIT 1;

-- name: CreateBoard :one
INSERT INTO boards (title, owner_id)
VALUES ($1, $2)
RETURNING *;

-- name: GetBoardWithColumns :many
SELECT 
    b.id as board_id, b.title as board_title,
    c.id as column_id, c.title as column_title, c.position as column_position
FROM boards b
LEFT JOIN columns c ON c.board_id = b.id
WHERE b.id = $1
ORDER BY c.position ASC;

-- name: CreateColumn :one
INSERT INTO columns (board_id, title, position)
VALUES ($1, $2, $3)
RETURNING *;

-- name: CreateTask :one
INSERT INTO tasks (column_id, title, description, position, assigned_to_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetTasksByColumn :many
SELECT * FROM tasks
WHERE column_id = $1
ORDER BY position ASC;

-- name: MoveTask :one
UPDATE tasks
SET column_id = $1, position = $2, updated_at = NOW()
WHERE id = $3
RETURNING *;