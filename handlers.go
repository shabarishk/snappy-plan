package main

import (
	"context"
	"encoding/json"
	"net/http"
	"snappy-plan/dbgen"

	"golang.org/x/crypto/bcrypt"
)

// ApiConfig acts like a C++ class holding our database pointer
type ApiConfig struct {
	DB *dbgen.Queries
}

// Check if the application requires first-time setup
func (api *ApiConfig) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	count, err := api.DB.CountUsers(context.Background())
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
	// 1. Security Lock: Ensure this endpoint is only accessible if no users exist
	count, err := api.DB.CountUsers(context.Background())
	if err != nil || count > 0 {
		http.Error(w, "Setup already complete. Please log in.", http.StatusForbidden)
		return
	}

	type setupParams struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		FullName string `json:"full_name"`
	}

	var params setupParams
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// 2. Hash the password securely using bcrypt
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(params.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Failed to secure password", http.StatusInternalServerError)
		return
	}

	// 3. Create the admin user in the database
	user, err := api.DB.CreateUser(context.Background(), dbgen.CreateUserParams{
		Email:        params.Email,
		PasswordHash: string(hashedPassword),
		FullName:     params.FullName,
		Role:         "admin", // Hardcoded to admin for this specific first-run endpoint
	})
	if err != nil {
		http.Error(w, "Failed to create admin user", http.StatusInternalServerError)
		return
	}

	// 4. Return success (In a full flow, you would also generate a session cookie here)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Admin account created successfully",
		"user_id": user.ID.String(),
	})
}

// handleCreateBoard is a method attached to ApiConfig
func (api *ApiConfig) handleCreateBoard(w http.ResponseWriter, r *http.Request) {
	// 1. Define a struct to match the incoming JSON payload
	type parameters struct {
		Title   string `json:"title"`
		OwnerID string `json:"owner_id"` // We will use a string UUID for now
	}

	// 2. Parse the JSON from the request body
	var params parameters
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// 3. Call the generated sqlc function
	// Note: In a real app, you'd parse the string UUID to pgtype.UUID.
	// For simplicity in this scaffold, we assume the DB handles it or we mock it.
	board, err := api.DB.CreateBoard(context.Background(), dbgen.CreateBoardParams{
		Title: params.Title,
		// OwnerId: ... (We will hook up real UUID parsing later)
	})

	if err != nil {
		http.Error(w, "Failed to create board", http.StatusInternalServerError)
		return
	}

	// 4. Return the newly created board as JSON
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(board)
}
