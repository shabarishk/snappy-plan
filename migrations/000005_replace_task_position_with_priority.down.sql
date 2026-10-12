DROP INDEX IF EXISTS idx_tasks_column_priority;

ALTER TABLE tasks
ADD COLUMN position INTEGER;

WITH ranked_tasks AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY column_id
               ORDER BY CASE priority
                   WHEN 'High' THEN 0
                   WHEN 'Medium' THEN 1
                   ELSE 2
               END, created_at ASC
           ) - 1 AS position
    FROM tasks
)
UPDATE tasks
SET position = ranked_tasks.position
FROM ranked_tasks
WHERE tasks.id = ranked_tasks.id;

ALTER TABLE tasks
ALTER COLUMN position SET NOT NULL,
DROP COLUMN priority;

CREATE INDEX idx_tasks_column_position ON tasks(column_id, position);
