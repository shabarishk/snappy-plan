package backend_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"snappy-plan/backend"
	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
)

func TestCreateTaskCommentEndpointNotifiesMentionedUsers(t *testing.T) {
	taskID := newUUID(12)
	db := &fakeDB{
		session:      dbgen.Session{Token: "token", UserID: "owner1"},
		board:        dbgen.Board{ID: newUUID(4), OwnerID: "owner1"},
		taskTitle:    "Task title",
		mentionUsers: []string{"mentioned1", "owner1"},
	}
	tx := &fakeTx{fakeDB: db}
	response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
		return tx, nil
	}, false), http.MethodPost, "/api/tasks/"+taskID.String()+"/comments",
		`{"body":"Please review this, @mentioned1. Thanks @owner1 and @mentioned1!"}`,
		&http.Cookie{Name: "snappy_session", Value: "token"})
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
	}
	if !tx.committed || len(db.taskComments) != 1 || len(db.taskNotifications) != 1 {
		t.Fatalf("comment transaction committed=%t comments=%#v notifications=%#v",
			tx.committed, db.taskComments, db.taskNotifications)
	}
	if db.taskComments[0].body != "Please review this, @mentioned1. Thanks @owner1 and @mentioned1!" {
		t.Fatalf("stored comment = %q", db.taskComments[0].body)
	}
	if notification := db.taskNotifications[0]; notification.userID != "mentioned1" ||
		!strings.Contains(notification.message, "Task title") || !strings.Contains(notification.message, "@owner1") {
		t.Fatalf("mention notification = %#v", notification)
	}
	var comment struct {
		AuthorUsername string `json:"author_username"`
		Body           string `json:"body"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &comment); err != nil {
		t.Fatalf("decode comment response: %v", err)
	}
	if comment.AuthorUsername != "owner1" || comment.Body != db.taskComments[0].body {
		t.Fatalf("comment response = %#v", comment)
	}
}

func TestGetTaskCommentsEndpointChecksTaskAccess(t *testing.T) {
	taskID := newUUID(12)
	db := &fakeDB{
		session: dbgen.Session{Token: "token", UserID: "owner1"},
		board:   dbgen.Board{ID: newUUID(4), OwnerID: "owner1"},
		taskComments: []fakeTaskComment{{
			id: newUUID(13), taskID: taskID, authorID: "author1",
			body: "A saved comment", createdAt: time.Date(2026, time.October, 18, 0, 0, 0, 0, time.UTC),
		}},
	}
	response := send(newHandler(db, nil, false), http.MethodGet,
		"/api/tasks/"+taskID.String()+"/comments", "",
		&http.Cookie{Name: "snappy_session", Value: "token"})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	var comments []struct {
		Body           string `json:"body"`
		AuthorUsername string `json:"author_username"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &comments); err != nil {
		t.Fatalf("decode comments: %v", err)
	}
	if len(comments) != 1 || comments[0].Body != "A saved comment" || comments[0].AuthorUsername != "author1" {
		t.Fatalf("comments = %#v", comments)
	}

	db.boardErr = pgx.ErrNoRows
	response = send(newHandler(db, nil, false), http.MethodGet,
		"/api/tasks/"+taskID.String()+"/comments", "",
		&http.Cookie{Name: "snappy_session", Value: "token"})
	if response.Code != http.StatusNotFound {
		t.Fatalf("inaccessible task status = %d, want %d", response.Code, http.StatusNotFound)
	}
}

