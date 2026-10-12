package backend_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"snappy-plan/backend"
	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

type fakeDB struct {
	count              int64
	countErr           error
	user               dbgen.User
	userErr            error
	session            dbgen.Session
	sessionErr         error
	board              dbgen.Board
	boardErr           error
	column             dbgen.Column
	columnErr          error
	task               dbgen.Task
	createTaskErr      error
	createColumnErr    error
	moveTaskErr        error
	assignees          []dbgen.GetUsersForAssignmentRow
	tasks              []dbgen.Task
	boardArgs          []any
	columnArgs         []any
	taskArgs           []any
	moveTaskArgs       []any
	sessionArgs        []any
	createUserArgs     []any
	createBoardErr     error
	createSessionError error
	createUserError    error
}

func (db *fakeDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (db *fakeDB) Query(_ context.Context, query string, _ ...any) (pgx.Rows, error) {
	switch {
	case strings.Contains(query, "FROM tasks AS task"):
		rows := make([][]any, len(db.tasks))
		for i, task := range db.tasks {
			rows[i] = taskValues(task)
		}
		return &fakeRows{values: rows}, nil
	case strings.Contains(query, "SELECT id, full_name"):
		rows := make([][]any, len(db.assignees))
		for i, user := range db.assignees {
			rows[i] = []any{user.ID, user.FullName}
		}
		return &fakeRows{values: rows}, nil
	default:
		return nil, errors.New("unexpected query: " + query)
	}
}

func (db *fakeDB) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	switch {
	case strings.Contains(query, "SELECT COUNT(*) FROM users"):
		return fakeRow{values: []any{db.count}, err: db.countErr}
	case strings.Contains(query, "FROM users") && strings.Contains(query, "WHERE email"):
		return fakeRow{values: []any{
			db.user.ID, db.user.Email, db.user.PasswordHash, db.user.FullName,
			db.user.Role, db.user.CreatedAt, db.user.UpdatedAt,
		}, err: db.userErr}
	case strings.Contains(query, "FROM users") && strings.Contains(query, "WHERE id"):
		return fakeRow{values: []any{
			db.user.ID, db.user.Email, db.user.PasswordHash, db.user.FullName,
			db.user.Role, db.user.CreatedAt, db.user.UpdatedAt,
		}, err: db.userErr}
	case strings.Contains(query, "FROM tasks AS task") && strings.Contains(query, "WHERE task.id"):
		return fakeRow{values: []any{
			db.board.ID, db.board.Title, db.board.OwnerID, db.board.CreatedAt, db.board.UpdatedAt,
		}, err: db.boardErr}
	case strings.Contains(query, "FROM boards") && strings.Contains(query, "WHERE owner_id"):
		return fakeRow{values: []any{
			db.board.ID, db.board.Title, db.board.OwnerID, db.board.CreatedAt, db.board.UpdatedAt,
		}, err: db.boardErr}
	case strings.Contains(query, "FROM columns") && strings.Contains(query, "WHERE board_id"):
		return fakeRow{values: []any{
			db.column.ID, db.column.BoardID, db.column.Title, db.column.Position, db.column.CreatedAt,
		}, err: db.columnErr}
	case strings.Contains(query, "FROM sessions"):
		return fakeRow{values: []any{db.session.Token, db.session.UserID, db.session.ExpiresAt}, err: db.sessionErr}
	case strings.Contains(query, "INSERT INTO sessions"):
		db.sessionArgs = args
		if db.createSessionError != nil {
			return fakeRow{err: db.createSessionError}
		}
		return fakeRow{values: []any{args[0], args[1], args[2]}}
	case strings.Contains(query, "INSERT INTO boards"):
		db.boardArgs = args
		if db.createBoardErr != nil {
			return fakeRow{err: db.createBoardErr}
		}
		return fakeRow{values: []any{
			db.board.ID, db.board.Title, db.board.OwnerID, db.board.CreatedAt, db.board.UpdatedAt,
		}}
	case strings.Contains(query, "INSERT INTO columns"):
		db.columnArgs = args
		if db.createColumnErr != nil {
			return fakeRow{err: db.createColumnErr}
		}
		return fakeRow{values: []any{
			db.column.ID, args[0], args[1], args[2], db.column.CreatedAt,
		}}
	case strings.Contains(query, "INSERT INTO tasks"):
		db.taskArgs = args
		if db.createTaskErr != nil {
			return fakeRow{err: db.createTaskErr}
		}
		db.task.ID = newUUID(9)
		db.task.ColumnID = args[0].(pgtype.UUID)
		db.task.State = args[1].(string)
		db.task.Title = args[2].(string)
		db.task.Description = args[3].(pgtype.Text)
		db.task.Priority = args[4].(string)
		db.task.AssignedToID = args[5].(pgtype.UUID)
		db.task.CompleteBy = args[6].(pgtype.Timestamptz)
		return fakeRow{values: taskValues(db.task)}
	case strings.Contains(query, "UPDATE tasks AS task"):
		db.moveTaskArgs = args
		if db.moveTaskErr != nil {
			return fakeRow{err: db.moveTaskErr}
		}
		db.task.ColumnID = args[0].(pgtype.UUID)
		db.task.State = map[string]string{
			"Backlog":     "Backlog",
			"To Do":       "ToDo",
			"In Progress": "InProgress",
			"Complete":    "Complete",
		}[db.column.Title]
		if db.task.State == "Complete" {
			db.task.CompletedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
		} else {
			db.task.CompletedAt = pgtype.Timestamptz{}
		}
		return fakeRow{values: taskValues(db.task)}
	case strings.Contains(query, "INSERT INTO users"):
		db.createUserArgs = args
		if db.createUserError != nil {
			return fakeRow{err: db.createUserError}
		}
		return fakeRow{values: []any{
			db.user.ID, args[0], args[1], args[2], args[3],
			db.user.CreatedAt, db.user.UpdatedAt,
		}}
	default:
		return fakeRow{err: errors.New("unexpected query: " + query)}
	}
}

