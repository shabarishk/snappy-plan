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
	boards             []dbgen.Board
	boardErr           error
	column             dbgen.Column
	columnErr          error
	task               dbgen.Task
	createTaskErr      error
	createColumnErr    error
	moveTaskErr        error
	updateTaskErr      error
	updateProfileErr   error
	updatePasswordErr  error
	tasksErr           error
	assigneesErr       error
	assignees          []dbgen.GetUsersForAssignmentRow
	adminUsers         []dbgen.GetUsersForAdminRow
	adminBoards        []dbgen.GetAllBoardsForAdminRow
	adminBoardsErr     error
	tasks              []dbgen.Task
	boardArgs          []any
	columnArgs         []any
	taskArgs           []any
	moveTaskArgs       []any
	updateTaskArgs     []any
	updateProfileArgs  []any
	updateUserRoleErr  error
	updateUserRoleArgs []any
	updatePasswordArgs []any
	deleteSessionArgs  []any
	sessionArgs        []any
	createUserArgs     []any
	createBoardErr     error
	boardMemberArgs    [][]any
	boardMemberErr     error
	deleteBoardArgs    []any
	deleteBoardQuery   string
	deleteBoardRows    int64
	deleteBoardErr     error
	createSessionError error
	createUserError    error
	deleteSessionErr   error
}

type failingResponseWriter struct {
	header http.Header
	status int
	err    error
}

func (writer *failingResponseWriter) Header() http.Header {
	if writer.header == nil {
		writer.header = make(http.Header)
	}
	return writer.header
}

func (writer *failingResponseWriter) WriteHeader(status int) {
	writer.status = status
}

func (writer *failingResponseWriter) Write([]byte) (int, error) {
	return 0, writer.err
}

func (db *fakeDB) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if strings.Contains(query, "DELETE FROM boards") {
		db.deleteBoardArgs = args
		db.deleteBoardQuery = query
		if db.deleteBoardErr != nil {
			return pgconn.CommandTag{}, db.deleteBoardErr
		}
		canDelete := db.board.OwnerID == args[1].(string) ||
			(strings.Contains(query, "role = 'admin'") && db.user.Role == "admin")
		if canDelete && db.deleteBoardRows > 0 {
			return pgconn.NewCommandTag("DELETE 1"), nil
		}
		return pgconn.NewCommandTag("DELETE 0"), nil
	}
	if strings.Contains(query, "INSERT INTO board_members") {
		db.boardMemberArgs = append(db.boardMemberArgs, args)
		return pgconn.CommandTag{}, db.boardMemberErr
	}
	if strings.Contains(query, "DELETE FROM sessions") {
		db.deleteSessionArgs = args
		return pgconn.CommandTag{}, db.deleteSessionErr
	}
	if strings.Contains(query, "UPDATE users") && strings.Contains(query, "password_hash") {
		db.updatePasswordArgs = args
		if db.updatePasswordErr != nil {
			return pgconn.CommandTag{}, db.updatePasswordErr
		}
		db.user.ID = args[0].(string)
		db.user.PasswordHash = args[1].(string)
	}
	return pgconn.CommandTag{}, nil
}

func (db *fakeDB) Query(_ context.Context, query string, _ ...any) (pgx.Rows, error) {
	switch {
	case strings.Contains(query, "FROM tasks AS task"):
		if db.tasksErr != nil {
			return nil, db.tasksErr
		}
		rows := make([][]any, len(db.tasks))
		for i, task := range db.tasks {
			rows[i] = taskValues(task)
		}
		return &fakeRows{values: rows}, nil
	case strings.Contains(query, "FROM boards") && strings.Contains(query, "WHERE owner_id"):
		rows := make([][]any, len(db.boards))
		for i, board := range db.boards {
			rows[i] = []any{board.ID, board.Title, board.OwnerID, board.CreatedAt, board.UpdatedAt}
		}
		return &fakeRows{values: rows}, nil
	case strings.Contains(query, "FROM boards AS board"):
		if db.adminBoardsErr != nil {
			return nil, db.adminBoardsErr
		}
		rows := make([][]any, len(db.adminBoards))
		for i, board := range db.adminBoards {
			rows[i] = []any{board.ID, board.Title, board.OwnerID, board.FullName}
		}
		return &fakeRows{values: rows}, nil
	case strings.Contains(query, "SELECT id, full_name, email, role"):
		rows := make([][]any, len(db.adminUsers))
		for i, user := range db.adminUsers {
			rows[i] = []any{user.ID, user.FullName, user.Email, user.Role}
		}
		return &fakeRows{values: rows}, nil
	case strings.Contains(query, "SELECT id, full_name"):
		if db.assigneesErr != nil {
			return nil, db.assigneesErr
		}
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
	case strings.Contains(query, "UPDATE tasks AS task") && strings.Contains(query, "state = CASE"):
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
	case strings.Contains(query, "UPDATE tasks AS task"):
		db.updateTaskArgs = args
		if db.updateTaskErr != nil {
			return fakeRow{err: db.updateTaskErr}
		}
		db.task.ColumnID = args[0].(pgtype.UUID)
		db.task.State = args[1].(string)
		db.task.Title = args[2].(string)
		db.task.Description = args[3].(pgtype.Text)
		db.task.Priority = args[4].(string)
		db.task.CompleteBy = args[5].(pgtype.Timestamptz)
		return fakeRow{values: taskValues(db.task)}
	case strings.Contains(query, "SET role ="):
		db.updateUserRoleArgs = args
		if db.updateUserRoleErr != nil {
			return fakeRow{err: db.updateUserRoleErr}
		}
		db.user.ID = args[0].(string)
		db.user.Role = args[1].(string)
		return fakeRow{values: userValues(db.user)}
	case strings.Contains(query, "UPDATE users"):
		db.updateProfileArgs = args
		if db.updateProfileErr != nil {
			return fakeRow{err: db.updateProfileErr}
		}
		db.user.ID = args[0].(string)
		db.user.Email = args[1].(string)
		db.user.FullName = args[2].(string)
		return fakeRow{values: userValues(db.user)}
	case strings.Contains(query, "SELECT COUNT(*) FROM users"):
		return fakeRow{values: []any{db.count}, err: db.countErr}
	case strings.Contains(query, "FROM users") && strings.Contains(query, "WHERE email"):
		return fakeRow{values: userValues(db.user), err: db.userErr}
	case strings.Contains(query, "FROM users") && strings.Contains(query, "WHERE id"):
		return fakeRow{values: userValues(db.user), err: db.userErr}
	case strings.Contains(query, "FROM tasks AS task") && strings.Contains(query, "WHERE task.id"):
		return fakeRow{values: []any{
			db.board.ID, db.board.Title, db.board.OwnerID, db.board.CreatedAt, db.board.UpdatedAt,
		}, err: db.boardErr}
	case strings.Contains(query, "FROM boards") && strings.Contains(query, "WHERE id") &&
		strings.Contains(query, "owner_id"):
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
		db.task.AssignedToID = args[5].(pgtype.Text)
		db.task.CompleteBy = args[6].(pgtype.Timestamptz)
		return fakeRow{values: taskValues(db.task)}
	case strings.Contains(query, "INSERT INTO users"):
		db.createUserArgs = args
		if db.createUserError != nil {
			return fakeRow{err: db.createUserError}
		}
		return fakeRow{values: []any{
			args[0], args[1], args[2], args[3], args[4],
			db.user.CreatedAt, db.user.UpdatedAt,
		}}
	default:
		return fakeRow{err: errors.New("unexpected query: " + query)}
	}
}

