package backend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"unicode/utf8"

	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

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

func (api *ApiConfig) handleGetBoardsForAdmin(w http.ResponseWriter, r *http.Request) {
	if _, ok := api.requireAdmin(w, r); !ok {
		return
	}
	boards, err := api.DB.GetAllBoardsForAdmin(r.Context())
	if err != nil {
		http.Error(w, "Failed to load boards", http.StatusInternalServerError)
		return
	}
	responseBoards := make([]adminBoardResponse, 0, len(boards))
	for _, board := range boards {
		responseBoards = append(responseBoards, adminBoardResponse{
			ID:        board.ID,
			Title:     board.Title,
			OwnerID:   board.OwnerID,
			OwnerName: board.FullName,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(responseBoards); err != nil {
		http.Error(w, "Failed to encode boards", http.StatusInternalServerError)
	}
}

type adminBoardResponse struct {
	ID        pgtype.UUID `json:"id"`
	Title     string      `json:"title"`
	OwnerID   string      `json:"owner_id"`
	OwnerName string      `json:"owner_name"`
}

func (api *ApiConfig) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if _, ok := api.requireAdmin(w, r); !ok {
		return
	}
	var params struct {
		Username string `json:"username"`
		FullName string `json:"full_name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	params.Username = strings.ToLower(strings.TrimSpace(params.Username))
	params.FullName = strings.TrimSpace(params.FullName)
	params.Email = strings.TrimSpace(params.Email)
	address, err := mail.ParseAddress(params.Email)
	if !isAlphanumeric(params.Username) || len(params.Username) > 32 ||
		params.FullName == "" || utf8.RuneCountInString(params.FullName) > 100 ||
		utf8.RuneCountInString(params.Email) > 255 || err != nil || address.Address != params.Email ||
		len(params.Password) < 8 || len(params.Password) > 72 {
		http.Error(w, "Provide an alphanumeric username of at most 32 characters, a full name of at most 100 characters, a valid email, and a password of 8 to 72 bytes", http.StatusBadRequest)
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
		FullName:     params.FullName,
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