type fakeRow struct {
	values []any
	err    error
}

func (row fakeRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) != len(row.values) {
		return errors.New("unexpected number of scan destinations")
	}
	for i, value := range row.values {
		switch target := dest[i].(type) {
		case *int64:
			*target = value.(int64)
		case *string:
			*target = value.(string)
		case *int32:
			*target = value.(int32)
		case *pgtype.UUID:
			*target = value.(pgtype.UUID)
		case *pgtype.Text:
			*target = value.(pgtype.Text)
		case *pgtype.Timestamptz:
			*target = value.(pgtype.Timestamptz)
		default:
			return errors.New("unexpected scan destination")
		}
	}
	return nil
}

func taskValues(task dbgen.Task) []any {
	return []any{
		task.ID, task.ColumnID, task.Title, task.Description, task.AssignedToID,
		task.CreatedAt, task.UpdatedAt, task.CompleteBy, task.CompletedAt, task.State, task.Priority,
	}
}

type fakeRows struct {
	values [][]any
	index  int
}

func (rows *fakeRows) Close()                                  {}
func (rows *fakeRows) Err() error                              { return nil }
func (*fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (*fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (rows *fakeRows) Next() bool {
	if rows.index >= len(rows.values) {
		return false
	}
	rows.index++
	return true
}
func (rows *fakeRows) Scan(dest ...any) error {
	if rows.index == 0 || rows.index > len(rows.values) {
		return errors.New("Scan called without a current row")
	}
	return (fakeRow{values: rows.values[rows.index-1]}).Scan(dest...)
}
func (*fakeRows) Values() ([]any, error) { return nil, errors.New("unexpected Values") }
func (*fakeRows) RawValues() [][]byte    { return nil }
func (*fakeRows) Conn() *pgx.Conn        { return nil }
func (*fakeRows) TypeMap() *pgtype.Map   { return nil }

type fakeTx struct {
	*fakeDB
	committed  bool
	rolledBack bool
	execErr    error
	commitErr  error
}

func (tx *fakeTx) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, tx.execErr
}

func (tx *fakeTx) Commit(context.Context) error {
	tx.committed = true
	return tx.commitErr
}

func (tx *fakeTx) Rollback(context.Context) error {
	tx.rolledBack = true
	return nil
}

func newUUID(value byte) pgtype.UUID {
	return pgtype.UUID{Bytes: [16]byte{value}, Valid: true}
}

func newUser(password string) dbgen.User {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		panic(err)
	}
	now := time.Now()
	return dbgen.User{
		ID:           newUUID(1),
		Email:        "admin@example.com",
		PasswordHash: string(hash),
		FullName:     "Admin User",
		Role:         "admin",
		CreatedAt:    pgtype.Timestamptz{Time: now, Valid: true},
		UpdatedAt:    pgtype.Timestamptz{Time: now, Valid: true},
	}
}

