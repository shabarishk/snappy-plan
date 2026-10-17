package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"testing/fstest"

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
