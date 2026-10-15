UPDATE boards AS board
SET title = owner.full_name
FROM users AS owner
WHERE board.owner_id = owner.id AND board.is_personal;

ALTER TABLE boards
ALTER COLUMN title TYPE VARCHAR(100);

DROP INDEX IF EXISTS idx_boards_one_personal_per_owner;

ALTER TABLE boards
DROP COLUMN IF EXISTS is_personal;