func newHandler(db *fakeDB, beginTx func(context.Context) (backend.SetupTransaction, error), secureCookie bool) http.Handler {
	return backend.NewHandler(db, beginTx, secureCookie, fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<main>Snappy Plan</main>")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('app')")},
	})
}

func send(handler http.Handler, method, target, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestSetupStatusEndpoint(t *testing.T) {
	for _, test := range []struct {
		name          string
		count         int64
		countErr      error
		setupRequired bool
		wantStatus    int
	}{
		{name: "empty table", setupRequired: true, wantStatus: http.StatusOK},
		{name: "existing user", count: 1, setupRequired: false, wantStatus: http.StatusOK},
		{name: "database failure", countErr: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := send(newHandler(&fakeDB{count: test.count, countErr: test.countErr}, nil, false),
				http.MethodGet, "/api/setup/status", "", nil)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if response.Code == http.StatusOK {
				var body map[string]bool
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
					t.Fatalf("decode setup response: %v", err)
				}
				if body["setup_required"] != test.setupRequired {
					t.Fatalf("setup_required = %t, want %t", body["setup_required"], test.setupRequired)
				}
			}
		})
	}
}

func TestSetupEndpoint(t *testing.T) {
	validBody := `{"email":"admin@example.com","full_name":"Admin User","password":"password123"}`

	t.Run("validates request", func(t *testing.T) {
		for _, body := range []string{
			`{`,
			`{"email":"not-an-email","full_name":"Admin","password":"password123"}`,
			`{"email":"admin@example.com","full_name":" ","password":"password123"}`,
			`{"email":"admin@example.com","full_name":"Admin","password":"short"}`,
			strings.Repeat("x", (1<<20)+1),
		} {
			response := send(newHandler(&fakeDB{}, nil, false), http.MethodPost, "/api/setup", body, nil)
			if response.Code != http.StatusBadRequest {
				t.Errorf("status for invalid body = %d, want %d", response.Code, http.StatusBadRequest)
			}
		}
	})

	t.Run("creates admin", func(t *testing.T) {
		txDB := &fakeDB{user: newUser("")}
		tx := &fakeTx{fakeDB: txDB}
		handler := newHandler(&fakeDB{}, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		response := send(handler, http.MethodPost, "/api/setup", validBody, nil)
		if response.Code != http.StatusCreated || !tx.committed || txDB.createUserArgs[3] != "admin" {
			t.Fatalf("status = %d; committed = %t; args = %#v", response.Code, tx.committed, txDB.createUserArgs)
		}
		if err := bcrypt.CompareHashAndPassword([]byte(txDB.createUserArgs[1].(string)), []byte("password123")); err != nil {
			t.Fatalf("password was not securely hashed: %v", err)
		}
	})

	t.Run("blocks duplicate setup", func(t *testing.T) {
		tx := &fakeTx{fakeDB: &fakeDB{count: 1}}
		handler := newHandler(&fakeDB{}, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		response := send(handler, http.MethodPost, "/api/setup", validBody, nil)
		if response.Code != http.StatusForbidden || tx.committed {
			t.Fatalf("status = %d; committed = %t", response.Code, tx.committed)
		}
	})

	t.Run("reports transaction failures", func(t *testing.T) {
		tests := []struct {
			name  string
			begin func(context.Context) (backend.SetupTransaction, error)
		}{
			{name: "begin", begin: func(context.Context) (backend.SetupTransaction, error) { return nil, errors.New("begin failed") }},
			{name: "advisory lock", begin: func(context.Context) (backend.SetupTransaction, error) {
				return &fakeTx{fakeDB: &fakeDB{}, execErr: errors.New("lock failed")}, nil
			}},
			{name: "count", begin: func(context.Context) (backend.SetupTransaction, error) {
				return &fakeTx{fakeDB: &fakeDB{countErr: errors.New("count failed")}}, nil
			}},
			{name: "insert", begin: func(context.Context) (backend.SetupTransaction, error) {
				return &fakeTx{fakeDB: &fakeDB{createUserError: errors.New("insert failed")}}, nil
			}},
			{name: "commit", begin: func(context.Context) (backend.SetupTransaction, error) {
				return &fakeTx{fakeDB: &fakeDB{user: newUser("")}, commitErr: errors.New("commit failed")}, nil
			}},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				response := send(newHandler(&fakeDB{}, test.begin, false), http.MethodPost, "/api/setup", validBody, nil)
				if response.Code != http.StatusInternalServerError {
					t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
				}
			})
		}
	})
}