func userValues(user dbgen.User) []any {
	return []any{
		user.ID, user.Email, user.PasswordHash, user.FullName,
		user.Role, user.CreatedAt, user.UpdatedAt,
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

func (tx *fakeTx) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if strings.Contains(query, "pg_advisory_xact_lock") {
		return pgconn.CommandTag{}, tx.execErr
	}
	if strings.Contains(query, "INSERT INTO board_members") {
		return tx.fakeDB.Exec(ctx, query, args...)
	}
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
		ID:           "admin1",
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
	validBody := `{"username":"AdminUser","email":"admin@example.com","full_name":"Admin User","password":"password123"}`

	t.Run("validates request", func(t *testing.T) {
		for _, body := range []string{
			`{`,
			`{"username":"bad-name","email":"admin@example.com","full_name":"Admin","password":"password123"}`,
			`{"username":"","email":"admin@example.com","full_name":"Admin","password":"password123"}`,
			`{"username":"admin1","email":"not-an-email","full_name":"Admin","password":"password123"}`,
			`{"username":"admin1","email":"admin@example.com","full_name":" ","password":"password123"}`,
			`{"username":"admin1","email":"admin@example.com","full_name":"Admin","password":"short"}`,
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
		if response.Code != http.StatusCreated || !tx.committed ||
			txDB.createUserArgs[0] != "adminuser" || txDB.createUserArgs[4] != "admin" {
			t.Fatalf("status = %d; committed = %t; args = %#v", response.Code, tx.committed, txDB.createUserArgs)
		}
		if len(txDB.boardArgs) != 2 || txDB.boardArgs[0] != "Admin User" || txDB.boardArgs[1] != "adminuser" {
			t.Fatalf("personal board args = %#v", txDB.boardArgs)
		}
		if err := bcrypt.CompareHashAndPassword([]byte(txDB.createUserArgs[2].(string)), []byte("password123")); err != nil {
			t.Fatalf("password was not securely hashed: %v", err)
		}
		var result map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result["user_id"] != "adminuser" {
			t.Fatalf("setup response = %#v, error = %v", result, err)
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

func TestSetupEndpointWithoutTransaction(t *testing.T) {
	body := `{"username":"admin1","email":"admin@example.com","full_name":"Admin User","password":"password123"}`
	response := send(newHandler(&fakeDB{}, nil, false), http.MethodPost, "/api/setup", body, nil)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
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

func TestLogoutEndpoint(t *testing.T) {
	t.Run("deletes session and expires cookie", func(t *testing.T) {
		db := &fakeDB{}
		response := send(newHandler(db, nil, true), http.MethodPost, "/api/logout", "",
			&http.Cookie{Name: "snappy_session", Value: "session-token"})
		if response.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusNoContent, response.Body.String())
		}
		if len(db.deleteSessionArgs) != 1 || db.deleteSessionArgs[0] != "session-token" {
			t.Fatalf("delete session args = %#v", db.deleteSessionArgs)
		}
		cookies := response.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Name != "snappy_session" ||
			cookies[0].Value != "" || cookies[0].MaxAge >= 0 ||
			!cookies[0].HttpOnly || !cookies[0].Secure ||
			cookies[0].SameSite != http.SameSiteStrictMode {
			t.Fatalf("unexpected logout cookie: %#v", cookies)
		}
	})

	t.Run("clears cookie when there is no session", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPost, "/api/logout", "", nil)
		if response.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
		}
		if len(response.Result().Cookies()) != 1 || response.Result().Cookies()[0].MaxAge >= 0 {
			t.Fatalf("logout cookie was not expired: %#v", response.Result().Cookies())
		}
	})

	t.Run("reports database errors without clearing cookie", func(t *testing.T) {
		response := send(newHandler(&fakeDB{deleteSessionErr: errors.New("delete failed")}, nil, false),
			http.MethodPost, "/api/logout", "", &http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
		}
		if len(response.Result().Cookies()) != 0 {
			t.Fatalf("logout unexpectedly cleared cookie: %#v", response.Result().Cookies())
		}
	})
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
		userErr    error
		beginErr   error
		commitErr  error
		beginNil   bool
		wantStatus int
	}{
		{name: "database session error", body: `{"title":"Board"}`, sessionErr: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError},
		{name: "invalid JSON", body: `{`, wantStatus: http.StatusBadRequest},
		{name: "empty title", body: `{"title":" "}`, wantStatus: http.StatusBadRequest},
		{name: "title exceeds maximum length", body: `{"title":"` + strings.Repeat("a", 101) + `"}`, wantStatus: http.StatusBadRequest},
		{name: "missing transaction provider", body: `{"title":"Board"}`, beginNil: true, wantStatus: http.StatusInternalServerError},
		{name: "transaction begin failure", body: `{"title":"Board"}`, beginErr: errors.New("begin failed"), wantStatus: http.StatusInternalServerError},
		{name: "board insert failure", body: `{"title":"Board"}`, boardErr: errors.New("insert failed"), wantStatus: http.StatusInternalServerError},
		{name: "invalid member", body: `{"title":"Board","user_ids":["bad-id"]}`, wantStatus: http.StatusBadRequest},
		{name: "missing member", body: `{"title":"Board","user_ids":["member1"]}`, userErr: pgx.ErrNoRows, wantStatus: http.StatusBadRequest},
		{name: "member lookup failure", body: `{"title":"Board","user_ids":["member1"]}`, userErr: errors.New("lookup failed"), wantStatus: http.StatusInternalServerError},
		{name: "transaction commit failure", body: `{"title":"Board"}`, commitErr: errors.New("commit failed"), wantStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{
				session:        dbgen.Session{Token: "token", UserID: "owner7"},
				sessionErr:     test.sessionErr,
				createBoardErr: test.boardErr,
				userErr:        test.userErr,
			}
			var begin func(context.Context) (backend.SetupTransaction, error)
			if !test.beginNil {
				tx := &fakeTx{fakeDB: db, commitErr: test.commitErr}
				begin = func(context.Context) (backend.SetupTransaction, error) {
					if test.beginErr != nil {
						return nil, test.beginErr
					}
					return tx, nil
				}
			}
			response := send(newHandler(db, begin, false), http.MethodPost, "/api/boards", test.body,
				&http.Cookie{Name: "snappy_session", Value: "token"})
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
		})
	}

	t.Run("uses session owner instead of request owner", func(t *testing.T) {
		ownerID := "owner7"
		now := time.Now()
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    dbgen.User{ID: ownerID, FullName: "Owner"},
			board: dbgen.Board{
				ID: newUUID(8), Title: "Family Board", OwnerID: ownerID,
				CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
				UpdatedAt: pgtype.Timestamptz{Time: now, Valid: true},
			},
		}
		tx := &fakeTx{fakeDB: db}
		response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false), http.MethodPost, "/api/boards",
			`{"title":" Family Board ","user_ids":["member7","member7"],"owner_id":"attacker-controlled"}`,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusCreated || !tx.committed {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if db.boardArgs[0] != "Family Board" || db.boardArgs[1] != ownerID {
			t.Fatalf("board args = %#v, want normalized title and session owner", db.boardArgs)
		}
		if len(db.boardMemberArgs) != 2 {
			t.Fatalf("board member inserts = %#v, want owner and one deduplicated selected user", db.boardMemberArgs)
		}
		for _, args := range db.boardMemberArgs {
			if args[0] != db.board.ID {
				t.Fatalf("board member args = %#v, want created board ID", args)
			}
		}
	})

	t.Run("rolls back board creation if access cannot be granted", func(t *testing.T) {
		db := &fakeDB{
			session:        dbgen.Session{Token: "token", UserID: "owner7"},
			user:           dbgen.User{ID: "member7", FullName: "Member"},
			boardMemberErr: errors.New("membership insert failed"),
		}
		tx := &fakeTx{fakeDB: db}
		response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false), http.MethodPost, "/api/boards",
			`{"title":"Shared","user_ids":["member7"]}`,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusInternalServerError || tx.committed || !tx.rolledBack {
			t.Fatalf("status=%d committed=%t rolledBack=%t",
				response.Code, tx.committed, tx.rolledBack)
		}
	})
}

func TestGetBoardsEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodGet, "/api/boards", "", nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("returns boards owned by the session user", func(t *testing.T) {
		board := dbgen.Board{ID: newUUID(8), Title: "Personal Board", OwnerID: "owner7"}
		response := send(newHandler(&fakeDB{
			session: dbgen.Session{Token: "token", UserID: "owner7"},
			boards:  []dbgen.Board{board},
		}, nil, false), http.MethodGet, "/api/boards", "", cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		var boards []dbgen.Board
		if err := json.Unmarshal(response.Body.Bytes(), &boards); err != nil {
			t.Fatalf("decode boards: %v", err)
		}
		if len(boards) != 1 || boards[0].Title != board.Title || boards[0].OwnerID != "owner7" {
			t.Fatalf("boards = %#v", boards)
		}
	})
}

func TestDeleteBoardEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodDelete,
			"/api/boards/"+newUUID(8).String(), "", nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	for _, test := range []struct {
		name       string
		boardID    string
		rows       int64
		deleteErr  error
		sessionErr error
		role       string
		boardOwner string
		wantStatus int
	}{
		{name: "invalid board ID", boardID: "invalid", wantStatus: http.StatusBadRequest},
		{name: "board does not belong to user", boardID: newUUID(8).String(), rows: 1, role: "user", boardOwner: "other", wantStatus: http.StatusNotFound},
		{name: "session lookup error", boardID: newUUID(8).String(), sessionErr: errors.New("session lookup failed"), wantStatus: http.StatusInternalServerError},
		{name: "database error", boardID: newUUID(8).String(), deleteErr: errors.New("delete failed"), wantStatus: http.StatusInternalServerError},
		{name: "deletes owned board", boardID: newUUID(8).String(), rows: 1, role: "user", boardOwner: "owner7", wantStatus: http.StatusNoContent},
		{name: "admin deletes any board", boardID: newUUID(8).String(), rows: 1, role: "admin", boardOwner: "other", wantStatus: http.StatusNoContent},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{
				session:         dbgen.Session{Token: "token", UserID: "owner7"},
				sessionErr:      test.sessionErr,
				user:            dbgen.User{ID: "owner7", Role: test.role},
				board:           dbgen.Board{OwnerID: test.boardOwner},
				deleteBoardRows: test.rows,
				deleteBoardErr:  test.deleteErr,
			}
			response := send(newHandler(db, nil, false), http.MethodDelete,
				"/api/boards/"+test.boardID, "", cookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
			if test.boardID != "invalid" && test.sessionErr == nil && test.deleteErr == nil {
				boardID := pgtype.UUID{}
				if err := boardID.Scan(test.boardID); err != nil {
					t.Fatalf("parse test board ID: %v", err)
				}
				if len(db.deleteBoardArgs) != 2 || db.deleteBoardArgs[0] != boardID || db.deleteBoardArgs[1] != "owner7" {
					t.Fatalf("delete args = %#v, want requested board and authenticated owner", db.deleteBoardArgs)
				}
				if !strings.Contains(db.deleteBoardQuery, "role = 'admin'") {
					t.Fatalf("delete query = %q, want admin role check", db.deleteBoardQuery)
				}
			}
		})
	}
}

func TestGetTasksEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodGet, "/api/tasks?board_id="+newUUID(4).String(), "", nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	for _, test := range []struct {
		name       string
		boardID    string
		boardErr   error
		tasksErr   error
		wantStatus int
	}{
		{name: "rejects an invalid board ID", boardID: "invalid", wantStatus: http.StatusBadRequest},
		{name: "rejects an inaccessible board", boardID: newUUID(4).String(), boardErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "reports a board access query error", boardID: newUUID(4).String(), boardErr: errors.New("lookup failed"), wantStatus: http.StatusInternalServerError},
		{name: "reports a task query error", boardID: newUUID(4).String(), tasksErr: errors.New("task query failed"), wantStatus: http.StatusInternalServerError},
		{name: "returns tasks for an accessible board", boardID: newUUID(4).String(), wantStatus: http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{
				session:  dbgen.Session{Token: "token", UserID: "owner7"},
				board:    dbgen.Board{ID: newUUID(4), Title: "Shared", OwnerID: "owner1"},
				boardErr: test.boardErr,
				tasksErr: test.tasksErr,
				tasks:    []dbgen.Task{{ID: newUUID(8), Title: "Board task"}},
			}
			response := send(newHandler(db, nil, false), http.MethodGet,
				"/api/tasks?board_id="+test.boardID, "", cookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
			if test.name == "returns tasks for an accessible board" {
				var tasks []dbgen.Task
				if err := json.Unmarshal(response.Body.Bytes(), &tasks); err != nil {
					t.Fatalf("decode tasks: %v", err)
				}
				if len(tasks) != 1 || tasks[0].Title != "Board task" {
					t.Fatalf("tasks = %#v", tasks)
				}
			}
		})
	}
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
		`{"title":"Task","board_id":"not-a-uuid"}`,
		`{"title":"Task","assigned_to_id":"not-a-uuid"}`,
		`{"title":"Task","complete_by":"not-a-date"}`,
	} {
		t.Run("rejects invalid "+body, func(t *testing.T) {
			db := &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"}}
			response := send(newHandler(db, nil, false), http.MethodPost, "/api/tasks", body,
				&http.Cookie{Name: "snappy_session", Value: "token"})
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
		})
	}

	t.Run("rejects unavailable task storage and transaction failures", func(t *testing.T) {
		ownerID := "owner1"
		body := `{"title":"Task"}`
		testCases := []struct {
			name            string
			begin           func(context.Context) (backend.SetupTransaction, error)
			wantStatus      int
			createBoardErr  error
			boardErr        error
			columnErr       error
			createColumnErr error
			createTaskErr   error
			commitErr       error
		}{
			{name: "missing transaction provider", wantStatus: http.StatusInternalServerError},
			{
				name: "begin error", wantStatus: http.StatusInternalServerError,
				begin: func(context.Context) (backend.SetupTransaction, error) { return nil, errors.New("begin failed") },
			},
			{
				name: "lock error", wantStatus: http.StatusInternalServerError,
				begin: func(context.Context) (backend.SetupTransaction, error) {
					return &fakeTx{fakeDB: &fakeDB{}, execErr: errors.New("lock failed")}, nil
				},
			},
			{
				name: "board query error", wantStatus: http.StatusInternalServerError,
				boardErr: errors.New("board query failed"),
			},
			{
				name: "board creation error", wantStatus: http.StatusInternalServerError,
				boardErr: pgx.ErrNoRows, createBoardErr: errors.New("board insert failed"),
			},
			{
				name: "lane query error", wantStatus: http.StatusInternalServerError,
				columnErr: errors.New("lane query failed"),
			},
			{
				name: "lane creation error", wantStatus: http.StatusInternalServerError,
				columnErr: pgx.ErrNoRows, createColumnErr: errors.New("lane insert failed"),
			},
			{
				name: "task creation error", wantStatus: http.StatusInternalServerError,
				createTaskErr: errors.New("task insert failed"),
			},
			{
				name: "commit error", wantStatus: http.StatusInternalServerError,
				commitErr: errors.New("commit failed"),
			},
		}
		for _, test := range testCases {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session:         dbgen.Session{Token: "token", UserID: ownerID},
					board:           dbgen.Board{ID: newUUID(2), OwnerID: ownerID},
					column:          dbgen.Column{ID: newUUID(3), BoardID: newUUID(2), Title: "Backlog"},
					boardErr:        test.boardErr,
					columnErr:       test.columnErr,
					createBoardErr:  test.createBoardErr,
					createColumnErr: test.createColumnErr,
					createTaskErr:   test.createTaskErr,
				}
				begin := test.begin
				if begin == nil && test.name != "missing transaction provider" {
					tx := &fakeTx{fakeDB: db, commitErr: test.commitErr}
					begin = func(context.Context) (backend.SetupTransaction, error) { return tx, nil }
				}
				response := send(newHandler(db, begin, false), http.MethodPost, "/api/tasks", body,
					&http.Cookie{Name: "snappy_session", Value: "token"})
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
				}
			})
		}
	})

	t.Run("creates a task with defaults in the requested lane", func(t *testing.T) {
		ownerID := "owner1"
		now := time.Now()
		db := &fakeDB{
			session:  dbgen.Session{Token: "token", UserID: ownerID},
			boardErr: pgx.ErrNoRows,
			board: dbgen.Board{
				ID: newUUID(2), Title: "Board Owner", OwnerID: ownerID,
				CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
				UpdatedAt: pgtype.Timestamptz{Time: now, Valid: true},
			},
			user:      dbgen.User{ID: ownerID, FullName: "Board Owner"},
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
		if len(db.boardArgs) != 2 || db.boardArgs[0] != "Board Owner" || db.boardArgs[1] != ownerID {
			t.Fatalf("personal board args = %#v", db.boardArgs)
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

	t.Run("creates task on the selected owned board", func(t *testing.T) {
		ownerID := "owner1"
		boardID := newUUID(4)
		db := &fakeDB{
			session:   dbgen.Session{Token: "token", UserID: ownerID},
			board:     dbgen.Board{ID: boardID, Title: "Project Board", OwnerID: ownerID},
			columnErr: pgx.ErrNoRows,
			column:    dbgen.Column{ID: newUUID(5), BoardID: boardID, Title: "Backlog"},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPost, "/api/tasks",
			`{"title":"Selected board task","board_id":"`+boardID.String()+`"}`,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if len(db.columnArgs) != 3 || db.columnArgs[0] != boardID {
			t.Fatalf("column args = %#v, want selected board %v", db.columnArgs, boardID)
		}
	})

	t.Run("rejects a board that is not owned by the user", func(t *testing.T) {
		ownerID := "owner1"
		boardID := newUUID(4)
		db := &fakeDB{
			session:  dbgen.Session{Token: "token", UserID: ownerID},
			boardErr: pgx.ErrNoRows,
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPost, "/api/tasks",
			`{"title":"Other user's board task","board_id":"`+boardID.String()+`"}`,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
		}
		if len(db.taskArgs) != 0 {
			t.Fatalf("task was created on an unowned board: %#v", db.taskArgs)
		}
	})

	t.Run("persists optional task details", func(t *testing.T) {
		ownerID := "owner1"
		due := time.Date(2026, time.October, 20, 9, 30, 0, 0, time.UTC)
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    dbgen.User{ID: "assigned1", FullName: "Assigned User"},
			board:   dbgen.Board{ID: newUUID(2), Title: "Existing", OwnerID: ownerID},
			column:  dbgen.Column{ID: newUUID(3), BoardID: newUUID(2), Title: "Backlog"},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		body := `{"title":"Plan trip","description":"Compare dates","assigned_to_id":"` + db.user.ID +
			`","state":"Backlog","priority":"High","complete_by":"` + due.Format(time.RFC3339) + `"}`

		response := send(handler, http.MethodPost, "/api/tasks", body,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if db.task.Description.String != "Compare dates" ||
			db.task.AssignedToID != (pgtype.Text{String: db.user.ID, Valid: true}) ||
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
		ownerID := "owner1"
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
		db := &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"}}
		response := send(newHandler(db, nil, false), http.MethodPatch,
			"/api/tasks/"+newUUID(2).String(), `{"state":"Blocked"}`, cookie)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
		}
	})

	for _, test := range []struct {
		name            string
		path            string
		body            string
		beginMissing    bool
		beginErr        error
		execErr         error
		boardErr        error
		columnErr       error
		createColumnErr error
		moveTaskErr     error
		commitErr       error
		wantStatus      int
	}{
		{name: "invalid task ID", path: "/api/tasks/not-a-uuid", body: `{"state":"ToDo"}`, wantStatus: http.StatusBadRequest},
		{name: "invalid JSON", path: "/api/tasks/" + newUUID(2).String(), body: `{`, wantStatus: http.StatusBadRequest},
		{name: "missing transaction provider", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, beginMissing: true, wantStatus: http.StatusInternalServerError},
		{name: "begin error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, beginErr: errors.New("begin failed"), wantStatus: http.StatusInternalServerError},
		{name: "advisory lock error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, execErr: errors.New("lock failed"), wantStatus: http.StatusInternalServerError},
		{name: "task not found", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, boardErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "task query error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, boardErr: errors.New("query failed"), wantStatus: http.StatusInternalServerError},
		{name: "lane query error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, columnErr: errors.New("query failed"), wantStatus: http.StatusInternalServerError},
		{name: "lane creation error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, columnErr: pgx.ErrNoRows, createColumnErr: errors.New("insert failed"), wantStatus: http.StatusInternalServerError},
		{name: "task not found on update", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, moveTaskErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "update error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, moveTaskErr: errors.New("update failed"), wantStatus: http.StatusInternalServerError},
		{name: "commit error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, commitErr: errors.New("commit failed"), wantStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			ownerID := "owner1"
			db := &fakeDB{
				session:         dbgen.Session{Token: "token", UserID: ownerID},
				board:           dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
				column:          dbgen.Column{ID: newUUID(3), BoardID: newUUID(4), Title: "To Do"},
				boardErr:        test.boardErr,
				columnErr:       test.columnErr,
				createColumnErr: test.createColumnErr,
				moveTaskErr:     test.moveTaskErr,
			}
			var begin func(context.Context) (backend.SetupTransaction, error)
			if !test.beginMissing {
				begin = func(context.Context) (backend.SetupTransaction, error) {
					if test.beginErr != nil {
						return nil, test.beginErr
					}
					return &fakeTx{
						fakeDB: db, execErr: test.execErr, commitErr: test.commitErr,
					}, nil
				}
			}
			response := send(newHandler(db, begin, false), http.MethodPatch, test.path, test.body, cookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}

	t.Run("creates a missing destination lane", func(t *testing.T) {
		ownerID := "owner1"
		db := &fakeDB{
			session:   dbgen.Session{Token: "token", UserID: ownerID},
			board:     dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
			column:    dbgen.Column{ID: newUUID(3), BoardID: newUUID(4), Title: "Complete"},
			columnErr: pgx.ErrNoRows,
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		response := send(handler, http.MethodPatch, "/api/tasks/"+newUUID(2).String(),
			`{"state":"Complete"}`, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if !tx.committed || db.columnArgs[1] != "Complete" || db.columnArgs[2] != int32(3) {
			t.Fatalf("lane creation args = %#v; committed = %t", db.columnArgs, tx.committed)
		}
	})
}

func TestUpdateTaskEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	taskID := newUUID(2)
	ownerID := "owner1"
	due := time.Date(2026, time.October, 20, 9, 30, 0, 0, time.UTC)
	body := `{"title":"  Updated task  ","description":"Revised details","priority":"High",` +
		`"state":"InProgress","complete_by":"` + due.Format(time.RFC3339) + `"}`

	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPut,
			"/api/tasks/"+taskID.String(), body, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("reports session lookup failures", func(t *testing.T) {
		db := &fakeDB{sessionErr: errors.New("session store unavailable")}
		response := send(newHandler(db, nil, false), http.MethodPut,
			"/api/tasks/"+taskID.String(), body, cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
		}
	})

	for _, test := range []struct {
		name string
		path string
		body string
		want int
	}{
		{name: "invalid task ID", path: "/api/tasks/bad-id", body: body, want: http.StatusBadRequest},
		{name: "invalid JSON", path: "/api/tasks/" + taskID.String(), body: `{`, want: http.StatusBadRequest},
		{name: "blank title", path: "/api/tasks/" + taskID.String(), body: `{"title":" ","priority":"Low","state":"Backlog"}`, want: http.StatusBadRequest},
		{name: "title too long", path: "/api/tasks/" + taskID.String(), body: `{"title":"` + strings.Repeat("x", 256) + `","priority":"Low","state":"Backlog"}`, want: http.StatusBadRequest},
		{name: "invalid priority", path: "/api/tasks/" + taskID.String(), body: `{"title":"Task","priority":"Urgent","state":"Backlog"}`, want: http.StatusBadRequest},
		{name: "invalid state", path: "/api/tasks/" + taskID.String(), body: `{"title":"Task","priority":"Low","state":"Blocked"}`, want: http.StatusBadRequest},
		{name: "invalid due date", path: "/api/tasks/" + taskID.String(), body: `{"title":"Task","priority":"Low","state":"Backlog","complete_by":"not-a-date"}`, want: http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{
				session: dbgen.Session{Token: "token", UserID: ownerID},
				user:    dbgen.User{Role: "user"},
			}
			response := send(newHandler(db, nil, false), http.MethodPut, test.path, test.body, cookie)
			if response.Code != test.want {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.want, response.Body.String())
			}
		})
	}

	for _, test := range []struct {
		name            string
		beginMissing    bool
		beginErr        error
		lockErr         error
		boardErr        error
		columnErr       error
		createColumnErr error
		updateErr       error
		commitErr       error
		wantStatus      int
	}{
		{name: "missing transaction provider", beginMissing: true, wantStatus: http.StatusInternalServerError},
		{name: "transaction begin failure", beginErr: errors.New("begin failed"), wantStatus: http.StatusInternalServerError},
		{name: "transaction lock failure", lockErr: errors.New("lock failed"), wantStatus: http.StatusInternalServerError},
		{name: "task not found", boardErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "task lookup failure", boardErr: errors.New("query failed"), wantStatus: http.StatusInternalServerError},
		{name: "lane lookup failure", columnErr: errors.New("query failed"), wantStatus: http.StatusInternalServerError},
		{name: "lane creation failure", columnErr: pgx.ErrNoRows, createColumnErr: errors.New("insert failed"), wantStatus: http.StatusInternalServerError},
		{name: "task disappeared before update", updateErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "task update failure", updateErr: errors.New("update failed"), wantStatus: http.StatusInternalServerError},
		{name: "transaction commit failure", commitErr: errors.New("commit failed"), wantStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{
				session:         dbgen.Session{Token: "token", UserID: ownerID},
				board:           dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
				column:          dbgen.Column{ID: newUUID(3), BoardID: newUUID(4), Title: "To Do"},
				boardErr:        test.boardErr,
				columnErr:       test.columnErr,
				createColumnErr: test.createColumnErr,
				updateTaskErr:   test.updateErr,
			}
			var begin func(context.Context) (backend.SetupTransaction, error)
			if !test.beginMissing {
				begin = func(context.Context) (backend.SetupTransaction, error) {
					if test.beginErr != nil {
						return nil, test.beginErr
					}
					return &fakeTx{fakeDB: db, execErr: test.lockErr, commitErr: test.commitErr}, nil
				}
			}
			requestBody := `{"title":"Updated","description":"","priority":"Low","state":"ToDo"}`
			response := send(newHandler(db, begin, false), http.MethodPut,
				"/api/tasks/"+taskID.String(), requestBody, cookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}

	for _, test := range []struct {
		name         string
		state        string
		columnTitle  string
		wantPosition int32
	}{
		{name: "To Do", state: "ToDo", columnTitle: "To Do", wantPosition: 1},
		{name: "In Progress", state: "InProgress", columnTitle: "In Progress", wantPosition: 2},
		{name: "Complete", state: "Complete", columnTitle: "Complete", wantPosition: 3},
	} {
		t.Run("creates missing "+test.name+" lane", func(t *testing.T) {
			db := &fakeDB{
				session:   dbgen.Session{Token: "token", UserID: ownerID},
				board:     dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
				column:    dbgen.Column{ID: newUUID(3), BoardID: newUUID(4), Title: test.columnTitle},
				columnErr: pgx.ErrNoRows,
			}
			tx := &fakeTx{fakeDB: db}
			handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
				return tx, nil
			}, false)
			requestBody := `{"title":"Updated","description":"","priority":"Low","state":"` + test.state + `"}`
			response := send(handler, http.MethodPut, "/api/tasks/"+taskID.String(), requestBody, cookie)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
			}
			if !tx.committed || db.columnArgs[1] != test.columnTitle || db.columnArgs[2] != test.wantPosition {
				t.Fatalf("created lane args = %#v; committed = %t", db.columnArgs, tx.committed)
			}
		})
	}

	t.Run("persists all editable fields and state", func(t *testing.T) {
		columnID := newUUID(3)
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			board:   dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
			column: dbgen.Column{
				ID: columnID, BoardID: newUUID(4), Title: "In Progress",
			},
			task: dbgen.Task{ID: taskID, Title: "Old task", State: "ToDo", Priority: "Low"},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPut, "/api/tasks/"+taskID.String(), body, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if !tx.committed {
			t.Fatal("task update transaction was not committed")
		}
		args := db.updateTaskArgs
		if len(args) != 8 || args[0] != columnID || args[1] != "InProgress" ||
			args[2] != "Updated task" || args[3] != (pgtype.Text{String: "Revised details", Valid: true}) ||
			args[4] != "High" || args[6] != taskID || args[7] != ownerID {
			t.Fatalf("update task args = %#v", args)
		}
		if got := args[5].(pgtype.Timestamptz); !got.Valid || !got.Time.Equal(due) {
			t.Fatalf("complete-by arg = %#v, want %v", got, due)
		}
		var updated dbgen.Task
		if err := json.Unmarshal(response.Body.Bytes(), &updated); err != nil {
			t.Fatalf("decode updated task: %v", err)
		}
		if updated.Title != "Updated task" || updated.State != "InProgress" || updated.Priority != "High" {
			t.Fatalf("updated task = %#v", updated)
		}
	})

	t.Run("clears optional fields", func(t *testing.T) {
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			board:   dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
			column:  dbgen.Column{ID: newUUID(3), BoardID: newUUID(4), Title: "Backlog"},
			task:    dbgen.Task{ID: taskID, Title: "Task", State: "ToDo", Priority: "Medium"},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		response := send(handler, http.MethodPut, "/api/tasks/"+taskID.String(),
			`{"title":"Task","description":"","priority":"Medium","state":"Backlog","complete_by":null}`, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if db.task.Description.Valid || db.task.CompleteBy.Valid {
			t.Fatalf("optional fields were not cleared: %#v", db.task)
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
	ownerID := "owner1"
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

	for _, test := range []struct {
		name string
		db   *fakeDB
		path string
	}{
		{name: "task query error", db: &fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}, tasksErr: errors.New("query failed")}, path: "/api/tasks"},
		{name: "assignee query error", db: &fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}, assigneesErr: errors.New("query failed")}, path: "/api/users"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := send(newHandler(test.db, nil, false), http.MethodGet, test.path, "", cookie)
			if response.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
			}
		})
	}

	t.Run("empty task and assignee lists are encoded as arrays", func(t *testing.T) {
		emptyDB := &fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}}
		handler := newHandler(emptyDB, nil, false)
		for _, path := range []string{"/api/tasks", "/api/users"} {
			response := send(handler, http.MethodGet, path, "", cookie)
			if response.Code != http.StatusOK || response.Body.String() != "[]\n" {
				t.Errorf("%s response = %d %q", path, response.Code, response.Body.String())
			}
		}
	})
}

func TestProfileEndpoints(t *testing.T) {
	const ownerID = "owner1"
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}

	t.Run("requires authentication", func(t *testing.T) {
		handler := newHandler(&fakeDB{}, nil, false)
		for _, method := range []string{http.MethodGet, http.MethodPut} {
			response := send(handler, method, "/api/profile",
				`{"full_name":"Updated User","email":"updated@example.com"}`, nil)
			if response.Code != http.StatusUnauthorized {
				t.Errorf("%s status = %d, want %d", method, response.Code, http.StatusUnauthorized)
			}
		}
	})

	t.Run("returns only profile fields", func(t *testing.T) {
		user := newUser("password123")
		user.ID = ownerID
		db := &fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}, user: user}
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/profile", "", cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		var body map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode profile: %v", err)
		}
		if body["username"] != ownerID || body["full_name"] != user.FullName || body["email"] != user.Email {
			t.Fatalf("profile = %#v", body)
		}
		if strings.Contains(response.Body.String(), user.PasswordHash) {
			t.Fatal("profile response included the password hash")
		}
	})

	t.Run("reports profile lookup failures", func(t *testing.T) {
		for _, test := range []struct {
			name       string
			sessionErr error
			userErr    error
			wantStatus int
		}{
			{name: "session validation error", sessionErr: errors.New("session query failed"), wantStatus: http.StatusInternalServerError},
			{name: "missing user", userErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
			{name: "database failure", userErr: errors.New("user query failed"), wantStatus: http.StatusInternalServerError},
		} {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session:    dbgen.Session{Token: "token", UserID: ownerID},
					sessionErr: test.sessionErr,
					userErr:    test.userErr,
				}
				response := send(newHandler(db, nil, false), http.MethodGet, "/api/profile", "", cookie)
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
				}
			})
		}
	})

	t.Run("updates full name and email", func(t *testing.T) {
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    dbgen.User{Role: "user"},
		}
		response := send(newHandler(db, nil, false), http.MethodPut, "/api/profile",
			`{"full_name":"Updated User","email":"updated@example.com"}`, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if len(db.updateProfileArgs) != 3 || db.updateProfileArgs[0] != ownerID ||
			db.updateProfileArgs[1] != "updated@example.com" || db.updateProfileArgs[2] != "Updated User" {
			t.Fatalf("update args = %#v", db.updateProfileArgs)
		}
		var body map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode profile: %v", err)
		}
		if body["username"] != ownerID || body["full_name"] != "Updated User" ||
			body["email"] != "updated@example.com" || body["role"] != "user" || len(body) != 4 {
			t.Fatalf("updated profile = %#v", body)
		}
	})

	t.Run("validates profile fields", func(t *testing.T) {
		for _, body := range []string{
			`{`,
			`{"full_name":" ","email":"valid@example.com"}`,
			`{"full_name":"User","email":"not-an-email"}`,
			`{"full_name":"User","email":"User <user@example.com>"}`,
			`{"full_name":"` + strings.Repeat("a", 101) + `","email":"valid@example.com"}`,
		} {
			response := send(newHandler(&fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}}, nil, false),
				http.MethodPut, "/api/profile", body, cookie)
			if response.Code != http.StatusBadRequest {
				t.Errorf("body %q status = %d, want %d", body, response.Code, http.StatusBadRequest)
			}
		}
	})

	t.Run("reports duplicate email and database failures", func(t *testing.T) {
		for _, test := range []struct {
			name       string
			err        error
			wantStatus int
		}{
			{name: "duplicate email", err: &pgconn.PgError{Code: "23505"}, wantStatus: http.StatusConflict},
			{name: "missing user", err: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
			{name: "database failure", err: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError},
		} {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session:          dbgen.Session{Token: "token", UserID: ownerID},
					updateProfileErr: test.err,
				}
				response := send(newHandler(db, nil, false), http.MethodPut, "/api/profile",
					`{"full_name":"Updated User","email":"updated@example.com"}`, cookie)
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
				}
			})
		}
	})

	t.Run("reports session validation errors", func(t *testing.T) {
		db := &fakeDB{
			session:    dbgen.Session{Token: "token", UserID: ownerID},
			sessionErr: errors.New("session query failed"),
		}
		for _, method := range []string{http.MethodGet, http.MethodPut} {
			response := send(newHandler(db, nil, false), method, "/api/profile",
				`{"full_name":"Updated User","email":"updated@example.com"}`, cookie)
			if response.Code != http.StatusInternalServerError {
				t.Errorf("%s status = %d, want %d", method, response.Code, http.StatusInternalServerError)
			}
		}
	})
}

