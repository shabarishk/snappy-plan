package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"snappy-plan/backend"
	"snappy-plan/migrations"

	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultLaunchConfigPath = "/config/database.json"

var validDatabaseHost = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

type databaseSettings struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func (settings databaseSettings) connectionURL() (string, error) {
	settings.Host = strings.TrimSpace(settings.Host)
	settings.Database = strings.TrimSpace(settings.Database)
	settings.Username = strings.TrimSpace(settings.Username)
	if settings.Host == "" || settings.Port < 1 || settings.Port > 65535 ||
		settings.Database == "" || strings.ContainsAny(settings.Database, "/\x00") ||
		settings.Username == "" || settings.Password == "" || strings.ContainsRune(settings.Password, '\x00') {
		return "", errors.New("provide a valid database host, port, database name, username, and password")
	}
	if net.ParseIP(settings.Host) == nil && !validDatabaseHost.MatchString(settings.Host) {
		return "", errors.New("database host must be a container name, DNS name, or IP address")
	}

	u := url.URL{
		Scheme:   "postgres",
		Host:     net.JoinHostPort(settings.Host, strconv.Itoa(settings.Port)),
		User:     url.UserPassword(settings.Username, settings.Password),
		Path:     "/" + settings.Database,
		RawQuery: "sslmode=disable",
	}
	if _, err := pgxpool.ParseConfig(u.String()); err != nil {
		return "", errors.New("invalid PostgreSQL connection settings")
	}
	return u.String(), nil
}

type launchRuntime struct {
	mu                    sync.RWMutex
	configureMu           sync.Mutex
	active                http.Handler
	configured            bool
	configPath            string
	setupToken            string
	secureCookie          bool
	retryInitialDelay     time.Duration
	retryMaxDelay         time.Duration
	retryAttemptTimeout   time.Duration
	frontend              http.Handler
	frontendFiles         fs.FS
	pingDatabase          func(context.Context, *pgxpool.Pool) error
	applySchemaMigrations func(context.Context, *pgxpool.Pool) error
	ensureSchema          func(context.Context, *pgxpool.Pool) error
	newAppHandler         func(*pgxpool.Pool) http.Handler
}

func newLaunchRuntime(configPath, setupToken string, secureCookie bool, frontendFiles fs.FS) *launchRuntime {
	if configPath == "" {
		configPath = defaultLaunchConfigPath
	}
	runtime := &launchRuntime{
		configPath:          configPath,
		setupToken:          setupToken,
		secureCookie:        secureCookie,
		retryInitialDelay:   5 * time.Second,
		retryMaxDelay:       time.Minute,
		retryAttemptTimeout: 15 * time.Second,
		frontend:            backend.NewFrontendHandler(frontendFiles),
		frontendFiles:       frontendFiles,
	}
	runtime.pingDatabase = func(ctx context.Context, pool *pgxpool.Pool) error {
		return pool.Ping(ctx)
	}
	runtime.applySchemaMigrations = migrations.Apply
	runtime.ensureSchema = func(ctx context.Context, pool *pgxpool.Pool) error {
		return ensureApplicationSchema(ctx, func(ctx context.Context) (backend.SetupTransaction, error) {
			return pool.Begin(ctx)
		})
	}
	runtime.newAppHandler = func(pool *pgxpool.Pool) http.Handler {
		return backend.NewHandlerWithSetupToken(pool, func(ctx context.Context) (backend.SetupTransaction, error) {
			return pool.Begin(ctx)
		}, runtime.secureCookie, runtime.setupToken, runtime.frontendFiles)
	}
	return runtime
}

func (runtime *launchRuntime) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/launch/status", runtime.handleStatus)
	mux.HandleFunc("POST /api/launch/configure", runtime.handleConfigure)
	mux.Handle("/", http.HandlerFunc(runtime.serveApplication))
	return mux
}

func (runtime *launchRuntime) activateSavedConfig(ctx context.Context) error {
	runtime.configureMu.Lock()
	defer runtime.configureMu.Unlock()
	data, err := os.ReadFile(runtime.configPath)
	if err != nil {
		return err
	}
	var settings databaseSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return fmt.Errorf("decode saved database settings: %w", err)
	}
	if _, err := settings.connectionURL(); err != nil {
		return fmt.Errorf("validate saved database settings: %w", err)
	}
	runtime.mu.Lock()
	runtime.configured = true
	runtime.mu.Unlock()
	return runtime.activate(ctx, settings, false)
}

func (runtime *launchRuntime) handleStatus(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	runtime.mu.RLock()
	connected := runtime.active != nil
	configured := runtime.configured
	runtime.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{
		"launch_required": !configured,
		"database_ready":  connected,
	})
}