func TestLoginAndAuthStatusEndpoints(t *testing.T) {
	t.Run("login sets secure session cookie", func(t *testing.T) {
		db := &fakeDB{user: newUser("password123")}
		response := send(newHandler(db, nil, true), http.MethodPost, "/api/login",
			`{"email":" admin@example.com ","password":"password123"}`, nil)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
		}
		cookie := response.Result().Cookies()[0]
		if cookie.Name != "snappy_session" || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode {
			t.Fatalf("unexpected session cookie: %#v", cookie)
		}
		if db.sessionArgs[1] != db.user.ID || len(db.sessionArgs[0].(string)) < 40 {
			t.Fatalf("session not bound to authenticated user or token too short: %#v", db.sessionArgs)
		}
	})

	for _, test := range []struct {
		name string
		db   *fakeDB
		body string
		want int
	}{
		{name: "bad JSON", db: &fakeDB{}, body: `{`, want: http.StatusBadRequest},
		{name: "empty email", db: &fakeDB{}, body: `{"email":" ","password":"password123"}`, want: http.StatusUnauthorized},
		{name: "unknown user", db: &fakeDB{userErr: pgx.ErrNoRows}, body: `{"email":"nobody@example.com","password":"password123"}`, want: http.StatusUnauthorized},
		{name: "wrong password", db: &fakeDB{user: newUser("correct-password")}, body: `{"email":"admin@example.com","password":"incorrect"}`, want: http.StatusUnauthorized},
		{name: "database error", db: &fakeDB{userErr: errors.New("database unavailable")}, body: `{"email":"admin@example.com","password":"password123"}`, want: http.StatusInternalServerError},
		{name: "session insert error", db: &fakeDB{user: newUser("password123"), createSessionError: errors.New("write failed")}, body: `{"email":"admin@example.com","password":"password123"}`, want: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := send(newHandler(test.db, nil, false), http.MethodPost, "/api/login", test.body, nil)
			if response.Code != test.want {
				t.Fatalf("status = %d, want %d", response.Code, test.want)
			}
		})
	}

	for _, test := range []struct {
		name          string
		session       dbgen.Session
		sessionErr    error
		cookie        *http.Cookie
		wantStatus    int
		authenticated bool
	}{
		{name: "no cookie", wantStatus: http.StatusOK},
		{name: "valid session", session: dbgen.Session{Token: "token"}, cookie: &http.Cookie{Name: "snappy_session", Value: "token"}, wantStatus: http.StatusOK, authenticated: true},
		{name: "unknown session", sessionErr: pgx.ErrNoRows, cookie: &http.Cookie{Name: "snappy_session", Value: "token"}, wantStatus: http.StatusOK},
		{name: "database error", sessionErr: errors.New("database unavailable"), cookie: &http.Cookie{Name: "snappy_session", Value: "token"}, wantStatus: http.StatusInternalServerError},
	} {
		t.Run("auth status "+test.name, func(t *testing.T) {
			response := send(newHandler(&fakeDB{session: test.session, sessionErr: test.sessionErr}, nil, false),
				http.MethodGet, "/api/auth/status", "", test.cookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if test.wantStatus == http.StatusOK {
				var body map[string]bool
				if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
					t.Fatalf("decode response: %v", err)
				}
				if body["authenticated"] != test.authenticated {
					t.Fatalf("authenticated = %t, want %t", body["authenticated"], test.authenticated)
				}
			}
		})
	}
}

