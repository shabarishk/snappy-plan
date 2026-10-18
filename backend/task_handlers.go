package backend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const taskStateLimit = int64(5)

func lockTaskBoard(ctx context.Context, tx SetupTransaction, boardID pgtype.UUID) error {
	_, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", boardID.String())
	return err
}

func taskStateHasCapacity(ctx context.Context, tx SetupTransaction, boardID pgtype.UUID, state string, excludedTaskID pgtype.UUID) (bool, error) {
	var taskCount int64
	err := tx.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM tasks AS task
		JOIN columns AS task_column ON task_column.id = task.column_id
		WHERE task_column.board_id = $1
		  AND task.state = $2
		  AND ($3::UUID IS NULL OR task.id <> $3)
	`, boardID, state, excludedTaskID).Scan(&taskCount)
	if err != nil {
		return false, err
	}
	return taskCount < taskStateLimit, nil
}

func enforceTaskStateCapacity(w http.ResponseWriter, r *http.Request, tx SetupTransaction, boardID pgtype.UUID, state string, excludedTaskID pgtype.UUID) bool {
	if state != "ToDo" && state != "InProgress" {
		return true
	}
	if err := lockTaskBoard(r.Context(), tx, boardID); err != nil {
		http.Error(w, "Failed to prepare task lane capacity", http.StatusInternalServerError)
		return false
	}
	hasCapacity, err := taskStateHasCapacity(r.Context(), tx, boardID, state, excludedTaskID)
	if err != nil {
		http.Error(w, "Failed to check task lane capacity", http.StatusInternalServerError)
		return false
	}
	if !hasCapacity {
		http.Error(w, "To Do and In Progress lanes can contain at most 5 tasks", http.StatusConflict)
		return false
	}
	return true
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

	var tasks []dbgen.Task
	boardIDValue := r.URL.Query().Get("board_id")
	boardID := pgtype.UUID{}
	if boardIDValue != "" {
		if err := boardID.Scan(boardIDValue); err != nil {
			http.Error(w, "Board ID is invalid", http.StatusBadRequest)
			return
		}
		if _, err := api.DB.GetBoardByIDAndOwner(r.Context(), dbgen.GetBoardByIDAndOwnerParams{
			BoardID: boardID,
			OwnerID: session.UserID,
		}); errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Board does not exist", http.StatusNotFound)
			return
		} else if err != nil {
			http.Error(w, "Failed to validate board access", http.StatusInternalServerError)
			return
		}
	}
	if err := api.DB.MoveDueBacklogTasksToTodo(r.Context(), dbgen.MoveDueBacklogTasksToTodoParams{
		OwnerID: session.UserID,
		BoardID: boardID,
	}); err != nil {
		http.Error(w, "Failed to move due backlog tasks", http.StatusInternalServerError)
		return
	}
	if boardID.Valid {
		tasks, err = api.DB.GetTasksByBoard(r.Context(), boardID)
	} else {
		tasks, err = api.DB.GetTasksByOwner(r.Context(), session.UserID)
	}
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
			board, err = txQueries.CreatePersonalBoard(r.Context(), dbgen.CreatePersonalBoardParams{
				Title:   personalBoardTitle(user.PreferredName, user.FullName),
				OwnerID: session.UserID,
			})
		}
	}
	if err != nil {
		http.Error(w, "Failed to load task board", http.StatusInternalServerError)
		return
	}

	if params.State == "ToDo" && !enforceTaskStateCapacity(w, r, tx, board.ID, params.State, pgtype.UUID{}) {
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
	if !enforceTaskStateCapacity(w, r, tx, board.ID, params.State, taskID) {
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
		BoardID      string  `json:"board_id"`
		Title        string  `json:"title"`
		Description  string  `json:"description"`
		Priority     string  `json:"priority"`
		State        string  `json:"state"`
		AssignedToID string  `json:"assigned_to_id"`
		CompleteBy   *string `json:"complete_by"`
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
	boardID := pgtype.UUID{}
	if params.BoardID != "" {
		if err := boardID.Scan(params.BoardID); err != nil {
			http.Error(w, "Board ID is invalid", http.StatusBadRequest)
			return
		}
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
	destinationBoard := board
	if params.BoardID != "" {
		destinationBoard, err = txQueries.GetBoardByIDAndOwner(r.Context(), dbgen.GetBoardByIDAndOwnerParams{
			BoardID: boardID, OwnerID: session.UserID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Board does not exist", http.StatusBadRequest)
			return
		}
		if err != nil {
			http.Error(w, "Failed to load destination board", http.StatusInternalServerError)
			return
		}
	}
	if !enforceTaskStateCapacity(w, r, tx, destinationBoard.ID, params.State, taskID) {
		return
	}
	column, err := txQueries.GetColumnByBoardAndTitle(r.Context(), dbgen.GetColumnByBoardAndTitleParams{
		BoardID: destinationBoard.ID, Title: columnTitle,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		column, err = txQueries.CreateColumn(r.Context(), dbgen.CreateColumnParams{
			BoardID: destinationBoard.ID, Title: columnTitle, Position: columnPosition,
		})
	}
	if err != nil {
		http.Error(w, "Failed to prepare task lane", http.StatusInternalServerError)
		return
	}

	task, err := txQueries.UpdateTask(r.Context(), dbgen.UpdateTaskParams{
		ColumnID: column.ID, State: params.State, Title: params.Title,
		Description: description, Priority: params.Priority, CompleteBy: completeBy,
		AssignedToID: assignedToID,
		TaskID:       taskID, OwnerID: session.UserID,
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
