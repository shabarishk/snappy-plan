package backend

import (
	"context"
	"fmt"
)

const ensureTaskSchema = `
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'tasks'
          AND column_name = 'state'
    ) THEN
        ALTER TABLE tasks ADD COLUMN state VARCHAR(20) NOT NULL DEFAULT 'Backlog';
        UPDATE tasks AS task
        SET state = CASE LOWER(TRIM(task_column.title))
            WHEN 'todo' THEN 'ToDo'
            WHEN 'to do' THEN 'ToDo'
            WHEN 'to-do' THEN 'ToDo'
            WHEN 'inprogress' THEN 'InProgress'
            WHEN 'in progress' THEN 'InProgress'
            WHEN 'in-progress' THEN 'InProgress'
            WHEN 'complete' THEN 'Complete'
            ELSE 'Backlog'
        END
        FROM columns AS task_column
        WHERE task_column.id = task.column_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_state_check'
    ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT tasks_state_check
        CHECK (state IN ('Backlog', 'ToDo', 'InProgress', 'Complete'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'tasks'
          AND column_name = 'priority'
    ) THEN
        ALTER TABLE tasks ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'Medium';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_priority_check'
    ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT tasks_priority_check
        CHECK (priority IN ('Low', 'Medium', 'High'));
    END IF;
END $$;
`

const ensureUserIDSchema = `
DO $$
DECLARE
    user_id_data_type TEXT;
BEGIN
    SELECT data_type INTO user_id_data_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'users'
      AND column_name = 'id';

    IF user_id_data_type = 'uuid' THEN
        ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_owner_id_fkey;
        ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assigned_to_id_fkey;
        ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_user_id_fkey;
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;

        ALTER TABLE users ALTER COLUMN id DROP DEFAULT;
        ALTER TABLE users ALTER COLUMN id TYPE VARCHAR(32) USING REPLACE(id::text, '-', '');
        ALTER TABLE boards ALTER COLUMN owner_id TYPE VARCHAR(32) USING REPLACE(owner_id::text, '-', '');
        ALTER TABLE tasks ALTER COLUMN assigned_to_id TYPE VARCHAR(32) USING REPLACE(assigned_to_id::text, '-', '');
        ALTER TABLE sessions ALTER COLUMN user_id TYPE VARCHAR(32) USING REPLACE(user_id::text, '-', '');

        ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
        ALTER TABLE boards ADD CONSTRAINT boards_owner_id_fkey
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
        ALTER TABLE tasks ADD CONSTRAINT tasks_assigned_to_id_fkey
            FOREIGN KEY (assigned_to_id) REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    ELSIF user_id_data_type IS NULL THEN
        RAISE EXCEPTION 'users.id column does not exist';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'users'::regclass AND conname = 'users_id_alphanumeric'
    ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_id_alphanumeric CHECK (id ~ '^[A-Za-z0-9]{1,32}$');
    END IF;
END $$;
`

var taskSchemaCleanup = []string{
	"DROP INDEX IF EXISTS idx_tasks_column_position",
	"ALTER TABLE tasks DROP COLUMN IF EXISTS position",
	"ALTER TABLE tasks ADD COLUMN IF NOT EXISTS complete_by TIMESTAMPTZ",
	"ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ",
	"ALTER TABLE tasks ALTER COLUMN description DROP NOT NULL",
	"CREATE INDEX IF NOT EXISTS idx_tasks_column_priority ON tasks(column_id, priority)",
}

var initiativeSchemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS initiatives (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		title VARCHAR(255) NOT NULL,
		description TEXT,
		complete_by TIMESTAMPTZ,
		assigned_to_id VARCHAR(32) REFERENCES users(id) ON DELETE SET NULL,
		created_by_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)`,
	`CREATE TABLE IF NOT EXISTS initiative_tasks (
		initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
		task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		PRIMARY KEY (initiative_id, task_id)
	)`,
	"CREATE INDEX IF NOT EXISTS idx_initiatives_assigned_to ON initiatives(assigned_to_id)",
	"CREATE INDEX IF NOT EXISTS idx_initiatives_created_by ON initiatives(created_by_id)",
	"CREATE INDEX IF NOT EXISTS idx_initiative_tasks_task ON initiative_tasks(task_id)",
}

func EnsureUserIDSchema(ctx context.Context, beginTx func(context.Context) (SetupTransaction, error)) error {
	tx, err := beginTx(ctx)
	if err != nil {
		return fmt.Errorf("begin user ID schema upgrade: %w", err)
	}
	defer tx.Rollback(context.Background())

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(731942612)); err != nil {
		return fmt.Errorf("lock user ID schema upgrade: %w", err)
	}
	if _, err := tx.Exec(ctx, ensureUserIDSchema); err != nil {
		return fmt.Errorf("apply user ID schema upgrade: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit user ID schema upgrade: %w", err)
	}
	return nil
}

func EnsurePersonalBoards(ctx context.Context, beginTx func(context.Context) (SetupTransaction, error)) error {
	tx, err := beginTx(ctx)
	if err != nil {
		return fmt.Errorf("begin personal board upgrade: %w", err)
	}
	defer tx.Rollback(context.Background())

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(731942613)); err != nil {
		return fmt.Errorf("lock personal board upgrade: %w", err)
	}
	if _, err := tx.Exec(ctx, "ALTER TABLE boards ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT FALSE"); err != nil {
		return fmt.Errorf("add personal board marker: %w", err)
	}
	if _, err := tx.Exec(ctx, "ALTER TABLE boards ALTER COLUMN title TYPE VARCHAR(120)"); err != nil {
		return fmt.Errorf("expand board title limit: %w", err)
	}
	if _, err := tx.Exec(ctx, `
			WITH ranked_boards AS (
				SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at, id) AS board_rank
				FROM boards
			)
			UPDATE boards
			SET is_personal = ranked_boards.board_rank = 1
			FROM ranked_boards
			WHERE boards.id = ranked_boards.id
	`); err != nil {
		return fmt.Errorf("mark existing personal boards: %w", err)
	}
	if _, err := tx.Exec(ctx, "CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_one_personal_per_owner ON boards(owner_id) WHERE is_personal"); err != nil {
		return fmt.Errorf("index personal boards: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE boards AS board
		SET title = COALESCE(NULLIF(user_account.preferred_name, ''), user_account.full_name) || '''s personal board',
		    updated_at = NOW()
		FROM users AS user_account
		WHERE board.owner_id = user_account.id AND board.is_personal
		  AND board.title IS DISTINCT FROM COALESCE(NULLIF(user_account.preferred_name, ''), user_account.full_name) || '''s personal board'
	`); err != nil {
		return fmt.Errorf("rename existing personal boards: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO boards (title, owner_id, is_personal)
		SELECT COALESCE(NULLIF(preferred_name, ''), full_name) || '''s personal board', id, TRUE
		FROM users AS user_account
		WHERE NOT EXISTS (
			SELECT 1 FROM boards WHERE owner_id = user_account.id AND is_personal
		)
	`); err != nil {
		return fmt.Errorf("create missing personal boards: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS board_members (
			board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
			user_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (board_id, user_id)
		)
	`); err != nil {
		return fmt.Errorf("create board access table: %w", err)
	}
	if _, err := tx.Exec(ctx, "CREATE INDEX IF NOT EXISTS idx_board_members_user ON board_members(user_id, board_id)"); err != nil {
		return fmt.Errorf("index board access table: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO board_members (board_id, user_id)
		SELECT id, owner_id FROM boards
		ON CONFLICT (board_id, user_id) DO NOTHING
	`); err != nil {
		return fmt.Errorf("grant board owner access: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit personal board upgrade: %w", err)
	}
	return nil
}

func EnsureTaskSchema(ctx context.Context, beginTx func(context.Context) (SetupTransaction, error)) error {
	tx, err := beginTx(ctx)
	if err != nil {
		return fmt.Errorf("begin task schema upgrade: %w", err)
	}
	defer tx.Rollback(context.Background())

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(731942611)); err != nil {
		return fmt.Errorf("lock task schema upgrade: %w", err)
	}
	for _, statement := range append([]string{ensureTaskSchema}, taskSchemaCleanup...) {
		if _, err := tx.Exec(ctx, statement); err != nil {
			return fmt.Errorf("apply task schema upgrade: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit task schema upgrade: %w", err)
	}
	return nil
}

func EnsureInitiativeSchema(ctx context.Context, beginTx func(context.Context) (SetupTransaction, error)) error {
	tx, err := beginTx(ctx)
	if err != nil {
		return fmt.Errorf("begin initiative schema upgrade: %w", err)
	}
	defer tx.Rollback(context.Background())

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(731942614)); err != nil {
		return fmt.Errorf("lock initiative schema upgrade: %w", err)
	}
	for _, statement := range initiativeSchemaStatements {
		if _, err := tx.Exec(ctx, statement); err != nil {
			return fmt.Errorf("apply initiative schema upgrade: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit initiative schema upgrade: %w", err)
	}
	return nil
}

func EnsureProfilePictureSchema(ctx context.Context, beginTx func(context.Context) (SetupTransaction, error)) error {
	tx, err := beginTx(ctx)
	if err != nil {
		return fmt.Errorf("begin profile picture schema upgrade: %w", err)
	}
	defer tx.Rollback(context.Background())

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(731942615)); err != nil {
		return fmt.Errorf("lock profile picture schema upgrade: %w", err)
	}
	if _, err := tx.Exec(ctx, "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT"); err != nil {
		return fmt.Errorf("apply profile picture schema upgrade: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit profile picture schema upgrade: %w", err)
	}
	return nil
}

func EnsurePreferredNameSchema(ctx context.Context, beginTx func(context.Context) (SetupTransaction, error)) error {
	tx, err := beginTx(ctx)
	if err != nil {
		return fmt.Errorf("begin preferred name schema upgrade: %w", err)
	}
	defer tx.Rollback(context.Background())

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", int64(731942616)); err != nil {
		return fmt.Errorf("lock preferred name schema upgrade: %w", err)
	}
	if _, err := tx.Exec(ctx, "ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_name VARCHAR(100) NOT NULL DEFAULT ''"); err != nil {
		return fmt.Errorf("apply preferred name schema upgrade: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit preferred name schema upgrade: %w", err)
	}
	return nil
}