func TestAdminUserEndpoints(t *testing.T) {
	const adminID = "admin1"
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	admin := newUser("password123")

	t.Run("requires administrator privileges", func(t *testing.T) {
		for _, test := range []struct {
			name   string
			user   dbgen.User
			cookie *http.Cookie
			want   int
		}{
			{name: "unauthenticated", want: http.StatusUnauthorized},
			{name: "regular user", user: dbgen.User{ID: "user1", Role: "user"}, cookie: cookie, want: http.StatusForbidden},
		} {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session: dbgen.Session{Token: "token", UserID: test.user.ID},
					user:    test.user,
				}
				for _, request := range []struct {
					method string
					path   string
					body   string
				}{
					{http.MethodGet, "/api/admin/users", ""},
					{http.MethodGet, "/api/admin/boards", ""},
					{http.MethodPost, "/api/admin/users", `{"username":"newuser","email":"new@example.com","password":"password123"}`},
					{http.MethodPatch, "/api/admin/users/user1/role", `{"role":"admin"}`},
				} {
					response := send(newHandler(db, nil, false), request.method, request.path, request.body, test.cookie)
					if response.Code != test.want {
						t.Errorf("%s %s status = %d, want %d", request.method, request.path, response.Code, test.want)
					}
				}
			})
		}
	})

	t.Run("lists users without exposing password hashes", func(t *testing.T) {
		db := &fakeDB{
			session:    dbgen.Session{Token: "token", UserID: adminID},
			user:       admin,
			adminUsers: []dbgen.GetUsersForAdminRow{{ID: "member", FullName: "Member", Email: "member@example.com", Role: "user"}},
		}
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/admin/users", "", cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		var users []adminUserResponseTest
		if err := json.Unmarshal(response.Body.Bytes(), &users); err != nil {
			t.Fatalf("decode admin users: %v", err)
		}
		if len(users) != 1 || users[0].Username != "member" || users[0].Role != "user" {
			t.Fatalf("admin users = %#v", users)
		}
		if strings.Contains(response.Body.String(), "password_hash") {
			t.Fatal("user list exposed password hashes")
		}
	})

	t.Run("lists all boards with owner details", func(t *testing.T) {
		boardID := newUUID(7)
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: adminID},
			user:    admin,
			adminBoards: []dbgen.GetAllBoardsForAdminRow{{
				ID: boardID, Title: "Personal board", OwnerID: "member", FullName: "Member User",
			}},
		}
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/admin/boards", "", cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		var boards []struct {
			ID        pgtype.UUID `json:"id"`
			Title     string      `json:"title"`
			OwnerID   string      `json:"owner_id"`
			OwnerName string      `json:"owner_name"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &boards); err != nil {
			t.Fatalf("decode admin boards: %v", err)
		}
		if len(boards) != 1 || boards[0].ID != boardID || boards[0].Title != "Personal board" ||
			boards[0].OwnerID != "member" || boards[0].OwnerName != "Member User" {
			t.Fatalf("admin boards = %#v", boards)
		}
	})

	t.Run("returns an empty list when there are no boards", func(t *testing.T) {
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: adminID},
			user:    admin,
		}
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/admin/boards", "", cookie)
		if response.Code != http.StatusOK || response.Body.String() != "[]\n" {
			t.Fatalf("status=%d body=%q, want empty board list", response.Code, response.Body.String())
		}
	})

	t.Run("reports board query failures", func(t *testing.T) {
		db := &fakeDB{
			session:        dbgen.Session{Token: "token", UserID: adminID},
			user:           admin,
			adminBoardsErr: errors.New("query failed"),
		}
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/admin/boards", "", cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
		}
	})

	t.Run("reports response encoding failures", func(t *testing.T) {
		handler := newHandler(&fakeDB{
			session: dbgen.Session{Token: "token", UserID: adminID},
			user:    admin,
			adminBoards: []dbgen.GetAllBoardsForAdminRow{{
				ID: newUUID(8), Title: "Board", OwnerID: "member", FullName: "Member",
			}},
		}, nil, false)
		request := httptest.NewRequest(http.MethodGet, "/api/admin/boards", nil)
		request.AddCookie(cookie)
		writer := &failingResponseWriter{err: errors.New("write failed")}

		handler.ServeHTTP(writer, request)
		if writer.status != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d", writer.status, http.StatusInternalServerError)
		}
	})

	t.Run("creates a regular user with a hashed password", func(t *testing.T) {
		db := &fakeDB{session: dbgen.Session{Token: "token", UserID: adminID}, user: admin}
		tx := &fakeTx{fakeDB: db}
		response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false), http.MethodPost, "/api/admin/users",
			`{"username":" NewUser ","email":"new@example.com","password":"password123"}`, cookie)
		if response.Code != http.StatusCreated || !tx.committed {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if len(db.createUserArgs) != 5 || db.createUserArgs[0] != "newuser" ||
			db.createUserArgs[1] != "new@example.com" || db.createUserArgs[3] != "newuser" ||
			db.createUserArgs[4] != "user" {
			t.Fatalf("create user args = %#v", db.createUserArgs)
		}
		if len(db.boardArgs) != 2 || db.boardArgs[0] != "newuser" || db.boardArgs[1] != "newuser" {
			t.Fatalf("personal board args = %#v", db.boardArgs)
		}
		if err := bcrypt.CompareHashAndPassword([]byte(db.createUserArgs[2].(string)), []byte("password123")); err != nil {
			t.Fatalf("created password hash does not match: %v", err)
		}
		if strings.Contains(response.Body.String(), db.createUserArgs[2].(string)) {
			t.Fatal("create user response exposed password hash")
		}
	})

	t.Run("rolls back user creation if personal board creation fails", func(t *testing.T) {
		db := &fakeDB{
			session:        dbgen.Session{Token: "token", UserID: adminID},
			user:           admin,
			createBoardErr: errors.New("board insert failed"),
		}
		tx := &fakeTx{fakeDB: db}
		response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false), http.MethodPost, "/api/admin/users",
			`{"username":"newuser","email":"new@example.com","password":"password123"}`, cookie)
		if response.Code != http.StatusInternalServerError || tx.committed || !tx.rolledBack {
			t.Fatalf("status=%d committed=%t rolledBack=%t",
				response.Code, tx.committed, tx.rolledBack)
		}
	})

	t.Run("rejects invalid and duplicate users", func(t *testing.T) {
		for _, test := range []struct {
			name       string
			body       string
			createErr  error
			wantStatus int
		}{
			{name: "invalid username", body: `{"username":"bad name","email":"new@example.com","password":"password123"}`, wantStatus: http.StatusBadRequest},
			{name: "invalid email", body: `{"username":"newuser","email":"not-email","password":"password123"}`, wantStatus: http.StatusBadRequest},
			{name: "short password", body: `{"username":"newuser","email":"new@example.com","password":"short"}`, wantStatus: http.StatusBadRequest},
			{name: "duplicate", body: `{"username":"newuser","email":"new@example.com","password":"password123"}`, createErr: &pgconn.PgError{Code: "23505"}, wantStatus: http.StatusConflict},
		} {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session:         dbgen.Session{Token: "token", UserID: adminID},
					user:            admin,
					createUserError: test.createErr,
				}
				tx := &fakeTx{fakeDB: db}
				response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
					return tx, nil
				}, false), http.MethodPost, "/api/admin/users", test.body, cookie)
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
				}
			})
		}
	})

	t.Run("promotes another user but not the current admin", func(t *testing.T) {
		db := &fakeDB{session: dbgen.Session{Token: "token", UserID: adminID}, user: admin}
		response := send(newHandler(db, nil, false), http.MethodPatch, "/api/admin/users/member/role",
			`{"role":"admin"}`, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if len(db.updateUserRoleArgs) != 2 || db.updateUserRoleArgs[0] != "member" ||
			db.updateUserRoleArgs[1] != "admin" {
			t.Fatalf("role update args = %#v", db.updateUserRoleArgs)
		}

		selfPromotion := send(newHandler(db, nil, false), http.MethodPatch,
			"/api/admin/users/"+adminID+"/role", `{"role":"admin"}`, cookie)
		if selfPromotion.Code != http.StatusBadRequest {
			t.Fatalf("self-promotion status = %d, want %d", selfPromotion.Code, http.StatusBadRequest)
		}
	})
}

type adminUserResponseTest struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

func TestUpdatePasswordEndpoint(t *testing.T) {
	const ownerID = "owner1"
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	validBody := `{"current_password":"password123","new_password":"new-password","confirm_password":"new-password"}`

	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPut,
			"/api/profile/password", validBody, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("updates password after validating current password", func(t *testing.T) {
		user := newUser("password123")
		user.ID = ownerID
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    user,
		}
		response := send(newHandler(db, nil, false), http.MethodPut,
			"/api/profile/password", validBody, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if len(db.updatePasswordArgs) != 2 || db.updatePasswordArgs[0] != ownerID {
			t.Fatalf("password update args = %#v", db.updatePasswordArgs)
		}
		if err := bcrypt.CompareHashAndPassword([]byte(db.user.PasswordHash), []byte("new-password")); err != nil {
			t.Fatalf("stored password hash does not match new password: %v", err)
		}
		var body map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if body["message"] != "Password updated successfully" {
			t.Fatalf("response = %#v", body)
		}
	})

	t.Run("rejects invalid password fields", func(t *testing.T) {
		for _, body := range []string{
			`{`,
			`{"current_password":"password123","new_password":"","confirm_password":""}`,
			`{"current_password":"password123","new_password":"new-password","confirm_password":"different-password"}`,
			`{"current_password":"","new_password":"new-password","confirm_password":"new-password"}`,
			`{"current_password":"password123","new_password":"short","confirm_password":"short"}`,
			`{"current_password":"password123","new_password":"` + strings.Repeat("a", 73) + `","confirm_password":"` + strings.Repeat("a", 73) + `"}`,
		} {
			user := newUser("password123")
			user.ID = ownerID
			db := &fakeDB{
				session: dbgen.Session{Token: "token", UserID: ownerID},
				user:    user,
			}
			response := send(newHandler(db, nil, false), http.MethodPut,
				"/api/profile/password", body, cookie)
			if response.Code != http.StatusBadRequest {
				t.Errorf("body %q status = %d, want %d", body, response.Code, http.StatusBadRequest)
			}
			if len(db.updatePasswordArgs) != 0 {
				t.Errorf("invalid password request wrote to database: %#v", db.updatePasswordArgs)
			}
		}
	})

	t.Run("rejects an incorrect current password", func(t *testing.T) {
		user := newUser("password123")
		user.ID = ownerID
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    user,
		}
		body := `{"current_password":"incorrect","new_password":"new-password","confirm_password":"new-password"}`
		response := send(newHandler(db, nil, false), http.MethodPut,
			"/api/profile/password", body, cookie)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
		if len(db.updatePasswordArgs) != 0 {
			t.Fatalf("incorrect current password updated database: %#v", db.updatePasswordArgs)
		}
	})

	t.Run("reports lookup, session, and update failures", func(t *testing.T) {
		for _, test := range []struct {
			name       string
			db         *fakeDB
			wantStatus int
		}{
			{
				name: "session validation failure",
				db: &fakeDB{
					session:    dbgen.Session{Token: "token", UserID: ownerID},
					sessionErr: errors.New("session query failed"),
				},
				wantStatus: http.StatusInternalServerError,
			},
			{
				name: "missing user",
				db: &fakeDB{
					session: dbgen.Session{Token: "token", UserID: ownerID},
					userErr: pgx.ErrNoRows,
				},
				wantStatus: http.StatusNotFound,
			},
			{
				name: "user lookup failure",
				db: &fakeDB{
					session: dbgen.Session{Token: "token", UserID: ownerID},
					userErr: errors.New("user query failed"),
				},
				wantStatus: http.StatusInternalServerError,
			},
			{
				name: "password update failure",
				db: &fakeDB{
					session:           dbgen.Session{Token: "token", UserID: ownerID},
					user:              newUser("password123"),
					updatePasswordErr: errors.New("password update failed"),
				},
				wantStatus: http.StatusInternalServerError,
			},
		} {
			t.Run(test.name, func(t *testing.T) {
				test.db.user.ID = ownerID
				response := send(newHandler(test.db, nil, false), http.MethodPut,
					"/api/profile/password", validBody, cookie)
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
				}
			})
		}
	})
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