func TestCreateBoardEndpoint(t *testing.T) {
	t.Run("requires a session", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPost, "/api/boards", `{"title":"Board"}`, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	for _, test := range []struct {
		name       string
		body       string
		sessionErr error
		boardErr   error
		wantStatus int
	}{
		{name: "database session error", body: `{"title":"Board"}`, sessionErr: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError},
		{name: "invalid JSON", body: `{`, wantStatus: http.StatusBadRequest},
		{name: "empty title", body: `{"title":" "}`, wantStatus: http.StatusBadRequest},
		{name: "board insert failure", body: `{"title":"Board"}`, boardErr: errors.New("insert failed"), wantStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{session: dbgen.Session{Token: "token", UserID: newUUID(7)}, sessionErr: test.sessionErr, createBoardErr: test.boardErr}
			response := send(newHandler(db, nil, false), http.MethodPost, "/api/boards", test.body,
				&http.Cookie{Name: "snappy_session", Value: "token"})
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
		})
	}

	t.Run("uses session owner instead of request owner", func(t *testing.T) {
		ownerID := newUUID(7)
		now := time.Now()
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			board: dbgen.Board{
				ID: newUUID(8), Title: "Family Board", OwnerID: ownerID,
				CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
				UpdatedAt: pgtype.Timestamptz{Time: now, Valid: true},
			},
		}
		response := send(newHandler(db, nil, false), http.MethodPost, "/api/boards",
			`{"title":" Family Board ","owner_id":"attacker-controlled"}`,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if db.boardArgs[0] != "Family Board" || db.boardArgs[1] != ownerID {
			t.Fatalf("board args = %#v, want normalized title and session owner", db.boardArgs)
		}
	})
}

