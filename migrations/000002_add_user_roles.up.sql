-- Use a simple text column with a check constraint for easy sqlc compatibility
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user'));