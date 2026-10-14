package backend

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/mail"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
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
	mux.HandleFunc("GET /api/tasks", api.handleGetTasks)
	mux.HandleFunc("POST /api/tasks", api.handleCreateTask)
	mux.HandleFunc("PATCH /api/tasks/{taskID}", api.handleMoveTask)
	mux.HandleFunc("PUT /api/tasks/{taskID}", api.handleUpdateTask)
	mux.HandleFunc("GET /api/users", api.handleGetUsersForAssignment)
	mux.HandleFunc("GET /api/profile", api.handleGetProfile)
	mux.HandleFunc("PUT /api/profile", api.handleUpdateProfile)
	mux.HandleFunc("PUT /api/profile/password", api.handleUpdatePassword)
	mux.HandleFunc("GET /api/admin/users", api.handleGetUsersForAdmin)
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

// Check if the application requires first-time setup
func (api *ApiConfig) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	count, err := api.DB.CountUsers(r.Context())
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{
		"setup_required": count == 0,
	})
}

// Handle the one-time creation of the Admin account
func (api *ApiConfig) handleInitialSetup(w http.ResponseWriter, r *http.Request) {
	type setupParams struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
		FullName string `json:"full_name"`
	}

	var params setupParams
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	params.Username = strings.ToLower(strings.TrimSpace(params.Username))
	params.Email = strings.TrimSpace(params.Email)
	params.FullName = strings.TrimSpace(params.FullName)
	address, err := mail.ParseAddress(params.Email)
	if !isAlphanumeric(params.Username) || len(params.Username) > 32 ||
		err != nil || address.Address != params.Email || params.FullName == "" ||
		len(params.Password) < 8 || len(params.Password) > 72 {
		http.Error(w, "Provide an alphanumeric username of at most 32 characters, a valid email, full name, and password of 8 to 72 bytes", http.StatusBadRequest)
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(params.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Failed to secure password", http.StatusInternalServerError)
		return
	}

	if api.BeginTx == nil {
		http.Error(w, "Setup is unavailable", http.StatusInternalServerError)
		return
	}
	// Serialize first-run requests so only one can observe an empty users table.
	tx, err := api.BeginTx(r.Context())
	if err != nil {
		http.Error(w, "Failed to initialize setup", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock($1)", int64(731942610)); err != nil {
		http.Error(w, "Failed to initialize setup", http.StatusInternalServerError)
		return
	}
	txQueries := dbgen.New(tx)
	count, err := txQueries.CountUsers(r.Context())
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	if count > 0 {
		http.Error(w, "Setup already complete. Please log in.", http.StatusForbidden)
		return
	}

	user, err := txQueries.CreateUser(r.Context(), dbgen.CreateUserParams{
		ID:           params.Username,
		Email:        params.Email,
		PasswordHash: string(hashedPassword),
		FullName:     params.FullName,
		Role:         "admin",
	})
	if err != nil {
		http.Error(w, "Failed to create admin user", http.StatusInternalServerError)
		return
	}
	if _, err := txQueries.CreateBoard(r.Context(), dbgen.CreateBoardParams{
		Title:   user.FullName,
		OwnerID: user.ID,
	}); err != nil {
		http.Error(w, "Failed to create personal board", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "Failed to create admin user", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Admin account created successfully",
		"user_id": user.ID,
	})
}

func isAlphanumeric(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') {
			return false
		}
	}
	return true
}