func TestCreateTaskEndpoint(t *testing.T) {
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPost, "/api/tasks", `{"title":"Task"}`, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	for _, body := range []string{
		`{`,
		`{"title":" "}`,
		`{"title":"Task","state":"Complete"}`,
		`{"title":"Task","priority":"Urgent"}`,
		`{"title":"Task","assigned_to_id":"not-a-uuid"}`,
		`{"title":"Task","complete_by":"not-a-date"}`,
	} {
		t.Run("rejects invalid "+body, func(t *testing.T) {
			db := &fakeDB{session: dbgen.Session{Token: "token", UserID: newUUID(1)}}
			response := send(newHandler(db, nil, false), http.MethodPost, "/api/tasks", body,
				&http.Cookie{Name: "snappy_session", Value: "token"})
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
		})
	}

	t.Run("creates a task with defaults in the requested lane", func(t *testing.T) {
		ownerID := newUUID(1)
		now := time.Now()
		db := &fakeDB{
			session:  dbgen.Session{Token: "token", UserID: ownerID},
			boardErr: pgx.ErrNoRows,
			board: dbgen.Board{
				ID: newUUID(2), Title: "Snappy Plan", OwnerID: ownerID,
				CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
				UpdatedAt: pgtype.Timestamptz{Time: now, Valid: true},
			},
			columnErr: pgx.ErrNoRows,
			column: dbgen.Column{
				ID: newUUID(3), BoardID: newUUID(2), Title: "To Do", Position: 1,
				CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
			},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPost, "/api/tasks", `{"title":"  Call dentist  ","state":"ToDo"}`,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if !tx.committed {
			t.Fatal("task transaction was not committed")
		}
		if len(db.taskArgs) != 7 || db.taskArgs[0] != db.column.ID || db.taskArgs[1] != "ToDo" ||
			db.taskArgs[2] != "Call dentist" || db.taskArgs[4] != "Medium" {
			t.Fatalf("task args = %#v", db.taskArgs)
		}
		var task dbgen.Task
		if err := json.Unmarshal(response.Body.Bytes(), &task); err != nil {
			t.Fatalf("decode created task: %v", err)
		}
		if task.Title != "Call dentist" || task.State != "ToDo" || task.Priority != "Medium" {
			t.Fatalf("created task = %#v", task)
		}
	})

	t.Run("persists optional task details", func(t *testing.T) {
		ownerID := newUUID(1)
		due := time.Date(2026, time.October, 20, 9, 30, 0, 0, time.UTC)
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    dbgen.User{ID: newUUID(4), FullName: "Assigned User"},
			board:   dbgen.Board{ID: newUUID(2), Title: "Existing", OwnerID: ownerID},
			column:  dbgen.Column{ID: newUUID(3), BoardID: newUUID(2), Title: "Backlog"},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		body := `{"title":"Plan trip","description":"Compare dates","assigned_to_id":"` + db.user.ID.String() +
			`","state":"Backlog","priority":"High","complete_by":"` + due.Format(time.RFC3339) + `"}`

		response := send(handler, http.MethodPost, "/api/tasks", body,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if db.task.Description.String != "Compare dates" || db.task.AssignedToID != db.user.ID ||
			db.task.Priority != "High" || !db.task.CompleteBy.Time.Equal(due) {
			t.Fatalf("created task fields = %#v", db.task)
		}
	})
}

func TestMoveTaskEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPatch,
			"/api/tasks/"+newUUID(2).String(), `{"state":"InProgress"}`, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("persists a move to the requested state", func(t *testing.T) {
		ownerID := newUUID(1)
		taskID := newUUID(2)
		destinationColumnID := newUUID(3)
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			board:   dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
			column: dbgen.Column{
				ID: destinationColumnID, BoardID: newUUID(4), Title: "In Progress", Position: 2,
			},
			task: dbgen.Task{ID: taskID, Title: "Persist this move", State: "ToDo", Priority: "Medium"},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPatch, "/api/tasks/"+taskID.String(),
			`{"state":"InProgress"}`, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if !tx.committed {
			t.Fatal("task move transaction was not committed")
		}
		if len(db.moveTaskArgs) != 3 || db.moveTaskArgs[0] != destinationColumnID ||
			db.moveTaskArgs[1] != taskID || db.moveTaskArgs[2] != ownerID {
			t.Fatalf("move task args = %#v", db.moveTaskArgs)
		}
		var movedTask dbgen.Task
		if err := json.Unmarshal(response.Body.Bytes(), &movedTask); err != nil {
			t.Fatalf("decode moved task: %v", err)
		}
		if movedTask.State != "InProgress" || movedTask.ColumnID != destinationColumnID {
			t.Fatalf("moved task = %#v", movedTask)
		}
	})

	t.Run("rejects an unsupported state", func(t *testing.T) {
		db := &fakeDB{session: dbgen.Session{Token: "token", UserID: newUUID(1)}}
		response := send(newHandler(db, nil, false), http.MethodPatch,
			"/api/tasks/"+newUUID(2).String(), `{"state":"Blocked"}`, cookie)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
		}
	})
}

