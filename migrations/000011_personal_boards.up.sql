ALTER TABLE boards
ALTER COLUMN title TYPE VARCHAR(120);

ALTER TABLE boards
ADD COLUMN is_personal BOOLEAN NOT NULL DEFAULT FALSE;

WITH ranked_boards AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at, id) AS board_rank
    FROM boards
)
UPDATE boards
SET is_personal = ranked_boards.board_rank = 1
FROM ranked_boards
WHERE boards.id = ranked_boards.id;

CREATE UNIQUE INDEX idx_boards_one_personal_per_owner
ON boards(owner_id)
WHERE is_personal;

UPDATE boards AS board
SET title = COALESCE(NULLIF(user_account.preferred_name, ''), user_account.full_name) || '''s personal board',
    updated_at = NOW()
FROM users AS user_account
WHERE board.owner_id = user_account.id AND board.is_personal;
