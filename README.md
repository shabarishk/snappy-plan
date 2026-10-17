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
After signing in, use the sidebar Home button to return to the board and the user tile to open Profile, Settings, or log out. These pages have their own `/profile` and `/settings` URLs and remain selected after a refresh. Profile lets you update your full name, preferred name, and email address. Settings lets you change your password after verifying your current password. Administrators also have an Admin tile for creating users, promoting users, and deleting non-administrator accounts. When an account is deleted, tasks assigned to them on retained boards become unassigned, their personal board and its tasks are deleted, and their other boards transfer to the deleting administrator. Initiatives they created are deleted, while initiatives assigned to them are unassigned. New users are initially assigned their username as their full name and can update it on their Profile page. Each account receives a protected personal board named `<preferred name>'s personal board` (using the full name when no preferred name is set); changing the preferred name renames that board. Personal boards cannot be deleted by users or administrators. Use **Create task** to choose a board and add a task with a title, optional description, assignee, Backlog/ToDo state, priority, and optional completion date. Backlog tasks with a complete-by timestamp less than 48 hours away are automatically moved to ToDo when tasks are loaded. Tasks are stored in PostgreSQL and loaded when the board opens. Use **Initiatives** in the sidebar to create initiatives with a title, description, optional completion date, and assignee. Initiatives are independent of boards; open one to edit its details, attach tasks from boards you can access, and track progress by completed tasks.

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

The initial schema in `migrations/000001_init_schema.up.sql` defines the task description and completion timestamp. Compose initialization scripts run only when PostgreSQL creates a new data directory. On application startup, the backend idempotently ensures the task `state` and `priority` columns and constraints exist, removes the obsolete task position column, and creates personal boards for existing users who do not yet have one, including for existing database volumes. Existing tasks without a priority default to `Medium`; the board orders them High to Low.

## GitHub releases and Unraid

Publishing a GitHub Release whose tag follows `vMAJOR.MINOR.PATCH` (for example, `v1.2.0`) runs the release workflow. It runs backend and frontend checks, builds the application image for `linux/amd64` and `linux/arm64`, and publishes it to `ghcr.io/shabarishk/snappy-plan` with version, major, minor, and (for stable releases) `latest` tags. The source tag remains the versioned release record; deploy `:latest` for automatic updates or a version tag to pin an installation.

Before the first release:

1. In GitHub, open the published container package settings and change its visibility to **Public**. Unraid servers must be able to pull the image anonymously.
2. Decide on and add an OSI-approved license. Unraid Community Applications requires a public repository with an OSI-approved license and a valid `ca_profile.xml`; this repository currently has no license.
3. Create a version tag and publish a GitHub Release for that tag. Confirm the Release workflow succeeds and that the image tags appear in GitHub Packages.
4. Submit `https://github.com/shabarishk/snappy-plan` through the [Unraid Community Applications submission page](https://ca.unraid.net/submit/new). Validate and scan the repository template as part of submission.

The repository includes `templates/snappy-plan.xml` for the Unraid app and `ca_profile.xml` for the repository profile. The template installs only the application container; PostgreSQL is a separate prerequisite and must have persistent storage. Create the `snappyplan` database and apply only the `*.up.sql` files in `migrations/` in ascending numeric order to a new database before starting the application. Set `DATABASE_URL` in the template to the database's reachable connection URI. If PostgreSQL is another container, ensure the app can reach it on the Docker network; if it is hosted on Unraid, use its reachable address and PostgreSQL port. Do not expose PostgreSQL publicly.

Use HTTPS through a reverse proxy for remote access and leave `COOKIE_SECURE=true`. Keep the app and database backups, and back up PostgreSQL before installing an updated image. Startup applies some schema upgrades, but it does not automatically run every file in `migrations/`.
