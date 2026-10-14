package backend

import (
	"context"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
)

type SetupTransaction interface {
	dbgen.DBTX
	Commit(context.Context) error
	Rollback(context.Context) error
}

var _ SetupTransaction = (pgx.Tx)(nil)

type ApiConfig struct {
	DB           *dbgen.Queries
	BeginTx      func(context.Context) (SetupTransaction, error)
	SecureCookie bool
}

func NewHandler(db dbgen.DBTX, beginTx func(context.Context) (SetupTransaction, error), secureCookie bool, frontendFiles fs.FS) http.Handler {
	api := &ApiConfig{DB: dbgen.New(db), BeginTx: beginTx, SecureCookie: secureCookie}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/setup/status", api.handleSetupStatus)
	mux.HandleFunc("POST /api/setup", api.handleInitialSetup)
	mux.HandleFunc("POST /api/login", api.handleLogin)
	mux.HandleFunc("POST /api/logout", api.handleLogout)
	mux.HandleFunc("GET /api/auth/status", api.handleAuthStatus)
	mux.HandleFunc("POST /api/boards", api.handleCreateBoard)
	mux.HandleFunc("GET /api/boards", api.handleGetBoards)
	mux.HandleFunc("DELETE /api/boards/{boardID}", api.handleDeleteBoard)
	mux.HandleFunc("GET /api/boards/{boardID}/members", api.handleGetBoardMembers)
	mux.HandleFunc("PUT /api/boards/{boardID}/members", api.handleUpdateBoardMembers)
	mux.HandleFunc("GET /api/tasks", api.handleGetTasks)
	mux.HandleFunc("POST /api/tasks", api.handleCreateTask)
	mux.HandleFunc("PATCH /api/tasks/{taskID}", api.handleMoveTask)
	mux.HandleFunc("PUT /api/tasks/{taskID}", api.handleUpdateTask)
	mux.HandleFunc("GET /api/users", api.handleGetUsersForAssignment)
	mux.HandleFunc("GET /api/profile", api.handleGetProfile)
	mux.HandleFunc("PUT /api/profile", api.handleUpdateProfile)
	mux.HandleFunc("PUT /api/profile/password", api.handleUpdatePassword)
	mux.HandleFunc("GET /api/admin/users", api.handleGetUsersForAdmin)
	mux.HandleFunc("GET /api/admin/boards", api.handleGetBoardsForAdmin)
	mux.HandleFunc("POST /api/admin/users", api.handleCreateUser)
	mux.HandleFunc("PATCH /api/admin/users/{userID}/role", api.handlePromoteUser)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Snappy Plan Backend is running!"))
	})
	mux.Handle("/api/", http.NotFoundHandler())
	mux.Handle("/", frontendHandler(frontendFiles))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		mux.ServeHTTP(w, r)
	})
}

func frontendHandler(files fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(files))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if _, err := fs.Stat(files, name); err != nil {
			if path.Ext(name) != "" {
				http.NotFound(w, r)
				return
			}
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		}
		if r.URL.Path == "/" || r.URL.Path == "/index.html" ||
			r.URL.Path == "/sw.js" || r.URL.Path == "/registerSW.js" {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		}
		fileServer.ServeHTTP(w, r)
	})
}

type profileResponse struct {
	Username string `json:"username"`
	FullName string `json:"full_name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
}