func (runtime *launchRuntime) handleConfigure(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if len(runtime.setupToken) < 32 {
		http.Error(w, "Configure SNAPPY_SETUP_TOKEN with at least 32 characters and restart the container.", http.StatusServiceUnavailable)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Setup-Token")), []byte(runtime.setupToken)) != 1 {
		http.Error(w, "Setup authorization required", http.StatusUnauthorized)
		return
	}
	runtime.configureMu.Lock()
	defer runtime.configureMu.Unlock()
	runtime.mu.RLock()
	connected := runtime.active != nil
	runtime.mu.RUnlock()
	if connected {
		http.Error(w, "Database is already configured", http.StatusConflict)
		return
	}

	var request struct {
		databaseSettings
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&request); err != nil {
		http.Error(w, "Invalid setup request", http.StatusBadRequest)
		return
	}
	if _, err := request.databaseSettings.connectionURL(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	if err := runtime.activate(ctx, request.databaseSettings, true); err != nil {
		log.Printf("PostgreSQL launch setup failed: %v", err)
		http.Error(w, "Could not connect to or initialize PostgreSQL. Verify the host, port, database, credentials, and database-user permissions, then try again.", http.StatusBadGateway)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (runtime *launchRuntime) activate(ctx context.Context, settings databaseSettings, persist bool) error {
	databaseURL, err := settings.connectionURL()
	if err != nil {
		return err
	}
	if persist {
		return runtime.activateURL(ctx, databaseURL, &settings, true)
	}
	return runtime.activateURL(ctx, databaseURL, nil, false)
}

func (runtime *launchRuntime) activateURL(ctx context.Context, databaseURL string, settings *databaseSettings, persist bool) error {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("create PostgreSQL pool: %w", err)
	}
	keepPool := false
	defer func() {
		if !keepPool {
			pool.Close()
		}
	}()
	if err := runtime.pingDatabase(ctx, pool); err != nil {
		return fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	if err := runtime.applySchemaMigrations(ctx, pool); err != nil {
		return fmt.Errorf("apply initial schema: %w", err)
	}
	if err := runtime.ensureSchema(ctx, pool); err != nil {
		return err
	}
	if persist {
		if settings == nil {
			return errors.New("database settings are required to persist configuration")
		}
		if err := saveDatabaseSettings(runtime.configPath, *settings); err != nil {
			return fmt.Errorf("save database settings: %w", err)
		}
	}

	handler := runtime.newAppHandler(pool)
	runtime.mu.Lock()
	runtime.active = handler
	runtime.configured = true
	runtime.mu.Unlock()
	keepPool = true
	return nil
}

func (runtime *launchRuntime) retrySavedConfig(ctx context.Context) {
	delay := runtime.retryInitialDelay
	for {
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}

		runtime.mu.RLock()
		connected := runtime.active != nil
		runtime.mu.RUnlock()
		if connected {
			return
		}

		attemptCtx, cancel := context.WithTimeout(ctx, runtime.retryAttemptTimeout)
		err := runtime.activateSavedConfig(attemptCtx)
		cancel()
		if err == nil {
			log.Println("Reconnected to PostgreSQL using saved configuration.")
			return
		}
		log.Printf("PostgreSQL reconnect using saved configuration failed: %v", err)
		if delay < runtime.retryMaxDelay {
			delay *= 2
			if delay > runtime.retryMaxDelay {
				delay = runtime.retryMaxDelay
			}
		}
	}
}

func ensureApplicationSchema(ctx context.Context, beginTx func(context.Context) (backend.SetupTransaction, error)) error {
	if err := backend.EnsureUserIDSchema(ctx, beginTx); err != nil {
		return fmt.Errorf("update user ID schema: %w", err)
	}
	if err := backend.EnsureTaskSchema(ctx, beginTx); err != nil {
		return fmt.Errorf("update task schema: %w", err)
	}
	if err := backend.EnsureInitiativeSchema(ctx, beginTx); err != nil {
		return fmt.Errorf("update initiative schema: %w", err)
	}
	if err := upgradeProfileSchemas(ctx, beginTx); err != nil {
		return err
	}
	if err := backend.EnsurePersonalBoards(ctx, beginTx); err != nil {
		return fmt.Errorf("create personal boards: %w", err)
	}
	return nil
}

func saveDatabaseSettings(path string, settings databaseSettings) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	data, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("encode database settings: %w", err)
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".database-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary settings file: %w", err)
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0600); err != nil {
		_ = temp.Close()
		return fmt.Errorf("set database settings permissions: %w", err)
	}
	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		return fmt.Errorf("write database settings: %w", err)
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return fmt.Errorf("sync database settings: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close database settings: %w", err)
	}
	if err := os.Rename(tempName, path); err != nil {
		return fmt.Errorf("install database settings: %w", err)
	}
	return nil
}

func (runtime *launchRuntime) serveApplication(w http.ResponseWriter, r *http.Request) {
	runtime.mu.RLock()
	active := runtime.active
	runtime.mu.RUnlock()
	if active != nil {
		active.ServeHTTP(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		w.Header().Set("Cache-Control", "no-store")
		http.Error(w, "Database setup is required", http.StatusServiceUnavailable)
		return
	}
	runtime.frontend.ServeHTTP(w, r)
}
