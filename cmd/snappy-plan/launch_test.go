package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"snappy-plan/backend"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDatabaseSettingsConnectionURL(t *testing.T) {
	settings := databaseSettings{
		Host:     "postgres-db",
		Port:     5432,
		Database: "snappyplan",
		Username: "snappy user",
		Password: "p@ss:/?word",
	}
	connectionURL, err := settings.connectionURL()
	if err != nil {
		t.Fatalf("connectionURL returned an error: %v", err)
	}
	parsed, err := url.Parse(connectionURL)
	if err != nil {
		t.Fatalf("parse connection URL: %v", err)
	}
	if parsed.Host != "postgres-db:5432" || parsed.Path != "/snappyplan" ||
		parsed.User.Username() != "snappy user" {
		t.Fatalf("unexpected PostgreSQL URL: %#v", parsed)
	}
	password, _ := parsed.User.Password()
	if password != settings.Password {
		t.Fatal("database password was not safely encoded in the connection URL")
	}
	if _, err := pgxpool.ParseConfig(connectionURL); err != nil {
		t.Fatalf("pgx rejected generated connection URL: %v", err)
	}
}

func TestDatabaseSettingsConnectionURLRejectsInvalidInputs(t *testing.T) {
	for _, settings := range []databaseSettings{
		{Host: "db/path", Port: 5432, Database: "snappyplan", Username: "user", Password: "pass"},
		{Host: "postgres-db", Port: 0, Database: "snappyplan", Username: "user", Password: "pass"},
		{Host: "postgres-db", Port: 5432, Database: "../other", Username: "user", Password: "pass"},
		{Host: "postgres-db", Port: 5432, Database: "snappyplan", Username: "", Password: "pass"},
	} {
		if _, err := settings.connectionURL(); err == nil {
			t.Errorf("connectionURL accepted invalid settings: %#v", settings)
		}
	}
}

func TestLaunchRoutesRequireSetupKey(t *testing.T) {
	const setupToken = "0123456789abcdef0123456789abcdef"
	runtime := newLaunchRuntime("/unused/database.json", setupToken, false, fstest.MapFS{
		"index.html": {Data: []byte("frontend")},
	})
	handler := runtime.handler()

	status := httptest.NewRecorder()
	handler.ServeHTTP(status, httptest.NewRequest(http.MethodGet, "/api/launch/status", nil))
	var response map[string]bool
	if err := json.Unmarshal(status.Body.Bytes(), &response); err != nil || !response["launch_required"] {
		t.Fatalf("launch status = %s, error = %v", status.Body.String(), err)
	}

	for _, token := range []string{"", "wrong"} {
		request := httptest.NewRequest(http.MethodPost, "/api/launch/configure", nil)
		request.Header.Set("X-Setup-Token", token)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusUnauthorized {
			t.Errorf("status for token %q = %d, want %d", token, recorder.Code, http.StatusUnauthorized)
		}
	}

	request := httptest.NewRequest(http.MethodPost, "/api/launch/configure", nil)
	request.Header.Set("X-Setup-Token", setupToken)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("invalid request status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestLaunchRuntimeServesFrontendButBlocksAppAPIs(t *testing.T) {
	runtime := newLaunchRuntime("/unused/database.json", "launch-secret", false, fstest.MapFS{
		"index.html": {Data: []byte("frontend")},
	})
	handler := runtime.handler()

	page := httptest.NewRecorder()
	handler.ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/", nil))
	if page.Code != http.StatusOK || page.Body.String() != "frontend" {
		t.Fatalf("frontend response = %d %q", page.Code, page.Body.String())
	}

	api := httptest.NewRecorder()
	handler.ServeHTTP(api, httptest.NewRequest(http.MethodGet, "/api/auth/status", nil))
	if api.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured API status = %d, want %d", api.Code, http.StatusServiceUnavailable)
	}
}

