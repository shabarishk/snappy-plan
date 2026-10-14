CREATE TABLE board_members (
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (board_id, user_id)
);

CREATE INDEX idx_board_members_user ON board_members(user_id, board_id);

INSERT INTO board_members (board_id, user_id)
SELECT id, owner_id FROM boards
ON CONFLICT (board_id, user_id) DO NOTHING;
