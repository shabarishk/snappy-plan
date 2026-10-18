package backend

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const taskCommentLimit = 5000

type taskCommentResponse struct {
	ID             string    `json:"id"`
	TaskID         string    `json:"task_id"`
	Body           string    `json:"body"`
	AuthorUsername string    `json:"author_username"`
	AuthorName     string    `json:"author_name"`
	CreatedAt      time.Time `json:"created_at"`
}

func (api *ApiConfig) handleGetTaskComments(w http.ResponseWriter, r *http.Request) {
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
	if _, err := api.DB.GetBoardByTaskAndOwner(r.Context(), dbgen.GetBoardByTaskAndOwnerParams{
		TaskID: taskID, OwnerID: session.UserID,
	}); errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Failed to validate task access", http.StatusInternalServerError)
		return
	}

	rows, err := api.DBTX.Query(r.Context(), `
		SELECT comment.id::TEXT, comment.task_id::TEXT, comment.body,
		       author.id, COALESCE(NULLIF(author.preferred_name, ''), author.full_name),
		       comment.created_at
		FROM task_comments AS comment
		JOIN users AS author ON author.id = comment.author_id
		WHERE comment.task_id = $1
		ORDER BY comment.created_at ASC, comment.id ASC
	`, taskID)
	if err != nil {
		http.Error(w, "Failed to load task comments", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	comments := make([]taskCommentResponse, 0)
	for rows.Next() {
		var comment taskCommentResponse
		if err := rows.Scan(
			&comment.ID, &comment.TaskID, &comment.Body,
			&comment.AuthorUsername, &comment.AuthorName, &comment.CreatedAt,
		); err != nil {
			http.Error(w, "Failed to read task comments", http.StatusInternalServerError)
			return
		}
		comments = append(comments, comment)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Failed to read task comments", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(comments); err != nil {
		http.Error(w, "Failed to encode task comments", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleCreateTaskComment(w http.ResponseWriter, r *http.Request) {
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
		Body string `json:"body"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	params.Body = strings.TrimSpace(params.Body)
	if params.Body == "" || utf8.RuneCountInString(params.Body) > taskCommentLimit {
		http.Error(w, "Comment must contain 1 to 5000 characters", http.StatusBadRequest)
		return
	}
	if _, err := api.DB.GetBoardByTaskAndOwner(r.Context(), dbgen.GetBoardByTaskAndOwnerParams{
		TaskID: taskID, OwnerID: session.UserID,
	}); errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "Task not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Failed to validate task access", http.StatusInternalServerError)
		return
	}
	if api.BeginTx == nil {
		http.Error(w, "Task comments are unavailable", http.StatusInternalServerError)
		return
	}
	tx, err := api.BeginTx(r.Context())
	if err != nil {
		http.Error(w, "Failed to start task comment", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(context.Background())

	var taskTitle string
	if err := tx.QueryRow(r.Context(), "SELECT title FROM tasks WHERE id = $1", taskID).Scan(&taskTitle); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Task not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to load task for comment", http.StatusInternalServerError)
		return
	}

	var comment taskCommentResponse
	err = tx.QueryRow(r.Context(), `
		WITH inserted_comment AS (
			INSERT INTO task_comments (task_id, author_id, body)
			VALUES ($1, $2, $3)
			RETURNING id, task_id, author_id, body, created_at
		)
		SELECT comment.id::TEXT, comment.task_id::TEXT, comment.body, author.id,
		       COALESCE(NULLIF(author.preferred_name, ''), author.full_name), comment.created_at
		FROM inserted_comment AS comment
		JOIN users AS author ON author.id = comment.author_id
	`, taskID, session.UserID, params.Body).Scan(
		&comment.ID, &comment.TaskID, &comment.Body,
		&comment.AuthorUsername, &comment.AuthorName, &comment.CreatedAt,
	)
	if err != nil {
		http.Error(w, "Failed to save task comment", http.StatusInternalServerError)
		return
	}

	mentionedUsernames := taskCommentMentions(params.Body)
	if len(mentionedUsernames) > 0 {
		rows, err := tx.Query(r.Context(), `
			SELECT id FROM users WHERE LOWER(id) = ANY($1::TEXT[])
		`, mentionedUsernames)
		if err != nil {
			http.Error(w, "Failed to resolve comment mentions", http.StatusInternalServerError)
			return
		}
		mentionedUsers := make([]string, 0, len(mentionedUsernames))
		for rows.Next() {
			var userID string
			if err := rows.Scan(&userID); err != nil {
				rows.Close()
				http.Error(w, "Failed to read comment mentions", http.StatusInternalServerError)
				return
			}
			mentionedUsers = append(mentionedUsers, userID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			http.Error(w, "Failed to read comment mentions", http.StatusInternalServerError)
			return
		}
		rows.Close()

		for _, userID := range mentionedUsers {
			if err := insertTaskNotification(r, tx, userID, session.UserID,
				"@"+session.UserID+" mentioned you on task, “"+taskTitle+"”."); err != nil {
				http.Error(w, "Failed to create mention notification", http.StatusInternalServerError)
				return
			}
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "Failed to save task comment", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(comment); err != nil {
		http.Error(w, "Failed to encode task comment", http.StatusInternalServerError)
	}
}

func taskCommentMentions(body string) []string {
	mentions := make(map[string]struct{})
	for index := 0; index < len(body); index++ {
		if body[index] != '@' {
			continue
		}
		if index > 0 {
			previous, _ := utf8.DecodeLastRuneInString(body[:index])
			if isMentionWordRune(previous) {
				continue
			}
		}
		end := index + 1
		for end < len(body) && isMentionUsernameByte(body[end]) {
			end++
		}
		if end == index+1 || end-index > 33 {
			continue
		}
		if end < len(body) {
			next, _ := utf8.DecodeRuneInString(body[end:])
			if isMentionWordRune(next) {
				continue
			}
		}
		mentions[strings.ToLower(body[index+1:end])] = struct{}{}
		index = end - 1
	}
	if len(mentions) == 0 {
		return nil
	}
	result := make([]string, 0, len(mentions))
	for username := range mentions {
		result = append(result, username)
	}
	sort.Strings(result)
	return result
}

func isMentionUsernameByte(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z' ||
		value >= '0' && value <= '9'
}

func isMentionWordRune(value rune) bool {
	return value == '_' || unicode.IsLetter(value) || unicode.IsDigit(value)
}