func TestLaunchConfigurePersistsDatabaseAndActivatesApp(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config", "database.json")
	runtime := newLaunchRuntime(configPath, strings.Repeat("k", 32), true, fstest.MapFS{
		"index.html": {Data: []byte("frontend")},
	})
	runtime.pingDatabase = func(context.Context, *pgxpool.Pool) error { return nil }
	runtime.applySchemaMigrations = func(context.Context, *pgxpool.Pool) error { return nil }
	runtime.ensureSchema = func(context.Context, *pgxpool.Pool) error { return nil }
	runtime.newAppHandler = func(*pgxpool.Pool) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})
	}
	handler := runtime.handler()

	request := httptest.NewRequest(http.MethodPost, "/api/launch/configure", strings.NewReader(validDatabaseSettingsJSON))
	request.Header.Set("X-Setup-Token", runtime.setupToken)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("configure status = %d, body %q", response.Code, response.Body.String())
	}

	status := httptest.NewRecorder()
	handler.ServeHTTP(status, httptest.NewRequest(http.MethodGet, "/api/launch/status", nil))
	var statusBody map[string]bool
	if err := json.Unmarshal(status.Body.Bytes(), &statusBody); err != nil || statusBody["launch_required"] {
		t.Fatalf("launch status = %q, error = %v", status.Body.String(), err)
	}

	saved, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read saved database settings: %v", err)
	}
	var settings databaseSettings
	if err := json.Unmarshal(saved, &settings); err != nil {
		t.Fatalf("decode saved database settings: %v", err)
	}
	if settings.Host != "postgres-db" || settings.Password != "database-secret" {
		t.Fatalf("saved database settings = %#v", settings)
	}

	duplicate := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/launch/configure", strings.NewReader("{}"))
	request.Header.Set("X-Setup-Token", runtime.setupToken)
	handler.ServeHTTP(duplicate, request)
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate configure status = %d, want %d", duplicate.Code, http.StatusConflict)
	}
}

func TestLaunchConfigureErrors(t *testing.T) {
	const setupToken = "0123456789abcdef0123456789abcdef"
	tests := []struct {
		name        string
		configPath  string
		token       string
		headerToken string
		body        string
		pingErr     error
		migrateErr  error
		schemaErr   error
		wantStatus  int
	}{
		{name: "setup key missing from environment", token: "too-short", wantStatus: http.StatusServiceUnavailable},
		{name: "setup key mismatch", token: setupToken, wantStatus: http.StatusUnauthorized},
		{name: "invalid JSON", token: setupToken, headerToken: setupToken, body: `{`, wantStatus: http.StatusBadRequest},
		{name: "invalid settings", token: setupToken, headerToken: setupToken, body: `{}`, wantStatus: http.StatusBadRequest},
		{name: "database unreachable", token: setupToken, headerToken: setupToken, body: validDatabaseSettingsJSON, pingErr: errors.New("unreachable"), wantStatus: http.StatusBadGateway},
		{name: "migration failure", token: setupToken, headerToken: setupToken, body: validDatabaseSettingsJSON, migrateErr: errors.New("migration failure"), wantStatus: http.StatusBadGateway},
		{name: "schema upgrade failure", token: setupToken, headerToken: setupToken, body: validDatabaseSettingsJSON, schemaErr: errors.New("schema failure"), wantStatus: http.StatusBadGateway},
		{name: "cannot persist credentials", token: setupToken, headerToken: setupToken, configPath: filepath.Join(t.TempDir(), "blocked", "database.json"), body: validDatabaseSettingsJSON, wantStatus: http.StatusBadGateway},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			configPath := test.configPath
			if test.name == "cannot persist credentials" {
				blockedDirectory := filepath.Dir(configPath)
				if err := os.WriteFile(blockedDirectory, []byte("not a directory"), 0600); err != nil {
					t.Fatalf("create invalid config parent: %v", err)
				}
			}
			if configPath == "" {
				configPath = filepath.Join(t.TempDir(), "database.json")
			}
			runtime := newLaunchRuntime(configPath, test.token, false, fstest.MapFS{
				"index.html": {Data: []byte("frontend")},
			})
			runtime.pingDatabase = func(context.Context, *pgxpool.Pool) error { return test.pingErr }
			runtime.applySchemaMigrations = func(context.Context, *pgxpool.Pool) error { return test.migrateErr }
			runtime.ensureSchema = func(context.Context, *pgxpool.Pool) error { return test.schemaErr }
			runtime.newAppHandler = func(*pgxpool.Pool) http.Handler { return http.NotFoundHandler() }

			request := httptest.NewRequest(http.MethodPost, "/api/launch/configure", strings.NewReader(test.body))
			request.Header.Set("X-Setup-Token", test.headerToken)
			response := httptest.NewRecorder()
			runtime.handler().ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, body %q; want %d", response.Code, response.Body.String(), test.wantStatus)
			}
		})
	}
}

