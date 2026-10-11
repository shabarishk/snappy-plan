package main

import (
	"context"
	"encoding/json"
	"net/http"
	"snappy-plan/dbgen" // Imports the sqlc generated code
)

// ApiConfig acts like a C++ class holding our database pointer
type ApiConfig struct {
	DB *dbgen.Queries
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
