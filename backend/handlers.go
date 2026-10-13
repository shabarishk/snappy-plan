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

	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
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
	mux.HandleFunc("GET /api/auth/status", api.handleAuthStatus)
	mux.HandleFunc("POST /api/boards", api.handleCreateBoard)
	mux.HandleFunc("GET /api/tasks", api.handleGetTasks)
	mux.HandleFunc("POST /api/tasks", api.handleCreateTask)
	mux.HandleFunc("PATCH /api/tasks/{taskID}", api.handleMoveTask)
	mux.HandleFunc("PUT /api/tasks/{taskID}", api.handleUpdateTask)
	mux.HandleFunc("GET /api/users", api.handleGetUsersForAssignment)
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
	board, err := txQueries.GetBoardByOwner(r.Context(), session.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		board, err = txQueries.CreateBoard(r.Context(), dbgen.CreateBoardParams{
			Title:   "Snappy Plan",
			OwnerID: session.UserID,
		})
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
