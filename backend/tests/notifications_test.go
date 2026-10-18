package backend_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"snappy-plan/dbgen"
)

func TestGetNotificationsEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	now := time.Now().UTC()
	for _, test := range []struct {
		name       string
		db         *fakeDB
		wantStatus int
	}{
		{name: "requires authentication", db: &fakeDB{}, wantStatus: http.StatusUnauthorized},
		{
			name: "reports session lookup failures",
			db: &fakeDB{
				sessionErr: errors.New("session lookup failed"),
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "reports notification expiry failures",
			db: &fakeDB{
				session:                dbgen.Session{Token: "token", UserID: "reader1"},
				notificationCleanupErr: errors.New("cleanup failed"),
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "reports notification query failures",
			db: &fakeDB{
				session:              dbgen.Session{Token: "token", UserID: "reader1"},
				notificationQueryErr: errors.New("query failed"),
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "reports notification scan failures",
			db: &fakeDB{
				session:             dbgen.Session{Token: "token", UserID: "reader1"},
				notifications:       []fakeNotification{{id: newUUID(1), userID: "reader1"}},
				notificationScanErr: errors.New("scan failed"),
			},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "reports notification iteration failures",
			db: &fakeDB{
				session:             dbgen.Session{Token: "token", UserID: "reader1"},
				notificationRowsErr: errors.New("iteration failed"),
			},
			wantStatus: http.StatusInternalServerError,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			requestCookie := cookie
			if test.name == "requires authentication" {
				requestCookie = nil
			}
			response := send(newHandler(test.db, nil, false), http.MethodGet, "/api/notifications", "", requestCookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}

	t.Run("returns notifications only for the authenticated user", func(t *testing.T) {
		readAt := now.Add(-time.Hour)
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: "reader1"},
			notifications: []fakeNotification{
				{id: newUUID(1), userID: "reader1", message: "Unread task", createdAt: now},
				{id: newUUID(2), userID: "reader1", message: "Read task", createdAt: now.Add(-time.Minute), readAt: &readAt},
				{id: newUUID(3), userID: "reader2", message: "Another user", createdAt: now},
			},
		}
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/notifications", "", cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if db.notificationQueryUser != "reader1" ||
			!strings.Contains(db.notificationCleanupQuery, "INTERVAL '24 hours'") {
			t.Fatalf("notifications were not scoped/expired: query user %q, cleanup query %q",
				db.notificationQueryUser, db.notificationCleanupQuery)
		}
		var notifications []userNotificationResponse
		if err := json.Unmarshal(response.Body.Bytes(), &notifications); err != nil {
			t.Fatalf("decode notifications: %v", err)
		}
		if len(notifications) != 2 || notifications[0].Message != "Unread task" ||
			notifications[0].ReadAt != nil || notifications[1].ReadAt == nil {
			t.Fatalf("notifications = %#v", notifications)
		}
	})
}

type userNotificationResponse struct {
	ID        string     `json:"id"`
	Message   string     `json:"message"`
	CreatedAt time.Time  `json:"created_at"`
	ReadAt    *time.Time `json:"read_at"`
}

func TestMarkNotificationReadEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	notificationID := newUUID(1)
	for _, test := range []struct {
		name       string
		db         *fakeDB
		pathID     string
		wantStatus int
	}{
		{name: "requires authentication", db: &fakeDB{}, pathID: notificationID.String(), wantStatus: http.StatusUnauthorized},
		{
			name: "reports session lookup failures",
			db: &fakeDB{
				sessionErr: errors.New("session lookup failed"),
			},
			pathID: notificationID.String(), wantStatus: http.StatusInternalServerError,
		},
		{
			name: "rejects invalid notification IDs",
			db: &fakeDB{
				session: dbgen.Session{Token: "token", UserID: "reader1"},
			},
			pathID: "invalid", wantStatus: http.StatusBadRequest,
		},
		{
			name: "reports update failures",
			db: &fakeDB{
				session:             dbgen.Session{Token: "token", UserID: "reader1"},
				notificationMarkErr: errors.New("update failed"),
			},
			pathID: notificationID.String(), wantStatus: http.StatusInternalServerError,
		},
		{
			name: "does not mark another user's notification as read",
			db: &fakeDB{
				session:       dbgen.Session{Token: "token", UserID: "reader1"},
				notifications: []fakeNotification{{id: notificationID, userID: "reader2"}},
			},
			pathID: notificationID.String(), wantStatus: http.StatusNotFound,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			requestCookie := cookie
			if test.name == "requires authentication" {
				requestCookie = nil
			}
			response := send(newHandler(test.db, nil, false), http.MethodPatch,
				"/api/notifications/"+test.pathID+"/read", "", requestCookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}

	t.Run("marks the authenticated user's notification as read", func(t *testing.T) {
		db := &fakeDB{
			session:       dbgen.Session{Token: "token", UserID: "reader1"},
			notifications: []fakeNotification{{id: notificationID, userID: "reader1"}},
		}
		response := send(newHandler(db, nil, false), http.MethodPatch,
			"/api/notifications/"+notificationID.String()+"/read", "", cookie)
		if response.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusNoContent, response.Body.String())
		}
		if db.notifications[0].readAt == nil {
			t.Fatal("notification was not marked read")
		}
	})
}
