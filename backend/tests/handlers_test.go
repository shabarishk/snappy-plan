package backend_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
	boardArgs          []any
	sessionArgs        []any
	createUserArgs     []any
	createBoardErr     error
	createSessionError error
	createUserError    error
}

func (db *fakeDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (db *fakeDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected query")
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
		case *pgtype.UUID:
			*target = value.(pgtype.UUID)
		case *pgtype.Timestamptz:
			*target = value.(pgtype.Timestamptz)
		default:
			return errors.New("unexpected scan destination")
		}
	}
	return nil
}

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
	return backend.NewHandler(db, beginTx, secureCookie)
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

func TestHealthEndpoint(t *testing.T) {
	response := send(newHandler(&fakeDB{}, nil, false), http.MethodGet, "/api/health", "", nil)
	if response.Code != http.StatusOK || response.Body.String() != "Snappy Plan Backend is running!" {
		t.Fatalf("health response = %d %q", response.Code, response.Body.String())
	}
}
