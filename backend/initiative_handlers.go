package backend

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type initiativeRequest struct {
	Title        string  `json:"title"`
	Description  string  `json:"description"`
	CompleteBy   *string `json:"complete_by"`
	AssignedToID string  `json:"assigned_to_id"`
}

type initiativeDetailResponse struct {
	Initiative dbgen.Initiative `json:"initiative"`
	Tasks      []dbgen.Task     `json:"tasks"`
}

func (api *ApiConfig) handleGetInitiatives(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}
	initiatives, err := api.DB.GetInitiativesByUser(r.Context(), session.UserID)
	if err != nil {
		http.Error(w, "Failed to load initiatives", http.StatusInternalServerError)
		return
	}
	if initiatives == nil {
		initiatives = []dbgen.GetInitiativesByUserRow{}
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(initiatives); err != nil {
		http.Error(w, "Failed to encode initiatives", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleCreateInitiative(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}
	params, description, completeBy, assignedToID, valid := api.parseInitiativeRequest(w, r)
	if !valid {
		return
	}
	initiative, err := api.DB.CreateInitiative(r.Context(), dbgen.CreateInitiativeParams{
		Title:        params.Title,
		Description:  description,
		CompleteBy:   completeBy,
		AssignedToID: assignedToID,
		CreatedByID:  session.UserID,
	})
	if err != nil {
		http.Error(w, "Failed to create initiative", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(initiative); err != nil {
		http.Error(w, "Failed to encode initiative", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleGetInitiative(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}
	initiativeID, valid := parseInitiativeID(w, r)
	if !valid {
		return
	}
	initiative, err := api.DB.GetInitiativeByIDAndUser(r.Context(), dbgen.GetInitiativeByIDAndUserParams{
		InitiativeID: initiativeID,
		UserID:       session.UserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Initiative does not exist", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Failed to load initiative", http.StatusInternalServerError)
		return
	}
	tasks, err := api.DB.GetTasksByInitiativeAndUser(r.Context(), dbgen.GetTasksByInitiativeAndUserParams{
		InitiativeID: initiativeID,
		UserID:       session.UserID,
	})
	if err != nil {
		http.Error(w, "Failed to load initiative tasks", http.StatusInternalServerError)
		return
	}
	if tasks == nil {
		tasks = []dbgen.Task{}
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(initiativeDetailResponse{Initiative: initiative, Tasks: tasks}); err != nil {
		http.Error(w, "Failed to encode initiative", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleUpdateInitiative(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}
	initiativeID, valid := parseInitiativeID(w, r)
	if !valid {
		return
	}
	params, description, completeBy, assignedToID, valid := api.parseInitiativeRequest(w, r)
	if !valid {
		return
	}
	initiative, err := api.DB.UpdateInitiative(r.Context(), dbgen.UpdateInitiativeParams{
		Title:        params.Title,
		Description:  description,
		CompleteBy:   completeBy,
		AssignedToID: assignedToID,
		InitiativeID: initiativeID,
		UserID:       session.UserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Initiative does not exist", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Failed to update initiative", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(initiative); err != nil {
		http.Error(w, "Failed to encode initiative", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleAddTaskToInitiative(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}
	initiativeID, valid := parseInitiativeID(w, r)
	if !valid {
		return
	}
	if _, err := api.DB.GetInitiativeByIDAndUser(r.Context(), dbgen.GetInitiativeByIDAndUserParams{
		InitiativeID: initiativeID,
		UserID:       session.UserID,
	}); errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Initiative does not exist", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Failed to validate initiative access", http.StatusInternalServerError)
		return
	}
	var params struct {
		TaskID string `json:"task_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	taskID := pgtype.UUID{}
	if err := taskID.Scan(params.TaskID); err != nil {
		http.Error(w, "Task ID is invalid", http.StatusBadRequest)
		return
	}
	if _, err := api.DB.GetTaskByIDAndUser(r.Context(), dbgen.GetTaskByIDAndUserParams{
		TaskID: taskID,
		UserID: session.UserID,
	}); errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Task does not exist", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Failed to validate task access", http.StatusInternalServerError)
		return
	}
	if err := api.DB.AddTaskToInitiative(r.Context(), dbgen.AddTaskToInitiativeParams{
		InitiativeID: initiativeID,
		TaskID:       taskID,
	}); err != nil {
		http.Error(w, "Failed to add task to initiative", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *ApiConfig) handleRemoveTaskFromInitiative(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}
	initiativeID, valid := parseInitiativeID(w, r)
	if !valid {
		return
	}
	taskID := pgtype.UUID{}
	if err := taskID.Scan(r.PathValue("taskID")); err != nil {
		http.Error(w, "Task ID is invalid", http.StatusBadRequest)
		return
	}
	deleted, err := api.DB.RemoveTaskFromInitiative(r.Context(), dbgen.RemoveTaskFromInitiativeParams{
		InitiativeID: initiativeID,
		TaskID:       taskID,
		UserID:       session.UserID,
	})
	if err != nil {
		http.Error(w, "Failed to remove task from initiative", http.StatusInternalServerError)
		return
	}
	if deleted == 0 {
		http.Error(w, "Initiative task does not exist", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *ApiConfig) parseInitiativeRequest(w http.ResponseWriter, r *http.Request) (
	initiativeRequest, pgtype.Text, pgtype.Timestamptz, pgtype.Text, bool,
) {
	var params initiativeRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return params, pgtype.Text{}, pgtype.Timestamptz{}, pgtype.Text{}, false
	}
	params.Title = strings.TrimSpace(params.Title)
	if params.Title == "" || len(params.Title) > 255 {
		http.Error(w, "Initiative title is required and must be at most 255 bytes", http.StatusBadRequest)
		return params, pgtype.Text{}, pgtype.Timestamptz{}, pgtype.Text{}, false
	}
	description := pgtype.Text{}
	if params.Description != "" {
		description = pgtype.Text{String: params.Description, Valid: true}
	}
	completeBy := pgtype.Timestamptz{}
	if params.CompleteBy != nil && *params.CompleteBy != "" {
		date, err := time.Parse("2006-01-02", *params.CompleteBy)
		if err != nil {
			date, err = time.Parse(time.RFC3339, *params.CompleteBy)
		}
		if err != nil {
			http.Error(w, "Complete-by date must be a valid date", http.StatusBadRequest)
			return params, pgtype.Text{}, pgtype.Timestamptz{}, pgtype.Text{}, false
		}
		completeBy = pgtype.Timestamptz{Time: date, Valid: true}
	}
	assignedToID := pgtype.Text{}
	if params.AssignedToID != "" {
		if !isAlphanumeric(params.AssignedToID) || len(params.AssignedToID) > 32 {
			http.Error(w, "Assigned user ID is invalid", http.StatusBadRequest)
			return params, pgtype.Text{}, pgtype.Timestamptz{}, pgtype.Text{}, false
		}
		user, err := api.DB.GetUserByID(r.Context(), params.AssignedToID)
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Assigned user does not exist", http.StatusBadRequest)
			return params, pgtype.Text{}, pgtype.Timestamptz{}, pgtype.Text{}, false
		}
		if err != nil {
			http.Error(w, "Failed to validate assigned user", http.StatusInternalServerError)
			return params, pgtype.Text{}, pgtype.Timestamptz{}, pgtype.Text{}, false
		}
		assignedToID = pgtype.Text{String: user.ID, Valid: true}
	}
	return params, description, completeBy, assignedToID, true
}

func parseInitiativeID(w http.ResponseWriter, r *http.Request) (pgtype.UUID, bool) {
	initiativeID := pgtype.UUID{}
	if err := initiativeID.Scan(r.PathValue("initiativeID")); err != nil {
		http.Error(w, "Initiative ID is invalid", http.StatusBadRequest)
		return pgtype.UUID{}, false
	}
	return initiativeID, true
}
