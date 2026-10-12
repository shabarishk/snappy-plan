DROP INDEX IF EXISTS idx_tasks_column_position;

ALTER TABLE tasks
DROP COLUMN position,
ADD COLUMN priority VARCHAR(10) NOT NULL DEFAULT 'Medium'
CHECK (priority IN ('Low', 'Medium', 'High'));

CREATE INDEX idx_tasks_column_priority ON tasks(column_id, priority);
