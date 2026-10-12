ALTER TABLE tasks
ADD COLUMN state VARCHAR(20) NOT NULL DEFAULT 'Backlog'
CHECK (state IN ('Backlog', 'ToDo', 'InProgress', 'Complete'));

UPDATE tasks AS task
SET state = CASE LOWER(TRIM(column_row.title))
    WHEN 'todo' THEN 'ToDo'
    WHEN 'to do' THEN 'ToDo'
    WHEN 'to-do' THEN 'ToDo'
    WHEN 'inprogress' THEN 'InProgress'
    WHEN 'in progress' THEN 'InProgress'
    WHEN 'in-progress' THEN 'InProgress'
    WHEN 'complete' THEN 'Complete'
    ELSE 'Backlog'
END
FROM columns AS column_row
WHERE column_row.id = task.column_id;