func TestTaskReadEndpointsRequireAuthentication(t *testing.T) {
	for _, path := range []string{"/api/tasks", "/api/users"} {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodGet, path, "", nil)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("%s status = %d, want %d", path, response.Code, http.StatusUnauthorized)
		}
	}
}

func TestTaskReadEndpoints(t *testing.T) {
	ownerID := newUUID(1)
	task := dbgen.Task{
		ID:       newUUID(2),
		ColumnID: newUUID(3),
		Title:    "Read saved task",
		State:    "Backlog",
		Priority: "Medium",
	}
	assignee := dbgen.GetUsersForAssignmentRow{ID: ownerID, FullName: "Board Owner"}
	db := &fakeDB{
		session:   dbgen.Session{Token: "token", UserID: ownerID},
		tasks:     []dbgen.Task{task},
		assignees: []dbgen.GetUsersForAssignmentRow{assignee},
	}
	handler := newHandler(db, nil, false)
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}

	tasksResponse := send(handler, http.MethodGet, "/api/tasks", "", cookie)
	if tasksResponse.Code != http.StatusOK {
		t.Fatalf("tasks status = %d, want %d: %s", tasksResponse.Code, http.StatusOK, tasksResponse.Body.String())
	}
	var tasks []dbgen.Task
	if err := json.Unmarshal(tasksResponse.Body.Bytes(), &tasks); err != nil {
		t.Fatalf("decode tasks: %v", err)
	}
	if len(tasks) != 1 || tasks[0].Title != task.Title || tasks[0].Priority != task.Priority {
		t.Fatalf("tasks = %#v", tasks)
	}

	usersResponse := send(handler, http.MethodGet, "/api/users", "", cookie)
	if usersResponse.Code != http.StatusOK {
		t.Fatalf("users status = %d, want %d: %s", usersResponse.Code, http.StatusOK, usersResponse.Body.String())
	}
	var users []dbgen.GetUsersForAssignmentRow
	if err := json.Unmarshal(usersResponse.Body.Bytes(), &users); err != nil {
		t.Fatalf("decode assignable users: %v", err)
	}
	if len(users) != 1 || users[0] != assignee {
		t.Fatalf("assignable users = %#v", users)
	}
}

func TestHealthEndpoint(t *testing.T) {
	response := send(newHandler(&fakeDB{}, nil, false), http.MethodGet, "/api/health", "", nil)
	if response.Code != http.StatusOK || response.Body.String() != "Snappy Plan Backend is running!" {
		t.Fatalf("health response = %d %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("health cache control = %q, want no-store", response.Header().Get("Cache-Control"))
	}
}

func TestFrontendEndpoints(t *testing.T) {
	handler := newHandler(&fakeDB{}, nil, false)
	for _, test := range []struct {
		name       string
		path       string
		wantBody   string
		wantCache  string
		wantStatus int
	}{
		{name: "index", path: "/", wantBody: "<main>Snappy Plan</main>", wantCache: "no-cache, no-store, must-revalidate", wantStatus: http.StatusOK},
		{name: "spa route", path: "/setup/welcome", wantBody: "<main>Snappy Plan</main>", wantCache: "no-cache, no-store, must-revalidate", wantStatus: http.StatusOK},
		{name: "static asset", path: "/assets/app.js", wantBody: "console.log('app')", wantStatus: http.StatusOK},
		{name: "missing static asset", path: "/assets/missing.js", wantStatus: http.StatusNotFound},
		{name: "unknown API route", path: "/api/missing", wantCache: "no-store", wantStatus: http.StatusNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := send(handler, http.MethodGet, test.path, "", nil)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if test.wantBody != "" && !strings.Contains(response.Body.String(), test.wantBody) {
				t.Fatalf("body = %q, want it to contain %q", response.Body.String(), test.wantBody)
			}
			if got := response.Header().Get("Cache-Control"); got != test.wantCache {
				t.Fatalf("cache-control = %q, want %q", got, test.wantCache)
			}
		})
	}

	response := send(handler, http.MethodPost, "/", "", nil)
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("static POST status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
}
