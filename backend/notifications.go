package backend

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

type userNotification struct {
	ID        string     `json:"id"`
	Message   string     `json:"message"`
	CreatedAt time.Time  `json:"created_at"`
	ReadAt    *time.Time `json:"read_at"`
}

func (api *ApiConfig) handleGetNotifications(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	if _, err := api.DBTX.Exec(r.Context(), `
		DELETE FROM notifications
		WHERE read_at IS NOT NULL
		  AND read_at <= NOW() - INTERVAL '24 hours'
	`); err != nil {
		http.Error(w, "Failed to expire read notifications", http.StatusInternalServerError)
		return
	}

	rows, err := api.DBTX.Query(r.Context(), `
		SELECT id::text, message, created_at, read_at
		FROM notifications
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, session.UserID)
	if err != nil {
		http.Error(w, "Failed to load notifications", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	notifications := make([]userNotification, 0)
	for rows.Next() {
		var notification userNotification
		if err := rows.Scan(&notification.ID, &notification.Message, &notification.CreatedAt, &notification.ReadAt); err != nil {
			http.Error(w, "Failed to read notifications", http.StatusInternalServerError)
			return
		}
		notifications = append(notifications, notification)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "Failed to read notifications", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(notifications); err != nil {
		http.Error(w, "Failed to encode notifications", http.StatusInternalServerError)
	}
}

func (api *ApiConfig) handleMarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	session, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	notificationID := pgtype.UUID{}
	if err := notificationID.Scan(r.PathValue("notificationID")); err != nil {
		http.Error(w, "Notification ID is invalid", http.StatusBadRequest)
		return
	}
	result, err := api.DBTX.Exec(r.Context(), `
		UPDATE notifications
		SET read_at = COALESCE(read_at, NOW())
		WHERE id = $1 AND user_id = $2
	`, notificationID, session.UserID)
	if err != nil {
		http.Error(w, "Failed to mark notification as read", http.StatusInternalServerError)
		return
	}
	if result.RowsAffected() == 0 {
		http.Error(w, "Notification not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func insertTaskNotification(r *http.Request, tx SetupTransaction, userID, actorID, message string) error {
	if userID == "" || userID == actorID {
		return nil
	}
	_, err := tx.Exec(r.Context(), `
		INSERT INTO notifications (user_id, message)
		VALUES ($1, $2)
	`, userID, message)
	return err
}
