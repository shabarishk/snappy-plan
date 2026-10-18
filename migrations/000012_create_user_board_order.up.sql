CREATE TABLE user_board_order (
    user_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    position INT NOT NULL CHECK (position >= 0),
    PRIMARY KEY (user_id, board_id)
);
