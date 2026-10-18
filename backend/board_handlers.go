package backend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

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
		Title   string   `json:"title"`
		UserIDs []string `json:"user_ids"`
	}

	var params parameters
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	params.Title = strings.TrimSpace(params.Title)
	if params.Title == "" || len(params.Title) > 100 {
		http.Error(w, "Board title is required and must be at most 100 bytes", http.StatusBadRequest)
		return
	}

	if api.BeginTx == nil {
		http.Error(w, "Board creation is unavailable", http.StatusInternalServerError)
		return
	}
	tx, err := api.BeginTx(r.Context())
	if err != nil {
		http.Error(w, "Failed to start board creation", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(context.Background())
	txQueries := dbgen.New(tx)
	board, err := txQueries.CreateBoard(r.Context(), dbgen.CreateBoardParams{
		Title:   params.Title,
		OwnerID: session.UserID,
	})
	if err != nil {
		http.Error(w, "Failed to create board", http.StatusInternalServerError)
		return
	}
	memberIDs := map[string]struct{}{session.UserID: {}}
	for _, userID := range params.UserIDs {
		userID = strings.TrimSpace(userID)
		if !isAlphanumeric(userID) || len(userID) > 32 {
			http.Error(w, "Board member ID is invalid", http.StatusBadRequest)
			return
		}
		if _, exists := memberIDs[userID]; exists {
			continue
		}
		if _, err := txQueries.GetUserByID(r.Context(), userID); errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Board member does not exist", http.StatusBadRequest)
			return
		} else if err != nil {
			http.Error(w, "Failed to validate board member", http.StatusInternalServerError)
			return
		}
		memberIDs[userID] = struct{}{}
	}
	for userID := range memberIDs {
		if err := txQueries.CreateBoardMember(r.Context(), dbgen.CreateBoardMemberParams{
			BoardID: board.ID,
			UserID:  userID,
		}); err != nil {
			http.Error(w, "Failed to grant board access", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "Failed to save board", http.StatusInternalServerError)
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

func (api *ApiConfig) handleUpdateBoardOrder(w http.ResponseWriter, r *http.Request) {
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
		BoardIDs []string `json:"board_ids"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil || params.BoardIDs == nil {
		http.Error(w, "Board IDs are required", http.StatusBadRequest)
		return
	}
	boardIDs := make([]pgtype.UUID, len(params.BoardIDs))
	requestedIDs := make(map[pgtype.UUID]struct{}, len(params.BoardIDs))
	for index, value := range params.BoardIDs {
		if err := boardIDs[index].Scan(value); err != nil {
			http.Error(w, "Board ID is invalid", http.StatusBadRequest)
			return
		}
		if _, exists := requestedIDs[boardIDs[index]]; exists {
			http.Error(w, "Board IDs must not contain duplicates", http.StatusBadRequest)
			return
		}
		requestedIDs[boardIDs[index]] = struct{}{}
	}

	if api.BeginTx == nil {
		http.Error(w, "Board ordering is unavailable", http.StatusInternalServerError)
		return
	}
	tx, err := api.BeginTx(r.Context())
	if err != nil {
		http.Error(w, "Failed to start board ordering", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "board-order:"+session.UserID); err != nil {
		http.Error(w, "Failed to prepare board ordering", http.StatusInternalServerError)
		return
	}

	txQueries := dbgen.New(tx)
	boards, err := txQueries.GetBoardsByOwner(r.Context(), session.UserID)
	if err != nil {
		http.Error(w, "Failed to validate board access", http.StatusInternalServerError)
		return
	}
	if len(boards) != len(boardIDs) {
		http.Error(w, "Board order must include all accessible boards", http.StatusBadRequest)
		return
	}
	for _, board := range boards {
		if _, exists := requestedIDs[board.ID]; !exists {
			http.Error(w, "Board order contains an inaccessible board", http.StatusBadRequest)
			return
		}
	}

	if err := txQueries.DeleteUserBoardOrder(r.Context(), session.UserID); err != nil {
		http.Error(w, "Failed to replace board order", http.StatusInternalServerError)
		return
	}
	for position, boardID := range boardIDs {
		if err := txQueries.InsertUserBoardOrder(r.Context(), dbgen.InsertUserBoardOrderParams{
			UserID: session.UserID, BoardID: boardID, Position: int32(position),
		}); err != nil {
			http.Error(w, "Failed to save board order", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "Failed to save board order", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *ApiConfig) handleDeleteBoard(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	boardID := pgtype.UUID{}
	if err := boardID.Scan(r.PathValue("boardID")); err != nil {
		http.Error(w, "Board ID is invalid", http.StatusBadRequest)
		return
	}

	deleted, err := api.DB.DeleteBoard(r.Context(), dbgen.DeleteBoardParams{
		ID:      boardID,
		OwnerID: session.UserID,
	})
	if err != nil {
		http.Error(w, "Failed to delete board", http.StatusInternalServerError)
		return
	}
	if deleted == 0 {
		http.Error(w, "Board does not exist", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *ApiConfig) authorizeBoardManager(w http.ResponseWriter, r *http.Request) (dbgen.Board, bool) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return dbgen.Board{}, false
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return dbgen.Board{}, false
	}
	boardID := pgtype.UUID{}
	if err := boardID.Scan(r.PathValue("boardID")); err != nil {
		http.Error(w, "Board ID is invalid", http.StatusBadRequest)
		return dbgen.Board{}, false
	}
	board, err := api.DB.GetBoardByID(r.Context(), boardID)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Board does not exist", http.StatusNotFound)
		return dbgen.Board{}, false
	}
	if err != nil {
		http.Error(w, "Failed to load board", http.StatusInternalServerError)
		return dbgen.Board{}, false
	}
	if board.OwnerID != session.UserID {
		user, err := api.DB.GetUserByID(r.Context(), session.UserID)
		if err != nil {
			http.Error(w, "Failed to validate administrator", http.StatusInternalServerError)
			return dbgen.Board{}, false
		}
		if user.Role != "admin" {
			http.Error(w, "Board does not exist", http.StatusNotFound)
			return dbgen.Board{}, false
		}
	}
	return board, true
}

func (api *ApiConfig) handleGetBoardMembers(w http.ResponseWriter, r *http.Request) {
	board, ok := api.authorizeBoardManager(w, r)
	if !ok {
		return
	}
	ids, err := api.DB.GetBoardMemberIDs(r.Context(), board.ID)
	if err != nil {
		http.Error(w, "Failed to load board members", http.StatusInternalServerError)
		return
	}
	userIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != board.OwnerID {
			userIDs = append(userIDs, id)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]string{"user_ids": userIDs})
}

func (api *ApiConfig) handleUpdateBoardMembers(w http.ResponseWriter, r *http.Request) {
	board, ok := api.authorizeBoardManager(w, r)
	if !ok {
		return
	}
	var params struct {
		UserIDs []string `json:"user_ids"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if api.BeginTx == nil {
		http.Error(w, "Board update is unavailable", http.StatusInternalServerError)
		return
	}
	tx, err := api.BeginTx(r.Context())
	if err != nil {
		http.Error(w, "Failed to start board update", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(context.Background())
	txQueries := dbgen.New(tx)
	if err := txQueries.DeleteBoardMembersExceptOwner(r.Context(), board.ID); err != nil {
		http.Error(w, "Failed to update board access", http.StatusInternalServerError)
		return
	}
	seen := map[string]struct{}{board.OwnerID: {}}
	userIDs := []string{}
	for _, userID := range params.UserIDs {
		userID = strings.TrimSpace(userID)
		if !isAlphanumeric(userID) || len(userID) > 32 {
			http.Error(w, "Board member ID is invalid", http.StatusBadRequest)
			return
		}
		if _, exists := seen[userID]; exists {
			continue
		}
		if _, err := txQueries.GetUserByID(r.Context(), userID); errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Board member does not exist", http.StatusBadRequest)
			return
		} else if err != nil {
			http.Error(w, "Failed to validate board member", http.StatusInternalServerError)
			return
		}
		seen[userID] = struct{}{}
		userIDs = append(userIDs, userID)
		if err := txQueries.CreateBoardMember(r.Context(), dbgen.CreateBoardMemberParams{BoardID: board.ID, UserID: userID}); err != nil {
			http.Error(w, "Failed to grant board access", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "Failed to save board access", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]string{"user_ids": userIDs})
}
