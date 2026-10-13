BEGIN;

ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_owner_id_fkey;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assigned_to_id_fkey;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_user_id_fkey;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_alphanumeric;

ALTER TABLE users ALTER COLUMN id DROP DEFAULT;
ALTER TABLE users ALTER COLUMN id TYPE VARCHAR(32) USING REPLACE(id::text, '-', '');
ALTER TABLE boards ALTER COLUMN owner_id TYPE VARCHAR(32) USING REPLACE(owner_id::text, '-', '');
ALTER TABLE tasks ALTER COLUMN assigned_to_id TYPE VARCHAR(32) USING REPLACE(assigned_to_id::text, '-', '');
ALTER TABLE sessions ALTER COLUMN user_id TYPE VARCHAR(32) USING REPLACE(user_id::text, '-', '');

ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE users ADD CONSTRAINT users_id_alphanumeric CHECK (id ~ '^[A-Za-z0-9]{1,32}$');
ALTER TABLE boards ADD CONSTRAINT boards_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD CONSTRAINT tasks_assigned_to_id_fkey
    FOREIGN KEY (assigned_to_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

COMMIT;
