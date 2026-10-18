-- name: CountUsers :one
SELECT COUNT(*) FROM users;

-- name: CreateUser :one
INSERT INTO users (id, email, password_hash, full_name, preferred_name, role)
VALUES ($1, $2, $3, $4, $5, $6)
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

-- name: CreatePersonalBoard :one
INSERT INTO boards (title, owner_id, is_personal)
VALUES ($1, $2, TRUE)
RETURNING *;

-- name: CreateBoardMember :exec
INSERT INTO board_members (board_id, user_id)
VALUES ($1, $2)
ON CONFLICT (board_id, user_id) DO NOTHING;

-- name: GetBoardByID :one
SELECT * FROM boards
WHERE id = $1;

-- name: GetBoardMemberIDs :many
SELECT user_id FROM board_members
WHERE board_id = $1
ORDER BY user_id ASC;

-- name: DeleteBoardMembersExceptOwner :exec
DELETE FROM board_members AS member
USING boards AS board
WHERE member.board_id = board.id AND board.id = $1 AND member.user_id <> board.owner_id;

-- name: GetBoardByOwner :one
SELECT * FROM boards
WHERE owner_id = $1 OR EXISTS (
    SELECT 1 FROM board_members
    WHERE board_id = boards.id AND user_id = $1
)
ORDER BY created_at ASC, id ASC
LIMIT 1;

-- name: GetBoardsByOwner :many
SELECT board.* FROM boards AS board
LEFT JOIN user_board_order AS board_order
  ON board_order.board_id = board.id AND board_order.user_id = $1
WHERE board.owner_id = $1 OR EXISTS (
    SELECT 1 FROM board_members
    WHERE board_id = board.id AND user_id = $1
)
ORDER BY board_order.position ASC NULLS LAST, board.created_at ASC, board.id ASC;

-- name: DeleteUserBoardOrder :exec
DELETE FROM user_board_order
WHERE user_id = $1;

-- name: InsertUserBoardOrder :exec
INSERT INTO user_board_order (user_id, board_id, position)
VALUES ($1, $2, $3);

-- name: DeleteBoard :execrows
DELETE FROM boards AS board
WHERE board.id = $1 AND NOT board.is_personal AND (
    board.owner_id = $2 OR EXISTS (
        SELECT 1 FROM users AS user_account
        WHERE user_account.id = $2 AND user_account.role = 'admin'
    )
);

-- name: GetAllBoardsForAdmin :many
SELECT board.id, board.title, board.owner_id, board.is_personal,
       COALESCE(NULLIF(owner.preferred_name, ''), owner.full_name) AS full_name
FROM boards AS board
JOIN users AS owner ON owner.id = board.owner_id
ORDER BY board.title ASC, full_name ASC, board.id ASC;

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

-- name: MoveDueBacklogTasksToTodo :exec
WITH locked_boards AS MATERIALIZED (
    SELECT board.id,
           pg_advisory_xact_lock(hashtextextended(board.id::TEXT, 0))
    FROM boards AS board
    WHERE (
        board.owner_id = sqlc.arg(owner_id) OR EXISTS (
            SELECT 1 FROM board_members
            WHERE board_id = board.id AND user_id = sqlc.arg(owner_id)
        )
    )
      AND (
          sqlc.narg(board_id)::UUID IS NULL OR board.id = sqlc.narg(board_id)
      )
    ORDER BY board.id
), due_tasks AS (
    SELECT task.id,
           todo.id AS todo_column_id,
           ROW_NUMBER() OVER (
               PARTITION BY board.id
               ORDER BY task.complete_by ASC, task.created_at ASC, task.id ASC
           ) AS due_rank,
           GREATEST(5 - (
               SELECT COUNT(*)::INT
               FROM tasks AS todo_task
               JOIN columns AS todo_task_column ON todo_task_column.id = todo_task.column_id
               WHERE todo_task_column.board_id = board.id
                 AND todo_task.state = 'ToDo'
           ), 0) AS available_slots
    FROM tasks AS task
    JOIN columns AS backlog ON backlog.id = task.column_id
    JOIN boards AS board ON board.id = backlog.board_id
    JOIN locked_boards ON locked_boards.id = board.id
    JOIN columns AS todo ON todo.board_id = board.id
    WHERE task.state = 'Backlog'
      AND LOWER(TRIM(backlog.title)) = 'backlog'
      AND LOWER(TRIM(todo.title)) IN ('todo', 'to do', 'to-do')
      AND task.complete_by < NOW() + INTERVAL '2 days'
), tasks_to_move AS (
    SELECT id, todo_column_id
    FROM due_tasks
    WHERE due_rank <= available_slots
)
UPDATE tasks AS task
SET column_id = tasks_to_move.todo_column_id,
    state = 'ToDo',
    updated_at = NOW()
FROM tasks_to_move
WHERE task.id = tasks_to_move.id;

-- name: GetTasksByColumn :many
SELECT * FROM tasks
WHERE column_id = $1
ORDER BY CASE priority
    WHEN 'High' THEN 0
    WHEN 'Medium' THEN 1
    ELSE 2
END, created_at ASC;

-- name: GetInitiativesByUser :many
SELECT initiative.*,
       assignee.full_name AS assigned_to_name,
       COUNT(task.id) FILTER (WHERE
           task_board.owner_id = sqlc.arg(user_id) OR EXISTS (
               SELECT 1 FROM board_members
               WHERE board_id = task_board.id AND user_id = sqlc.arg(user_id)
           )
       )::INT AS task_count,
       COUNT(task.id) FILTER (WHERE task.state = 'Complete' AND (
           task_board.owner_id = sqlc.arg(user_id) OR EXISTS (
               SELECT 1 FROM board_members
               WHERE board_id = task_board.id AND user_id = sqlc.arg(user_id)
           )
       ))::INT AS completed_task_count