// handleCreateBoard is a method attached to ApiConfig
func (api *ApiConfig) handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	type parameters struct {
		Title string `json:"title"`
	}

	var params parameters
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	params.Title = strings.TrimSpace(params.Title)
	if params.Title == "" {
		http.Error(w, "Board title is required", http.StatusBadRequest)
		return
	}

	board, err := api.DB.CreateBoard(r.Context(), dbgen.CreateBoardParams{
		Title:   params.Title,
		OwnerID: session.UserID,
	})

	if err != nil {
		http.Error(w, "Failed to create board", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(board)
}

func (api *ApiConfig) handleGetBoards(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	boards, err := api.DB.GetBoardsByOwner(r.Context(), session.UserID)
	if err != nil {
		http.Error(w, "Failed to load boards", http.StatusInternalServerError)
		return
	}
	if boards == nil {
		boards = []dbgen.Board{}
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(boards); err != nil {
		http.Error(w, "Failed to encode boards", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleGetTasks(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	tasks, err := api.DB.GetTasksByOwner(r.Context(), session.UserID)
	if err != nil {
		http.Error(w, "Failed to load tasks", http.StatusInternalServerError)
		return
	}
	if tasks == nil {
		tasks = []dbgen.Task{}
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(tasks); err != nil {
		http.Error(w, "Failed to encode tasks", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleGetUsersForAssignment(w http.ResponseWriter, r *http.Request) {
	_, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	users, err := api.DB.GetUsersForAssignment(r.Context())
	if err != nil {
		http.Error(w, "Failed to load users", http.StatusInternalServerError)
		return
	}
	if users == nil {
		users = []dbgen.GetUsersForAssignmentRow{}
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(users); err != nil {
		http.Error(w, "Failed to encode users", http.StatusInternalServerError)
	}
}

type adminUserResponse struct {
	Username string `json:"username"`
	FullName string `json:"full_name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
}

func (api *ApiConfig) requireAdmin(w http.ResponseWriter, r *http.Request) (dbgen.Session, bool) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return dbgen.Session{}, false
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return dbgen.Session{}, false
	}

	user, err := api.DB.GetUserByID(r.Context(), session.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return dbgen.Session{}, false
	}
	if err != nil {
		http.Error(w, "Failed to validate administrator", http.StatusInternalServerError)
		return dbgen.Session{}, false
	}
	if user.Role != "admin" {
		http.Error(w, "Administrator access required", http.StatusForbidden)
		return dbgen.Session{}, false
	}
	return session, true
}

func (api *ApiConfig) handleGetUsersForAdmin(w http.ResponseWriter, r *http.Request) {
	if _, ok := api.requireAdmin(w, r); !ok {
		return
	}
	users, err := api.DB.GetUsersForAdmin(r.Context())
	if err != nil {
		http.Error(w, "Failed to load users", http.StatusInternalServerError)
		return
	}
	responseUsers := make([]adminUserResponse, 0, len(users))
	for _, user := range users {
		responseUsers = append(responseUsers, adminUserResponse{
			Username: user.ID,
			FullName: user.FullName,
			Email:    user.Email,
			Role:     user.Role,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(responseUsers); err != nil {
		http.Error(w, "Failed to encode users", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if _, ok := api.requireAdmin(w, r); !ok {
		return
	}
	var params struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	params.Username = strings.ToLower(strings.TrimSpace(params.Username))
	params.Email = strings.TrimSpace(params.Email)
	address, err := mail.ParseAddress(params.Email)
	if !isAlphanumeric(params.Username) || len(params.Username) > 32 ||
		utf8.RuneCountInString(params.Email) > 255 || err != nil || address.Address != params.Email ||
		len(params.Password) < 8 || len(params.Password) > 72 {
		http.Error(w, "Provide an alphanumeric username of at most 32 characters, a valid email, and a password of 8 to 72 bytes", http.StatusBadRequest)
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(params.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Failed to secure password", http.StatusInternalServerError)
		return
	}
	if api.BeginTx == nil {
		http.Error(w, "User creation is unavailable", http.StatusInternalServerError)
		return
	}
	tx, err := api.BeginTx(r.Context())
	if err != nil {
		http.Error(w, "Failed to start user creation", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(context.Background())
	txQueries := dbgen.New(tx)
	user, err := txQueries.CreateUser(r.Context(), dbgen.CreateUserParams{
		ID:           params.Username,
		Email:        params.Email,
		PasswordHash: string(passwordHash),
		FullName:     params.Username,
		Role:         "user",
	})
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) && databaseError.Code == "23505" {
		http.Error(w, "Username or email address is already in use", http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}
	if _, err := txQueries.CreateBoard(r.Context(), dbgen.CreateBoardParams{
		Title:   user.FullName,
		OwnerID: user.ID,
	}); err != nil {
		http.Error(w, "Failed to create personal board", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(adminUserResponse{
		Username: user.ID,
		FullName: user.FullName,
		Email:    user.Email,
		Role:     user.Role,
	}); err != nil {
		http.Error(w, "Failed to encode created user", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handlePromoteUser(w http.ResponseWriter, r *http.Request) {
	session, ok := api.requireAdmin(w, r)
	if !ok {
		return
	}
	userID := strings.ToLower(strings.TrimSpace(r.PathValue("userID")))
	if !isAlphanumeric(userID) || len(userID) > 32 {
		http.Error(w, "Username is invalid", http.StatusBadRequest)
		return
	}
	if userID == session.UserID {
		http.Error(w, "You cannot change your own administrator role", http.StatusBadRequest)
		return
	}
	var params struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if params.Role != "admin" {
		http.Error(w, "Role must be admin", http.StatusBadRequest)
		return
	}

	user, err := api.DB.UpdateUserRole(r.Context(), dbgen.UpdateUserRoleParams{
		ID: userID, Role: params.Role,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Failed to update user role", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(adminUserResponse{
		Username: user.ID,
		FullName: user.FullName,
		Email:    user.Email,
		Role:     user.Role,
	}); err != nil {
		http.Error(w, "Failed to encode updated user", http.StatusInternalServerError)
	}
}

type profileResponse struct {
	Username string `json:"username"`
	FullName string `json:"full_name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
}

func (api *ApiConfig) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	user, err := api.DB.GetUserByID(r.Context(), session.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Failed to load profile", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(profileResponse{
		Username: user.ID,
		FullName: user.FullName,
		Email:    user.Email,
		Role:     user.Role,
	}); err != nil {
		http.Error(w, "Failed to encode profile", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	var params struct {
		FullName string `json:"full_name"`
		Email    string `json:"email"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	params.FullName = strings.TrimSpace(params.FullName)
	params.Email = strings.TrimSpace(params.Email)
	address, err := mail.ParseAddress(params.Email)
	if params.FullName == "" || utf8.RuneCountInString(params.FullName) > 100 ||
		utf8.RuneCountInString(params.Email) > 255 || err != nil || address.Address != params.Email {
		http.Error(w, "Provide a full name of at most 100 characters and a valid email", http.StatusBadRequest)
		return
	}

	user, err := api.DB.UpdateUserProfile(r.Context(), dbgen.UpdateUserProfileParams{
		ID:       session.UserID,
		Email:    params.Email,
		FullName: params.FullName,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) && databaseError.Code == "23505" {
		http.Error(w, "Email address is already in use", http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, "Failed to update profile", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(profileResponse{
		Username: user.ID,
		FullName: user.FullName,
		Email:    user.Email,
		Role:     user.Role,
	}); err != nil {
		http.Error(w, "Failed to encode profile", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleUpdatePassword(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	var params struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
		ConfirmPassword string `json:"confirm_password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if params.NewPassword == "" || params.NewPassword != params.ConfirmPassword {
		http.Error(w, "New password must be non-empty and match the confirmation", http.StatusBadRequest)
		return
	}
	if len(params.NewPassword) < 8 || len(params.NewPassword) > 72 {
		http.Error(w, "New password must be between 8 and 72 bytes", http.StatusBadRequest)
		return
	}
	if params.CurrentPassword == "" {
		http.Error(w, "Current password is required", http.StatusBadRequest)
		return
	}

	user, err := api.DB.GetUserByID(r.Context(), session.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Failed to load account", http.StatusInternalServerError)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(params.CurrentPassword)); err != nil {
		http.Error(w, "Current password is incorrect", http.StatusUnauthorized)
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(params.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Failed to secure new password", http.StatusInternalServerError)
		return
	}
	if err := api.DB.UpdateUserPassword(r.Context(), dbgen.UpdateUserPasswordParams{
		ID:           session.UserID,
		PasswordHash: string(passwordHash),
	}); err != nil {
		http.Error(w, "Failed to update password", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]string{"message": "Password updated successfully"}); err != nil {
		http.Error(w, "Failed to encode password update response", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	type parameters struct {
		Title        string  `json:"title"`
		Description  string  `json:"description"`
		BoardID      string  `json:"board_id"`
		AssignedToID string  `json:"assigned_to_id"`
		State        string  `json:"state"`
		Priority     string  `json:"priority"`
		CompleteBy   *string `json:"complete_by"`
	}
	var params parameters
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	params.Title = strings.TrimSpace(params.Title)
	if params.Title == "" || len(params.Title) > 255 {
		http.Error(w, "Task title is required and must be at most 255 bytes", http.StatusBadRequest)
		return
	}
	if params.State == "" {
		params.State = "Backlog"
	}
	if params.State != "Backlog" && params.State != "ToDo" {
		http.Error(w, "State must be Backlog or ToDo", http.StatusBadRequest)
		return
	}
	if params.Priority == "" {
		params.Priority = "Medium"
	}
	if params.Priority != "Low" && params.Priority != "Medium" && params.Priority != "High" {
		http.Error(w, "Priority must be Low, Medium, or High", http.StatusBadRequest)
		return
	}
	boardID := pgtype.UUID{}
	if params.BoardID != "" {
		if err := boardID.Scan(params.BoardID); err != nil {
			http.Error(w, "Board ID is invalid", http.StatusBadRequest)
			return
		}
	}

	description := pgtype.Text{}
	if params.Description != "" {
		description = pgtype.Text{String: params.Description, Valid: true}
	}
	assignedToID := pgtype.Text{}
	if params.AssignedToID != "" {
		if !isAlphanumeric(params.AssignedToID) || len(params.AssignedToID) > 32 {
			http.Error(w, "Assigned user ID is invalid", http.StatusBadRequest)
			return
		}
		user, err := api.DB.GetUserByID(r.Context(), params.AssignedToID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				http.Error(w, "Assigned user does not exist", http.StatusBadRequest)
				return
			}
			http.Error(w, "Failed to validate assigned user", http.StatusInternalServerError)
			return
		}
		assignedToID = pgtype.Text{String: user.ID, Valid: true}
	}

	completeBy := pgtype.Timestamptz{}
	if params.CompleteBy != nil && *params.CompleteBy != "" {
		parsedTime, err := time.Parse(time.RFC3339, *params.CompleteBy)
		if err != nil {
			http.Error(w, "Complete-by date must be a valid timestamp", http.StatusBadRequest)
			return
		}
		completeBy = pgtype.Timestamptz{Time: parsedTime, Valid: true}
	}

	if api.BeginTx == nil {
		http.Error(w, "Task creation is unavailable", http.StatusInternalServerError)
		return
	}
	tx, err := api.BeginTx(r.Context())
	if err != nil {
		http.Error(w, "Failed to start task creation", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", session.UserID); err != nil {
		http.Error(w, "Failed to prepare task creation", http.StatusInternalServerError)
		return
	}

	txQueries := dbgen.New(tx)
	var board dbgen.Board
	if boardID.Valid {
		board, err = txQueries.GetBoardByIDAndOwner(r.Context(), dbgen.GetBoardByIDAndOwnerParams{
			BoardID: boardID,
			OwnerID: session.UserID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Board does not exist", http.StatusBadRequest)
			return
		}
	} else {
		board, err = txQueries.GetBoardByOwner(r.Context(), session.UserID)
		if errors.Is(err, pgx.ErrNoRows) {
			user, userErr := txQueries.GetUserByID(r.Context(), session.UserID)
			if userErr != nil {
				http.Error(w, "Failed to load task board owner", http.StatusInternalServerError)
				return
			}
			board, err = txQueries.CreateBoard(r.Context(), dbgen.CreateBoardParams{
				Title:   user.FullName,
				OwnerID: session.UserID,
			})
		}
	}
	if err != nil {
		http.Error(w, "Failed to load task board", http.StatusInternalServerError)
		return
	}

	columnTitle := "Backlog"
	columnPosition := int32(0)
	if params.State == "ToDo" {
		columnTitle = "To Do"
		columnPosition = 1
	}
	column, err := txQueries.GetColumnByBoardAndTitle(r.Context(), dbgen.GetColumnByBoardAndTitleParams{
		BoardID: board.ID,
		Title:   columnTitle,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		column, err = txQueries.CreateColumn(r.Context(), dbgen.CreateColumnParams{
			BoardID:  board.ID,
			Title:    columnTitle,
			Position: columnPosition,
		})
	}
	if err != nil {
		http.Error(w, "Failed to prepare task lane", http.StatusInternalServerError)
		return
	}

	task, err := txQueries.CreateTask(r.Context(), dbgen.CreateTaskParams{
		ColumnID:     column.ID,
		State:        params.State,
		Title:        params.Title,
		Description:  description,
		Priority:     params.Priority,
		AssignedToID: assignedToID,
		CompleteBy:   completeBy,
	})
	if err != nil {
		http.Error(w, "Failed to create task", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "Failed to save task", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(task); err != nil {
		http.Error(w, "Failed to encode task", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleMoveTask(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	taskID := pgtype.UUID{}
	if err := taskID.Scan(r.PathValue("taskID")); err != nil {
		http.Error(w, "Task ID is invalid", http.StatusBadRequest)
		return
	}
	var params struct {
		State string `json:"state"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	columnTitle := ""
	columnPosition := int32(0)
	switch params.State {
	case "Backlog":
		columnTitle = "Backlog"
	case "ToDo":
		columnTitle = "To Do"
		columnPosition = 1
	case "InProgress":
		columnTitle = "In Progress"
		columnPosition = 2
	case "Complete":
		columnTitle = "Complete"
		columnPosition = 3
	default:
		http.Error(w, "State must be Backlog, ToDo, InProgress, or Complete", http.StatusBadRequest)
		return
	}

	if api.BeginTx == nil {
		http.Error(w, "Task moves are unavailable", http.StatusInternalServerError)
		return
	}
	tx, err := api.BeginTx(r.Context())
	if err != nil {
		http.Error(w, "Failed to start task move", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", session.UserID); err != nil {
		http.Error(w, "Failed to prepare task move", http.StatusInternalServerError)
		return
	}

	txQueries := dbgen.New(tx)
	board, err := txQueries.GetBoardByTaskAndOwner(r.Context(), dbgen.GetBoardByTaskAndOwnerParams{
		TaskID:  taskID,
		OwnerID: session.UserID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Task not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to load task", http.StatusInternalServerError)
		return
	}
	column, err := txQueries.GetColumnByBoardAndTitle(r.Context(), dbgen.GetColumnByBoardAndTitleParams{
		BoardID: board.ID,
		Title:   columnTitle,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		column, err = txQueries.CreateColumn(r.Context(), dbgen.CreateColumnParams{
			BoardID:  board.ID,
			Title:    columnTitle,
			Position: columnPosition,
		})
	}
	if err != nil {
		http.Error(w, "Failed to prepare task lane", http.StatusInternalServerError)
		return
	}

	task, err := txQueries.MoveTask(r.Context(), dbgen.MoveTaskParams{
		ColumnID: column.ID,
		ID:       taskID,
		OwnerID:  session.UserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Failed to move task", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "Failed to save task move", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(task); err != nil {
		http.Error(w, "Failed to encode moved task", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleUpdateTask(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	taskID := pgtype.UUID{}
	if err := taskID.Scan(r.PathValue("taskID")); err != nil {
		http.Error(w, "Task ID is invalid", http.StatusBadRequest)
		return
	}
	var params struct {
		Title       string  `json:"title"`
		Description string  `json:"description"`
		Priority    string  `json:"priority"`
		State       string  `json:"state"`
		CompleteBy  *string `json:"complete_by"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	params.Title = strings.TrimSpace(params.Title)
	if params.Title == "" || len(params.Title) > 255 {
		http.Error(w, "Task title is required and must be at most 255 bytes", http.StatusBadRequest)
		return
	}
	if params.Priority != "Low" && params.Priority != "Medium" && params.Priority != "High" {
		http.Error(w, "Priority must be Low, Medium, or High", http.StatusBadRequest)
		return
	}

	columnTitle := ""
	columnPosition := int32(0)
	switch params.State {
	case "Backlog":
		columnTitle = "Backlog"
	case "ToDo":
		columnTitle = "To Do"
		columnPosition = 1
	case "InProgress":
		columnTitle = "In Progress"
		columnPosition = 2
	case "Complete":
		columnTitle = "Complete"
		columnPosition = 3
	default:
		http.Error(w, "State must be Backlog, ToDo, InProgress, or Complete", http.StatusBadRequest)
		return
	}

	description := pgtype.Text{}
	if params.Description != "" {
		description = pgtype.Text{String: params.Description, Valid: true}
	}
	completeBy := pgtype.Timestamptz{}
	if params.CompleteBy != nil && *params.CompleteBy != "" {
		parsedTime, err := time.Parse(time.RFC3339, *params.CompleteBy)
		if err != nil {
			http.Error(w, "Complete-by date must be a valid timestamp", http.StatusBadRequest)
			return
		}
		completeBy = pgtype.Timestamptz{Time: parsedTime, Valid: true}
	}

	if api.BeginTx == nil {
		http.Error(w, "Task updates are unavailable", http.StatusInternalServerError)
		return
	}
	tx, err := api.BeginTx(r.Context())
	if err != nil {
		http.Error(w, "Failed to start task update", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", session.UserID); err != nil {
		http.Error(w, "Failed to prepare task update", http.StatusInternalServerError)
		return
	}

	txQueries := dbgen.New(tx)
	board, err := txQueries.GetBoardByTaskAndOwner(r.Context(), dbgen.GetBoardByTaskAndOwnerParams{
		TaskID: taskID, OwnerID: session.UserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Failed to load task", http.StatusInternalServerError)
		return
	}
	column, err := txQueries.GetColumnByBoardAndTitle(r.Context(), dbgen.GetColumnByBoardAndTitleParams{
		BoardID: board.ID, Title: columnTitle,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		column, err = txQueries.CreateColumn(r.Context(), dbgen.CreateColumnParams{
			BoardID: board.ID, Title: columnTitle, Position: columnPosition,
		})
	}
	if err != nil {
		http.Error(w, "Failed to prepare task lane", http.StatusInternalServerError)
		return
	}

	task, err := txQueries.UpdateTask(r.Context(), dbgen.UpdateTaskParams{
		ColumnID: column.ID, State: params.State, Title: params.Title,
		Description: description, Priority: params.Priority, CompleteBy: completeBy,
		TaskID: taskID, OwnerID: session.UserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Failed to update task", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "Failed to save task update", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(task); err != nil {
		http.Error(w, "Failed to encode updated task", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleLogin(w http.ResponseWriter, r *http.Request) {
	type loginParams struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	var params loginParams
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	params.Email = strings.TrimSpace(params.Email)
	if params.Email == "" || params.Password == "" {
		http.Error(w, "Invalid email or password", http.StatusUnauthorized)
		return
	}

	user, err := api.DB.GetUserByEmail(r.Context(), params.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Invalid email or password", http.StatusUnauthorized)
			return
		}
		http.Error(w, "Failed to validate credentials", http.StatusInternalServerError)
		return
	}

	// 2. Validate the password hash
	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(params.Password))
	if err != nil {
		http.Error(w, "Invalid email or password", http.StatusUnauthorized)
		return
	}

	// Generate a cryptographically secure, unguessable session token.
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}
	token := base64.RawURLEncoding.EncodeToString(b)

	expiresAt := time.Now().Add(30 * 24 * time.Hour)
	_, err = api.DB.CreateSession(r.Context(), dbgen.CreateSessionParams{
		Token:     token,
		UserID:    user.ID,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "snappy_session",
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int((30 * 24 * time.Hour).Seconds()),
		HttpOnly: true, // Prevents JavaScript access (XSS protection)
		Secure:   api.SecureCookie,
		SameSite: http.SameSiteStrictMode,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Logged in successfully"})
}

func (api *ApiConfig) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	_, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"authenticated": false})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"authenticated": true})
}

func (api *ApiConfig) handleLogout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("snappy_session")
	if err == nil {
		if err := api.DB.DeleteSession(r.Context(), cookie.Value); err != nil {
			http.Error(w, "Failed to log out", http.StatusInternalServerError)
			return
		}
	} else if !errors.Is(err, http.ErrNoCookie) {
		http.Error(w, "Failed to log out", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "snappy_session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   api.SecureCookie,
		SameSite: http.SameSiteStrictMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (api *ApiConfig) authenticatedSession(r *http.Request) (dbgen.Session, bool, error) {
	cookie, err := r.Cookie("snappy_session")
	if err != nil {
		return dbgen.Session{}, false, nil
	}

	session, err := api.DB.GetSession(r.Context(), cookie.Value)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return dbgen.Session{}, false, nil
		}
		return dbgen.Session{}, false, err
	}
	return session, true, nil
}
