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

var taskSchemaCleanup = []string{
	"DROP INDEX IF EXISTS idx_tasks_column_position",
	"ALTER TABLE tasks DROP COLUMN IF EXISTS position",
	"ALTER TABLE tasks ADD COLUMN IF NOT EXISTS complete_by TIMESTAMPTZ",
	"ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ",
	"ALTER TABLE tasks ALTER COLUMN description DROP NOT NULL",
	"CREATE INDEX IF NOT EXISTS idx_tasks_column_priority ON tasks(column_id, priority)",
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
