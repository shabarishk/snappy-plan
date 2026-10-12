# Snappy Plan

## Repository layout

- `backend/` contains the HTTP handlers and API router.
- `backend/tests/` contains backend HTTP unit tests.
- `cmd/snappy-plan/` contains the server executable.
- `dbgen/`, `queries/`, and `migrations/` contain generated database access, SQL queries, and schema migrations.
- `frontend/src/` contains the React application, including the three-column Kanban board and the separate Backlog page.
- `frontend/tests/` contains frontend unit tests.

## Run locally

The React frontend is built into the Go server image and served by the same application container. Start the database and application from the repository root:

```powershell
docker compose -f docker-compose.local.yml up --build
```

The application (frontend and API) is available at `http://localhost:3000`.

## Run tests and coverage

Run backend tests:

```powershell
go test ./...
```

Measure coverage for the backend package using its external HTTP tests:

```powershell
go test -coverpkg=snappy-plan/backend ./backend/tests
```

Run frontend tests and enforce the configured statement coverage threshold:

```powershell
cd frontend
npm run test:coverage
```

Coverage reports are generated under `frontend/coverage/`; they are local test artifacts and should not be committed.

The initial schema in `migrations/000001_init_schema.up.sql` defines the task description and completion timestamp. Compose initialization scripts run only when PostgreSQL creates a new data directory. For an existing database, apply the required schema changes manually before deploying: `ALTER TABLE tasks ALTER COLUMN description DROP NOT NULL; ALTER TABLE tasks ADD COLUMN completed_at TIMESTAMPTZ;`. Also apply `migrations/000004_add_task_state.up.sql` to add a `state` field constrained to `Backlog`, `ToDo`, `InProgress`, or `Complete`, then apply `migrations/000005_replace_task_position_with_priority.up.sql` to replace task ordering with a priority field constrained to `Low`, `Medium`, or `High`. Existing tasks default to `Medium`; the board orders them High to Low.
