-- name: CountUsers :one
SELECT COUNT(*) FROM users;

-- name: CreateUser :one
INSERT INTO users (id, email, password_hash, full_name, role)
VALUES ($1, $2, $3, $4, $5)
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

-- name: DeleteSession :exec
DELETE FROM sessions
WHERE token = $1;

-- name: CreateBoard :one
INSERT INTO boards (title, owner_id)
VALUES ($1, $2)
RETURNING *;

-- name: CreateBoardMember :exec
INSERT INTO board_members (board_id, user_id)
VALUES ($1, $2)
ON CONFLICT (board_id, user_id) DO NOTHING;

-- name: GetBoardByOwner :one
SELECT * FROM boards
WHERE owner_id = $1 OR EXISTS (
    SELECT 1 FROM board_members
    WHERE board_id = boards.id AND user_id = $1
)
ORDER BY created_at ASC, id ASC
LIMIT 1;

-- name: GetBoardsByOwner :many
SELECT * FROM boards
WHERE owner_id = $1 OR EXISTS (
    SELECT 1 FROM board_members
    WHERE board_id = boards.id AND user_id = $1
)
ORDER BY created_at ASC, id ASC;

-- name: DeleteBoard :execrows
DELETE FROM boards
WHERE id = $1 AND owner_id = $2;

-- name: GetAllBoardsForAdmin :many
SELECT board.id, board.title, board.owner_id, owner.full_name
FROM boards AS board
JOIN users AS owner ON owner.id = board.owner_id
ORDER BY board.title ASC, owner.full_name ASC, board.id ASC;

-- name: GetBoardByIDAndOwner :one
SELECT * FROM boards
WHERE id = sqlc.arg(board_id) AND (
    owner_id = sqlc.arg(owner_id) OR EXISTS (
        SELECT 1 FROM board_members
        WHERE board_id = boards.id AND user_id = sqlc.arg(owner_id)
    )
)
LIMIT 1;

-- name: GetBoardByTaskAndOwner :one
SELECT board.*
FROM tasks AS task
JOIN columns AS task_column ON task_column.id = task.column_id
JOIN boards AS board ON board.id = task_column.board_id
WHERE task.id = sqlc.arg(task_id)
  AND (
      board.owner_id = sqlc.arg(owner_id) OR EXISTS (
          SELECT 1 FROM board_members
          WHERE board_id = board.id AND user_id = sqlc.arg(owner_id)
      )
  )
LIMIT 1;

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

-- name: GetColumnByBoardAndTitle :one
SELECT * FROM columns
WHERE board_id = sqlc.arg(board_id) AND LOWER(TRIM(title)) = LOWER(TRIM(sqlc.arg(title)))
LIMIT 1;

-- name: CreateTask :one
INSERT INTO tasks (column_id, state, title, description, priority, assigned_to_id, complete_by)
VALUES (
       sqlc.arg(column_id),
       sqlc.arg(state),
       sqlc.arg(title),
       sqlc.narg(description),
       sqlc.arg(priority),
       sqlc.narg(assigned_to_id),
       sqlc.narg(complete_by)
)
RETURNING *;

-- name: GetTasksByOwner :many
SELECT task.*
FROM tasks AS task
JOIN columns AS task_column ON task_column.id = task.column_id
JOIN boards AS board ON board.id = task_column.board_id
WHERE board.owner_id = $1 OR EXISTS (
    SELECT 1 FROM board_members
    WHERE board_id = board.id AND user_id = $1
)
ORDER BY CASE task.priority
    WHEN 'High' THEN 0
    WHEN 'Medium' THEN 1
    ELSE 2
END, task.created_at ASC;

-- name: GetTasksByBoard :many
SELECT task.*
FROM tasks AS task
JOIN columns AS task_column ON task_column.id = task.column_id
WHERE task_column.board_id = $1
ORDER BY CASE task.priority
    WHEN 'High' THEN 0
    WHEN 'Medium' THEN 1
    ELSE 2
END, task.created_at ASC;

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
  AND EXISTS (
      SELECT 1
      FROM columns AS task_column
      JOIN boards AS task_board ON task_board.id = task_column.board_id
      WHERE task_column.id = task.column_id
        AND (
            task_board.owner_id = $3 OR EXISTS (
                SELECT 1 FROM board_members
                WHERE board_id = task_board.id AND user_id = $3
            )
        )
  )
  AND EXISTS (
      SELECT 1
      FROM boards AS destination_board
      WHERE destination_board.id = (
          SELECT destination.board_id
          FROM columns AS destination
          WHERE destination.id = $1
      )
        AND (
            destination_board.owner_id = $3 OR EXISTS (
                SELECT 1 FROM board_members
                WHERE board_id = destination_board.id AND user_id = $3
            )
        )
  )
RETURNING task.*;

-- name: UpdateTask :one
UPDATE tasks AS task
SET column_id = sqlc.arg(column_id),
    state = sqlc.arg(state),
    title = sqlc.arg(title),
    description = sqlc.narg(description),
    priority = sqlc.arg(priority),
    complete_by = sqlc.narg(complete_by),
    updated_at = NOW(),
    completed_at = CASE
        WHEN sqlc.arg(state)::VARCHAR = 'Complete' THEN COALESCE(task.completed_at, NOW())
        ELSE NULL
    END
WHERE task.id = sqlc.arg(task_id)
  AND EXISTS (
      SELECT 1
      FROM columns AS task_column
      JOIN boards AS task_board ON task_board.id = task_column.board_id
      WHERE task_column.id = task.column_id
        AND (
            task_board.owner_id = sqlc.arg(owner_id) OR EXISTS (
                SELECT 1 FROM board_members
                WHERE board_id = task_board.id AND user_id = sqlc.arg(owner_id)
            )
        )
  )
  AND EXISTS (
      SELECT 1
      FROM columns AS destination
      JOIN boards AS destination_board ON destination_board.id = destination.board_id
      WHERE destination.id = sqlc.arg(column_id)
        AND (
            destination_board.owner_id = sqlc.arg(owner_id) OR EXISTS (
                SELECT 1 FROM board_members
                WHERE board_id = destination_board.id AND user_id = sqlc.arg(owner_id)
            )
        )
  )
RETURNING task.*;

-- name: GetUsersForAssignment :many
SELECT id, full_name
FROM users
ORDER BY full_name ASC, id ASC;

-- name: GetUsersForAdmin :many
SELECT id, full_name, email, role
FROM users
ORDER BY full_name ASC, id ASC;

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = $1
LIMIT 1;

-- name: UpdateUserRole :one
UPDATE users
SET role = $2,
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateUserProfile :one
UPDATE users
SET email = $2,
    full_name = $3,
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateUserPassword :exec
UPDATE users
SET password_hash = $2,
    updated_at = NOW()
WHERE id = $1;