func TestGetTaskCommentsEndpointErrors(t *testing.T) {
	taskID := newUUID(12)
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	comment := fakeTaskComment{id: newUUID(13), taskID: taskID, authorID: "author1", body: "Saved"}
	for _, test := range []struct {
		name       string
		cookie     *http.Cookie
		pathID     string
		db         *fakeDB
		wantStatus int
	}{
		{name: "requires authentication", pathID: taskID.String(), wantStatus: http.StatusUnauthorized},
		{name: "reports session lookup errors", cookie: cookie, pathID: taskID.String(),
			db: &fakeDB{sessionErr: errors.New("session query failed")}, wantStatus: http.StatusInternalServerError},
		{name: "rejects invalid task IDs", cookie: cookie, pathID: "invalid",
			db: &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"}}, wantStatus: http.StatusBadRequest},
		{name: "reports access lookup errors", cookie: cookie, pathID: taskID.String(),
			db:         &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"}, boardErr: errors.New("access query failed")},
			wantStatus: http.StatusInternalServerError},
		{name: "reports comment query errors", cookie: cookie, pathID: taskID.String(),
			db:         &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"}, taskCommentQueryErr: errors.New("comment query failed")},
			wantStatus: http.StatusInternalServerError},
		{name: "reports comment scan errors", cookie: cookie, pathID: taskID.String(),
			db: &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"}, taskComments: []fakeTaskComment{comment},
				taskCommentScanErr: errors.New("scan failed")}, wantStatus: http.StatusInternalServerError},
		{name: "reports comment iteration errors", cookie: cookie, pathID: taskID.String(),
			db: &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"}, taskComments: []fakeTaskComment{comment},
				taskCommentRowsErr: errors.New("iteration failed")}, wantStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := test.db
			if db == nil {
				db = &fakeDB{}
			}
			response := send(newHandler(db, nil, false), http.MethodGet,
				"/api/tasks/"+test.pathID+"/comments", "", test.cookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}

	db := &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"}}
	writer := &failingResponseWriter{err: errors.New("write failed")}
	request := httptest.NewRequest(http.MethodGet, "/api/tasks/"+taskID.String()+"/comments", nil)
	request.AddCookie(cookie)
	newHandler(db, nil, false).ServeHTTP(writer, request)
	if writer.status != http.StatusInternalServerError {
		t.Fatalf("encoding failure status = %d, want %d", writer.status, http.StatusInternalServerError)
	}
}

func TestCreateTaskCommentEndpointErrors(t *testing.T) {
	taskID := newUUID(12)
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	for _, test := range []struct {
		name                  string
		cookie                *http.Cookie
		pathID                string
		body                  string
		sessionErr            error
		boardErr              error
		beginMissing          bool
		beginErr              error
		taskTitleErr          error
		commentInsertErr      error
		mentionQueryErr       error
		mentionScanErr        error
		mentionRowsErr        error
		notificationInsertErr error
		commitErr             error
		wantStatus            int
	}{
		{name: "requires authentication", pathID: taskID.String(), body: `{"body":"Hello"}`,
			wantStatus: http.StatusUnauthorized},
		{name: "reports session lookup errors", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hello"}`,
			sessionErr: errors.New("session query failed"), wantStatus: http.StatusInternalServerError},
		{name: "rejects invalid task IDs", cookie: cookie, pathID: "invalid", body: `{"body":"Hello"}`,
			wantStatus: http.StatusBadRequest},
		{name: "rejects invalid JSON", cookie: cookie, pathID: taskID.String(), body: `{`,
			wantStatus: http.StatusBadRequest},
		{name: "rejects blank comments", cookie: cookie, pathID: taskID.String(), body: `{"body":"  "}`,
			wantStatus: http.StatusBadRequest},
		{name: "rejects comments over the size limit", cookie: cookie, pathID: taskID.String(),
			body: `{"body":"` + strings.Repeat("x", 5001) + `"}`, wantStatus: http.StatusBadRequest},
		{name: "reports access lookup errors", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hello"}`,
			boardErr: errors.New("access query failed"), wantStatus: http.StatusInternalServerError},
		{name: "reports missing tasks", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hello"}`,
			boardErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "reports missing transaction providers", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hello"}`,
			beginMissing: true, wantStatus: http.StatusInternalServerError},
		{name: "reports transaction begin errors", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hello"}`,
			beginErr: errors.New("begin failed"), wantStatus: http.StatusInternalServerError},
		{name: "reports missing task titles", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hello"}`,
			taskTitleErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "reports task title query errors", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hello"}`,
			taskTitleErr: errors.New("title query failed"), wantStatus: http.StatusInternalServerError},
		{name: "reports comment insert errors", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hello"}`,
			commentInsertErr: errors.New("insert failed"), wantStatus: http.StatusInternalServerError},
		{name: "reports mention query errors", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hi @other1"}`,
			mentionQueryErr: errors.New("mention query failed"), wantStatus: http.StatusInternalServerError},
		{name: "reports mention scan errors", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hi @other1"}`,
			mentionScanErr: errors.New("mention scan failed"), wantStatus: http.StatusInternalServerError},
		{name: "reports mention iteration errors", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hi @other1"}`,
			mentionRowsErr: errors.New("mention iteration failed"), wantStatus: http.StatusInternalServerError},
		{name: "reports notification insert errors", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hi @other1"}`,
			notificationInsertErr: errors.New("notification insert failed"), wantStatus: http.StatusInternalServerError},
		{name: "reports transaction commit errors", cookie: cookie, pathID: taskID.String(), body: `{"body":"Hello"}`,
			commitErr: errors.New("commit failed"), wantStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{
				session:    dbgen.Session{Token: "token", UserID: "owner1"},
				board:      dbgen.Board{ID: newUUID(4), OwnerID: "owner1"},
				sessionErr: test.sessionErr, boardErr: test.boardErr, taskTitle: "Task title",
				taskTitleQueryErr: test.taskTitleErr, taskCommentInsertErr: test.commentInsertErr,
				mentionUsers: []string{"other1"}, mentionQueryErr: test.mentionQueryErr,
				mentionScanErr: test.mentionScanErr, mentionRowsErr: test.mentionRowsErr,
				notificationInsertErr: test.notificationInsertErr,
			}
			var begin func(context.Context) (backend.SetupTransaction, error)
			if !test.beginMissing {
				begin = func(context.Context) (backend.SetupTransaction, error) {
					if test.beginErr != nil {
						return nil, test.beginErr
					}
					return &fakeTx{fakeDB: db, commitErr: test.commitErr}, nil
				}
			}
			response := send(newHandler(db, begin, false), http.MethodPost,
				"/api/tasks/"+test.pathID+"/comments", test.body, test.cookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}

	db := &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"},
		board: dbgen.Board{ID: newUUID(4), OwnerID: "owner1"}, taskTitle: "Task title"}
	tx := &fakeTx{fakeDB: db}
	writer := &failingResponseWriter{err: errors.New("write failed")}
	request := httptest.NewRequest(http.MethodPost, "/api/tasks/"+taskID.String()+"/comments",
		strings.NewReader(`{"body":"Hello"}`))
	request.AddCookie(cookie)
	newHandler(db, func(context.Context) (backend.SetupTransaction, error) { return tx, nil }, false).
		ServeHTTP(writer, request)
	if writer.status != http.StatusInternalServerError {
		t.Fatalf("encoding failure status = %d, want %d", writer.status, http.StatusInternalServerError)
	}
}
