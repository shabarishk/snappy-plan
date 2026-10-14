package backend

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"unicode/utf8"

	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

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