FROM initiatives AS initiative
LEFT JOIN users AS assignee ON assignee.id = initiative.assigned_to_id
LEFT JOIN initiative_tasks AS initiative_task ON initiative_task.initiative_id = initiative.id
LEFT JOIN tasks AS task ON task.id = initiative_task.task_id
LEFT JOIN columns AS task_column ON task_column.id = task.column_id
LEFT JOIN boards AS task_board ON task_board.id = task_column.board_id
WHERE initiative.created_by_id = sqlc.arg(user_id)
   OR initiative.assigned_to_id = sqlc.arg(user_id)
GROUP BY initiative.id, assignee.full_name
ORDER BY initiative.complete_by ASC NULLS LAST, initiative.created_at DESC;

-- name: GetInitiativeByIDAndUser :one
SELECT initiative.*
FROM initiatives AS initiative
WHERE initiative.id = sqlc.arg(initiative_id)
  AND (
      initiative.created_by_id = sqlc.arg(user_id)
      OR initiative.assigned_to_id = sqlc.arg(user_id)
  )
LIMIT 1;

-- name: CreateInitiative :one
INSERT INTO initiatives (title, description, complete_by, assigned_to_id, created_by_id)
VALUES (sqlc.arg(title), sqlc.narg(description), sqlc.narg(complete_by),
        sqlc.narg(assigned_to_id), sqlc.arg(created_by_id))
RETURNING *;

-- name: UpdateInitiative :one
UPDATE initiatives AS initiative
SET title = sqlc.arg(title),
    description = sqlc.narg(description),
    complete_by = sqlc.narg(complete_by),
    assigned_to_id = sqlc.narg(assigned_to_id),
    updated_at = NOW()
WHERE initiative.id = sqlc.arg(initiative_id)
  AND (
      initiative.created_by_id = sqlc.arg(user_id)
      OR initiative.assigned_to_id = sqlc.arg(user_id)
  )
RETURNING initiative.*;

-- name: GetTasksByInitiativeAndUser :many
SELECT task.*
FROM initiative_tasks AS initiative_task
JOIN tasks AS task ON task.id = initiative_task.task_id
JOIN columns AS task_column ON task_column.id = task.column_id
JOIN boards AS board ON board.id = task_column.board_id
WHERE initiative_task.initiative_id = sqlc.arg(initiative_id)
  AND (
      board.owner_id = sqlc.arg(user_id)
      OR EXISTS (
          SELECT 1 FROM board_members
          WHERE board_id = board.id AND user_id = sqlc.arg(user_id)
      )
  )
ORDER BY task.created_at ASC;

-- name: GetTaskByIDAndUser :one
SELECT task.*
FROM tasks AS task
JOIN columns AS task_column ON task_column.id = task.column_id
JOIN boards AS board ON board.id = task_column.board_id
WHERE task.id = sqlc.arg(task_id)
  AND (
      board.owner_id = sqlc.arg(user_id)
      OR EXISTS (
          SELECT 1 FROM board_members
          WHERE board_id = board.id AND user_id = sqlc.arg(user_id)
      )
  )
LIMIT 1;

-- name: AddTaskToInitiative :exec
INSERT INTO initiative_tasks (initiative_id, task_id)
VALUES (sqlc.arg(initiative_id), sqlc.arg(task_id))
ON CONFLICT (initiative_id, task_id) DO NOTHING;

-- name: RemoveTaskFromInitiative :execrows
DELETE FROM initiative_tasks AS initiative_task
WHERE initiative_task.initiative_id = sqlc.arg(initiative_id)
  AND initiative_task.task_id = sqlc.arg(task_id)
  AND EXISTS (
      SELECT 1 FROM initiatives AS initiative
      WHERE initiative.id = initiative_task.initiative_id
        AND (
            initiative.created_by_id = sqlc.arg(user_id)
            OR initiative.assigned_to_id = sqlc.arg(user_id)
        )
  );

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
    assigned_to_id = sqlc.narg(assigned_to_id),
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
SELECT id, COALESCE(NULLIF(preferred_name, ''), full_name) AS full_name
FROM users
ORDER BY full_name ASC, id ASC;

-- name: GetUsersForAdmin :many
SELECT id, full_name, preferred_name, email, role
FROM users
ORDER BY full_name ASC, id ASC;

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = $1
LIMIT 1;

-- name: GetUserForDeletion :one
SELECT * FROM users
WHERE id = $1
FOR UPDATE;

-- name: TransferUserBoards :exec
UPDATE boards
SET owner_id = $2,
    updated_at = NOW()
WHERE owner_id = $1 AND is_personal = FALSE;

-- name: DeleteUser :execrows
DELETE FROM users
WHERE id = $1 AND role = 'user';

-- name: UpdateUserRole :one
UPDATE users
SET role = $2,
    updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateUserProfile :one
WITH updated_user AS (
    UPDATE users
    SET email = $2,
        full_name = $3,
        preferred_name = $4,
        updated_at = NOW()
    WHERE users.id = $1
    RETURNING *
), renamed_personal_board AS (
    UPDATE boards AS board
    SET title = COALESCE(NULLIF(updated_user.preferred_name, ''), updated_user.full_name) || '''s personal board',
        updated_at = NOW()
    FROM updated_user
    WHERE board.owner_id = updated_user.id AND board.is_personal
)
SELECT updated_user.* FROM updated_user;

-- name: UpdateUserProfilePicture :one
UPDATE users
SET profile_picture = sqlc.narg(profile_picture)::TEXT,
    updated_at = NOW()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: UpdateUserPassword :exec
UPDATE users
SET password_hash = $2,
    updated_at = NOW()
WHERE id = $1;