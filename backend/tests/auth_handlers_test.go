package backend_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"snappy-plan/backend"
	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

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
			txDB.createUserArgs[0] != "adminuser" || txDB.createUserArgs[4] != "" ||
			txDB.createUserArgs[5] != "admin" {
			t.Fatalf("status = %d; committed = %t; args = %#v", response.Code, tx.committed, txDB.createUserArgs)
		}
		if len(txDB.boardArgs) != 2 || txDB.boardArgs[0] != "Admin User's personal board" || txDB.boardArgs[1] != "adminuser" ||
			!txDB.board.IsPersonal {
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

func TestSetupEndpointRequiresConfiguredSetupToken(t *testing.T) {
	validBody := `{"username":"admin1","email":"admin@example.com","full_name":"Admin User","password":"password123"}`
	txDB := &fakeDB{user: newUser("")}
	tx := &fakeTx{fakeDB: txDB}
	handler := backend.NewHandlerWithSetupToken(&fakeDB{}, func(context.Context) (backend.SetupTransaction, error) {
		return tx, nil
	}, false, "0123456789abcdef0123456789abcdef", nil)

	unauthorized := send(handler, http.MethodPost, "/api/setup", validBody, nil)
	if unauthorized.Code != http.StatusUnauthorized || tx.committed {
		t.Fatalf("missing setup key status = %d; committed = %t", unauthorized.Code, tx.committed)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/setup", strings.NewReader(validBody))
	request.Header.Set("X-Setup-Token", "0123456789abcdef0123456789abcdef")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated || !tx.committed {
		t.Fatalf("valid setup key status = %d; committed = %t", response.Code, tx.committed)
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