func TestActivateSavedConfig(t *testing.T) {
	for _, test := range []struct {
		name      string
		contents  string
		wantError string
		notExist  bool
	}{
		{name: "missing settings", notExist: true},
		{name: "invalid JSON", contents: `{`, wantError: "decode saved database settings"},
		{name: "connection failure", contents: validDatabaseSettingsJSON, wantError: "connect to PostgreSQL"},
	} {
		t.Run(test.name, func(t *testing.T) {
			configPath := filepath.Join(t.TempDir(), "database.json")
			if test.contents != "" {
				if err := os.WriteFile(configPath, []byte(test.contents), 0600); err != nil {
					t.Fatalf("write saved config: %v", err)
				}
			}
			runtime := newLaunchRuntime(configPath, strings.Repeat("k", 32), false, fstest.MapFS{
				"index.html": {Data: []byte("frontend")},
			})
			if test.name == "connection failure" {
				runtime.pingDatabase = func(context.Context, *pgxpool.Pool) error { return errors.New("unreachable") }
			}
			err := runtime.activateSavedConfig(context.Background())
			if err == nil || (test.notExist && !errors.Is(err, os.ErrNotExist)) ||
				(!test.notExist && !strings.Contains(err.Error(), test.wantError)) {
				t.Fatalf("activateSavedConfig error = %v, want containing %q", err, test.wantError)
			}
		})
	}
}

func TestActivateURLRejectsInvalidConnectionConfig(t *testing.T) {
	runtime := newLaunchRuntime(filepath.Join(t.TempDir(), "database.json"), strings.Repeat("k", 32), false, fstest.MapFS{})
	if err := runtime.activate(context.Background(), databaseSettings{}, false); err == nil {
		t.Fatal("activate accepted missing database settings")
	}
	runtime.pingDatabase = func(context.Context, *pgxpool.Pool) error { return nil }
	runtime.applySchemaMigrations = func(context.Context, *pgxpool.Pool) error { return nil }
	runtime.ensureSchema = func(context.Context, *pgxpool.Pool) error { return nil }
	if err := runtime.activateURL(context.Background(), "not-a-postgres-url", nil, false); err == nil ||
		!strings.Contains(err.Error(), "create PostgreSQL pool") {
		t.Fatalf("invalid URL error = %v", err)
	}
	if err := runtime.activateURL(context.Background(), validDatabaseSettingsURL, nil, true); err == nil ||
		!strings.Contains(err.Error(), "database settings are required") {
		t.Fatalf("missing settings error = %v", err)
	}
}

func TestEnsureApplicationSchema(t *testing.T) {
	var transactions []*startupSchemaTx
	begin := func(context.Context) (backend.SetupTransaction, error) {
		tx := &startupSchemaTx{}
		transactions = append(transactions, tx)
		return tx, nil
	}
	if err := ensureApplicationSchema(context.Background(), begin); err != nil {
		t.Fatalf("ensureApplicationSchema returned an error: %v", err)
	}
	if len(transactions) != 6 {
		t.Fatalf("schema transaction count = %d, want 6", len(transactions))
	}
	for i, tx := range transactions {
		if !tx.committed || len(tx.execCalls) == 0 {
			t.Errorf("transaction %d was not applied and committed: %#v", i, tx)
		}
	}
}

func TestRunLaunchServer(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "database.json")
	values := map[string]string{
		"SNAPPY_CONFIG_FILE": configPath,
		"SNAPPY_SETUP_TOKEN": strings.Repeat("k", 32),
		"COOKIE_SECURE":      "true",
	}
	listenCalls := 0
	err := runLaunchServer(func(key string) string { return values[key] }, func(address string, handler http.Handler) error {
		listenCalls++
		if address != ":8080" {
			t.Fatalf("listen address = %q, want :8080", address)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/launch/status", nil))
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"launch_required":true`) {
			t.Fatalf("launch status = %d %q", response.Code, response.Body.String())
		}
		return nil
	})
	if err != nil {
		t.Fatalf("runLaunchServer returned an error: %v", err)
	}
	if listenCalls != 1 {
		t.Fatalf("listen calls = %d, want 1", listenCalls)
	}

	listenErr := errors.New("listen failed")
	err = runLaunchServer(func(string) string { return "" }, func(string, http.Handler) error {
		return listenErr
	})
	if !errors.Is(err, listenErr) {
		t.Fatalf("runLaunchServer error = %v, want %v", err, listenErr)
	}
}

const validDatabaseSettingsJSON = `{"host":"postgres-db","port":5432,"database":"snappyplan","username":"snappy","password":"database-secret"}`
const validDatabaseSettingsURL = "postgres://snappy:database-secret@postgres-db:5432/snappyplan?sslmode=disable"
