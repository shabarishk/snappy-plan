# Snappy Plan

## Repository layout

- `backend/` contains the HTTP handlers and API router.
- `backend/tests/` contains backend HTTP unit tests.
- `cmd/snappy-plan/` contains the server executable.
- `dbgen/` is generated database access; `queries/` contains SQL queries and `migrations/` contains schema migrations.
- `frontend/src/` contains the React application, including the three-column Kanban board and the separate Backlog page.
- `frontend/tests/` contains frontend unit tests.

## Run locally

The React frontend is built into the Go server image and served by the same application container. Start the database and application from the repository root:

```powershell
docker compose -f docker-compose.local.yml up --build
```

The application (frontend and API) is available at `http://localhost:3000`.
On first use, choose a 1-32 character alphanumeric username; it is lowercased and stored as the account's unique user ID.
After signing in, use the sidebar Home button to return to the board and the user tile to open Profile or Settings. Profile lets you update your full name and email address; Settings is not active yet. Use **Create task** to add a task with a title, optional description, assignee, Backlog/ToDo state, priority, and optional completion date. Tasks are stored in PostgreSQL and loaded when the board opens.

## Run tests and coverage

Generate the database access code after cloning and whenever `sqlc.yaml`, `queries/`, or `migrations/` changes:

```powershell
go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1 generate
```

The generated files are ignored by Git. The Docker build and CI generate them automatically.

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

The initial schema in `migrations/000001_init_schema.up.sql` defines the task description and completion timestamp. Compose initialization scripts run only when PostgreSQL creates a new data directory. On application startup, the backend idempotently ensures the task `state` and `priority` columns and constraints exist, and removes the obsolete task position column, including for existing database volumes. Existing tasks without a priority default to `Medium`; the board orders them High to Low.
