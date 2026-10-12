-- name: CountUsers :one
SELECT COUNT(*) FROM users;

-- name: CreateUser :one
INSERT INTO users (email, password_hash, full_name, role)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = $1 LIMIT 1;

-- name: CreateSession :one
INSERT INTO sessions (token, user_id, expires_at)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetSession :one
SELECT * FROM sessions
WHERE token = $1 AND expires_at > NOW();

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
INSERT INTO tasks (column_id, state, title, description, priority, assigned_to_id)
VALUES (
       sqlc.arg(column_id),
       CASE (
           SELECT LOWER(TRIM(task_column.title))
           FROM columns AS task_column
           WHERE task_column.id = sqlc.arg(column_id)
       )
           WHEN 'todo' THEN 'ToDo'
           WHEN 'to do' THEN 'ToDo'
           WHEN 'to-do' THEN 'ToDo'
           WHEN 'inprogress' THEN 'InProgress'
           WHEN 'in progress' THEN 'InProgress'
           WHEN 'in-progress' THEN 'InProgress'
           WHEN 'complete' THEN 'Complete'
           ELSE 'Backlog'
       END,
       sqlc.arg(title),
       sqlc.narg(description),
       sqlc.arg(priority),
       sqlc.narg(assigned_to_id)
)
RETURNING *;

-- name: GetTasksByColumn :many
SELECT * FROM tasks
WHERE column_id = $1
ORDER BY CASE priority
    WHEN 'High' THEN 0
    WHEN 'Medium' THEN 1
    ELSE 2
END, created_at ASC;

-- name: MoveTask :one
UPDATE tasks AS task
SET column_id = $1,
    state = CASE (
        SELECT LOWER(TRIM(destination.title))
        FROM columns AS destination
        WHERE destination.id = $1
    )
        WHEN 'todo' THEN 'ToDo'
        WHEN 'to do' THEN 'ToDo'
        WHEN 'to-do' THEN 'ToDo'
        WHEN 'inprogress' THEN 'InProgress'
        WHEN 'in progress' THEN 'InProgress'
        WHEN 'in-progress' THEN 'InProgress'
        WHEN 'complete' THEN 'Complete'
        ELSE 'Backlog'
    END,
    updated_at = NOW(),
    completed_at = CASE
        WHEN EXISTS (
            SELECT 1
            FROM columns AS destination
            WHERE destination.id = $1 AND LOWER(TRIM(destination.title)) = 'complete'
        ) THEN COALESCE(task.completed_at, NOW())
        ELSE NULL
    END
WHERE task.id = $2
RETURNING task.*;