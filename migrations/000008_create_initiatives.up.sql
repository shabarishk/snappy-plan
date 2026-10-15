CREATE TABLE initiatives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    complete_by TIMESTAMPTZ,
    assigned_to_id VARCHAR(32) REFERENCES users(id) ON DELETE SET NULL,
    created_by_id VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE initiative_tasks (
    initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (initiative_id, task_id)
);

CREATE INDEX idx_initiatives_assigned_to ON initiatives(assigned_to_id);
CREATE INDEX idx_initiatives_created_by ON initiatives(created_by_id);
CREATE INDEX idx_initiative_tasks_task ON initiative_tasks(task_id);
