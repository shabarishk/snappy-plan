package backend_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type initiativeTestDB struct {
	*fakeDB
	initiative         dbgen.Initiative
	initiatives        []dbgen.GetInitiativesByUserRow
	initiativeTasks    []dbgen.Task
	removedTaskCount   int64
	initiativeQueryErr error
	taskQueryErr       error
	createErr          error
	updateErr          error
	getTaskErr         error
	addTaskErr         error
	removeTaskErr      error
}

func newInitiativeTestDB() *initiativeTestDB {
	now := time.Date(2026, time.October, 14, 0, 0, 0, 0, time.UTC)
	return &initiativeTestDB{
		fakeDB: &fakeDB{
			session: dbgen.Session{Token: "token", UserID: "owner1"},
			user:    dbgen.User{ID: "owner1", FullName: "Owner"},
		},
		initiative: dbgen.Initiative{
			ID:           newUUID(11),
			Title:        "Launch",
			Description:  pgtype.Text{String: "Launch details", Valid: true},
			CompleteBy:   pgtype.Timestamptz{Time: now, Valid: true},
			AssignedToID: pgtype.Text{String: "owner1", Valid: true},
			CreatedByID:  "owner1",
			CreatedAt:    pgtype.Timestamptz{Time: now, Valid: true},
			UpdatedAt:    pgtype.Timestamptz{Time: now, Valid: true},
		},
		initiatives: []dbgen.GetInitiativesByUserRow{{
			ID:                 newUUID(11),
			Title:              "Launch",
			Description:        pgtype.Text{String: "Launch details", Valid: true},
			AssignedToName:     pgtype.Text{String: "Owner", Valid: true},
			TaskCount:          2,
			CompletedTaskCount: 1,
		}},
		initiativeTasks:  []dbgen.Task{{ID: newUUID(12), Title: "Release notes", State: "Complete"}},
		removedTaskCount: 1,
	}
}

func (db *initiativeTestDB) Query(ctx context.Context, query string, args ...any) (pgx.Rows, error) {
	switch {
	case strings.Contains(query, "-- name: GetInitiativesByUser"):
		if db.initiativeQueryErr != nil {
			return nil, db.initiativeQueryErr
		}
		values := make([][]any, len(db.initiatives))
		for i, initiative := range db.initiatives {
			values[i] = append(initiativeValues(db.initiativeFromList(initiative)), initiative.AssignedToName,
				initiative.TaskCount, initiative.CompletedTaskCount)
		}
		return &fakeRows{values: values}, nil
	case strings.Contains(query, "-- name: GetTasksByInitiativeAndUser"):
		if db.taskQueryErr != nil {
			return nil, db.taskQueryErr
		}
		values := make([][]any, len(db.initiativeTasks))
		for i, task := range db.initiativeTasks {
			values[i] = taskValues(task)
		}
		return &fakeRows{values: values}, nil
	default:
		return db.fakeDB.Query(ctx, query, args...)
	}
}

func (db *initiativeTestDB) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	switch {
	case strings.Contains(query, "-- name: CreateInitiative"):
		if db.createErr != nil {
			return fakeRow{err: db.createErr}
		}
		db.initiative.ID = newUUID(11)
		db.initiative.Title = args[0].(string)
		db.initiative.Description = args[1].(pgtype.Text)
		db.initiative.CompleteBy = args[2].(pgtype.Timestamptz)
		db.initiative.AssignedToID = args[3].(pgtype.Text)
		db.initiative.CreatedByID = args[4].(string)
		return fakeRow{values: initiativeValues(db.initiative)}
	case strings.Contains(query, "-- name: UpdateInitiative"):
		if db.updateErr != nil {
			return fakeRow{err: db.updateErr}
		}
		db.initiative.Title = args[0].(string)
		db.initiative.Description = args[1].(pgtype.Text)
		db.initiative.CompleteBy = args[2].(pgtype.Timestamptz)
		db.initiative.AssignedToID = args[3].(pgtype.Text)
		return fakeRow{values: initiativeValues(db.initiative)}
	case strings.Contains(query, "-- name: GetInitiativeByIDAndUser"):
		if db.initiativeQueryErr != nil {
			return fakeRow{err: db.initiativeQueryErr}
		}
		return fakeRow{values: initiativeValues(db.initiative)}
	case strings.Contains(query, "-- name: GetTaskByIDAndUser"):
		if db.getTaskErr != nil {
			return fakeRow{err: db.getTaskErr}
		}
		if len(db.initiativeTasks) == 0 {
			return fakeRow{err: pgx.ErrNoRows}
		}
		return fakeRow{values: taskValues(db.initiativeTasks[0])}
	default:
		return db.fakeDB.QueryRow(ctx, query, args...)
	}
}

func (db *initiativeTestDB) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	switch {
	case strings.Contains(query, "-- name: AddTaskToInitiative"):
		return pgconn.CommandTag{}, db.addTaskErr
	case strings.Contains(query, "-- name: RemoveTaskFromInitiative"):
		if db.removeTaskErr != nil {
			return pgconn.CommandTag{}, db.removeTaskErr
		}
		return pgconn.NewCommandTag(fmt.Sprintf("DELETE %d", db.removedTaskCount)), nil
	default:
		return db.fakeDB.Exec(ctx, query, args...)
	}
}

func TestInitiativeHandlersValidateAccessAndInput(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodGet, "/api/initiatives", "", nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	db := &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"}}
	for _, test := range []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "rejects an invalid initiative ID", method: http.MethodGet, path: "/api/initiatives/not-a-uuid"},
		{name: "rejects a blank title", method: http.MethodPost, path: "/api/initiatives", body: `{"title":" "}`},
		{name: "rejects an invalid date", method: http.MethodPost, path: "/api/initiatives", body: `{"title":"Initiative","complete_by":"not-a-date"}`},
		{name: "rejects an invalid assignee", method: http.MethodPost, path: "/api/initiatives", body: `{"title":"Initiative","assigned_to_id":"invalid-id"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := send(newHandler(db, nil, false), test.method, test.path, test.body, cookie)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
		})
	}
}

func TestInitiativeHandlersHappyPaths(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	db := newInitiativeTestDB()
	handler := newHandler(db, nil, false)

	response := send(handler, http.MethodGet, "/api/initiatives", "", cookie)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"completed_task_count":1`) {
		t.Fatalf("list response = %d %s", response.Code, response.Body.String())
	}

	response = send(handler, http.MethodPost, "/api/initiatives",
		`{"title":"Release","description":"Details","complete_by":"2026-12-01","assigned_to_id":"owner1"}`, cookie)
	if response.Code != http.StatusCreated || !strings.Contains(response.Body.String(), `"title":"Release"`) {
		t.Fatalf("create response = %d %s", response.Code, response.Body.String())
	}

	initiativeID := db.initiative.ID.String()
	response = send(handler, http.MethodGet, "/api/initiatives/"+initiativeID, "", cookie)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"title":"Release notes"`) {
		t.Fatalf("detail response = %d %s", response.Code, response.Body.String())
	}

	response = send(handler, http.MethodPut, "/api/initiatives/"+initiativeID,
		`{"title":"Updated","description":"New details","complete_by":"2026-12-02","assigned_to_id":"owner1"}`, cookie)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"title":"Updated"`) {
		t.Fatalf("update response = %d %s", response.Code, response.Body.String())
	}

	response = send(handler, http.MethodPost, "/api/initiatives/"+initiativeID+"/tasks",
		`{"task_id":"00000000-0000-0000-0000-00000000000c"}`, cookie)
	if response.Code != http.StatusNoContent {
		t.Fatalf("add task status = %d: %s", response.Code, response.Body.String())
	}

	response = send(handler, http.MethodDelete,
		"/api/initiatives/"+initiativeID+"/tasks/00000000-0000-0000-0000-00000000000c", "", cookie)
	if response.Code != http.StatusNoContent {
		t.Fatalf("remove task status = %d: %s", response.Code, response.Body.String())
	}
}

func TestInitiativeHandlersReportStorageAndMissingRows(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	initiativeID := newUUID(11).String()

	t.Run("reports list storage errors", func(t *testing.T) {
		db := newInitiativeTestDB()
		db.initiativeQueryErr = errors.New("query failed")
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/initiatives", "", cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
		}
	})

	t.Run("reports missing initiative and task rows", func(t *testing.T) {
		db := newInitiativeTestDB()
		db.initiativeQueryErr = pgx.ErrNoRows
		handler := newHandler(db, nil, false)
		response := send(handler, http.MethodGet, "/api/initiatives/"+initiativeID, "", cookie)
		if response.Code != http.StatusNotFound {
			t.Fatalf("initiative status = %d, want %d", response.Code, http.StatusNotFound)
		}
		response = send(handler, http.MethodPost, "/api/initiatives/"+initiativeID+"/tasks",
			`{"task_id":"00000000-0000-0000-0000-00000000000c"}`, cookie)
		if response.Code != http.StatusNotFound {
			t.Fatalf("add task status = %d, want %d", response.Code, http.StatusNotFound)
		}
	})

	t.Run("reports missing update, task, and association", func(t *testing.T) {
		db := newInitiativeTestDB()
		db.updateErr = pgx.ErrNoRows
		handler := newHandler(db, nil, false)
		response := send(handler, http.MethodPut, "/api/initiatives/"+initiativeID, `{"title":"Updated"}`, cookie)
		if response.Code != http.StatusNotFound {
			t.Fatalf("update status = %d, want %d", response.Code, http.StatusNotFound)
		}

		db.getTaskErr = pgx.ErrNoRows
		response = send(handler, http.MethodPost, "/api/initiatives/"+initiativeID+"/tasks",
			`{"task_id":"00000000-0000-0000-0000-00000000000c"}`, cookie)
		if response.Code != http.StatusNotFound {
			t.Fatalf("task status = %d, want %d", response.Code, http.StatusNotFound)
		}

		db.removedTaskCount = 0
		response = send(handler, http.MethodDelete,
			"/api/initiatives/"+initiativeID+"/tasks/00000000-0000-0000-0000-00000000000c", "", cookie)
		if response.Code != http.StatusNotFound {
			t.Fatalf("remove status = %d, want %d", response.Code, http.StatusNotFound)
		}
	})
}

func TestInitiativeHandlersReportEndpointFailures(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	initiativeID := newUUID(11).String()
	taskID := "00000000-0000-0000-0000-00000000000c"

	t.Run("create and update storage errors", func(t *testing.T) {
		db := newInitiativeTestDB()
		db.createErr = errors.New("insert failed")
		response := send(newHandler(db, nil, false), http.MethodPost, "/api/initiatives", `{"title":"Launch"}`, cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("create status = %d", response.Code)
		}

		db.updateErr = errors.New("update failed")
		response = send(newHandler(db, nil, false), http.MethodPut, "/api/initiatives/"+initiativeID, `{"title":"Updated"}`, cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("update status = %d", response.Code)
		}
	})

	t.Run("detail and link storage errors", func(t *testing.T) {
		db := newInitiativeTestDB()
		db.initiativeQueryErr = errors.New("initiative lookup failed")
		handler := newHandler(db, nil, false)
		response := send(handler, http.MethodGet, "/api/initiatives/"+initiativeID, "", cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("detail status = %d", response.Code)
		}

		db.initiativeQueryErr = nil
		db.taskQueryErr = errors.New("task lookup failed")
		response = send(handler, http.MethodGet, "/api/initiatives/"+initiativeID, "", cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("initiative tasks status = %d", response.Code)
		}

		db.initiativeQueryErr = errors.New("initiative access failed")
		response = send(handler, http.MethodPost, "/api/initiatives/"+initiativeID+"/tasks", `{}`, cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("initiative access status = %d", response.Code)
		}
	})

	t.Run("rejects malformed task link requests", func(t *testing.T) {
		db := newInitiativeTestDB()
		handler := newHandler(db, nil, false)
		response := send(handler, http.MethodPost, "/api/initiatives/"+initiativeID+"/tasks", `{`, cookie)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("JSON status = %d", response.Code)
		}
		response = send(handler, http.MethodPost, "/api/initiatives/"+initiativeID+"/tasks", `{"task_id":"invalid"}`, cookie)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("task ID status = %d", response.Code)
		}

		db.getTaskErr = errors.New("task lookup failed")
		response = send(handler, http.MethodPost, "/api/initiatives/"+initiativeID+"/tasks", fmt.Sprintf(`{"task_id":%q}`, taskID), cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("task lookup status = %d", response.Code)
		}

		db.getTaskErr = nil
		db.addTaskErr = errors.New("link failed")
		response = send(handler, http.MethodPost, "/api/initiatives/"+initiativeID+"/tasks", fmt.Sprintf(`{"task_id":%q}`, taskID), cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("link status = %d", response.Code)
		}
	})

	t.Run("reports invalid and failed task removal", func(t *testing.T) {
		db := newInitiativeTestDB()
		handler := newHandler(db, nil, false)
		response := send(handler, http.MethodDelete, "/api/initiatives/"+initiativeID+"/tasks/invalid", "", cookie)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid task ID status = %d", response.Code)
		}
		db.removeTaskErr = errors.New("remove failed")
		response = send(handler, http.MethodDelete, "/api/initiatives/"+initiativeID+"/tasks/"+taskID, "", cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("remove error status = %d", response.Code)
		}
	})
}

func TestInitiativeHandlersAuthenticationFailures(t *testing.T) {
	initiativeID := newUUID(11).String()
	requests := []struct {
		method string
		path   string
		body   string
	}{
		{method: http.MethodGet, path: "/api/initiatives"},
		{method: http.MethodPost, path: "/api/initiatives", body: `{"title":"Launch"}`},
		{method: http.MethodGet, path: "/api/initiatives/" + initiativeID},
		{method: http.MethodPut, path: "/api/initiatives/" + initiativeID, body: `{"title":"Launch"}`},
		{method: http.MethodPost, path: "/api/initiatives/" + initiativeID + "/tasks", body: `{"task_id":"00000000-0000-0000-0000-00000000000c"}`},
		{method: http.MethodDelete, path: "/api/initiatives/" + initiativeID + "/tasks/00000000-0000-0000-0000-00000000000c"},
	}
	for _, request := range requests {
		t.Run(request.method+" "+request.path, func(t *testing.T) {
			handler := newHandler(newInitiativeTestDB(), nil, false)
			response := send(handler, request.method, request.path, request.body, nil)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("unauthenticated status = %d", response.Code)
			}

			db := newInitiativeTestDB()
			db.sessionErr = errors.New("session lookup failed")
			response = send(newHandler(db, nil, false), request.method, request.path, request.body,
				&http.Cookie{Name: "snappy_session", Value: "token"})
			if response.Code != http.StatusInternalServerError {
				t.Fatalf("session error status = %d", response.Code)
			}
		})
	}
}

func TestInitiativeHandlersReturnEmptyCollectionsAndReportEncodeFailures(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	initiativeID := newUUID(11).String()
	requests := []struct {
		method string
		path   string
		body   string
	}{
		{method: http.MethodGet, path: "/api/initiatives"},
		{method: http.MethodPost, path: "/api/initiatives", body: `{"title":"Launch"}`},
		{method: http.MethodGet, path: "/api/initiatives/" + initiativeID},
		{method: http.MethodPut, path: "/api/initiatives/" + initiativeID, body: `{"title":"Updated"}`},
	}
	for _, request := range requests {
		db := newInitiativeTestDB()
		db.initiatives = nil
		db.initiativeTasks = nil
		handler := newHandler(db, nil, false)
		failingWriter := &failingResponseWriter{err: errors.New("write failed")}
		httpRequest := httptest.NewRequest(request.method, request.path, strings.NewReader(request.body))
		httpRequest.AddCookie(cookie)
		handler.ServeHTTP(failingWriter, httpRequest)
	}

	db := newInitiativeTestDB()
	db.initiatives = nil
	response := send(newHandler(db, nil, false), http.MethodGet, "/api/initiatives", "", cookie)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "[]") {
		t.Fatalf("empty initiatives response = %d %s", response.Code, response.Body.String())
	}
	db.initiativeTasks = nil
	response = send(newHandler(db, nil, false), http.MethodGet, "/api/initiatives/"+initiativeID, "", cookie)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"tasks":[]`) {
		t.Fatalf("empty tasks response = %d %s", response.Code, response.Body.String())
	}
}

func (db *initiativeTestDB) initiativeFromList(row dbgen.GetInitiativesByUserRow) dbgen.Initiative {
	return dbgen.Initiative{
		ID: row.ID, Title: row.Title, Description: row.Description, CompleteBy: row.CompleteBy,
		AssignedToID: row.AssignedToID, CreatedByID: row.CreatedByID,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func initiativeValues(initiative dbgen.Initiative) []any {
	return []any{
		initiative.ID, initiative.Title, initiative.Description, initiative.CompleteBy,
		initiative.AssignedToID, initiative.CreatedByID, initiative.CreatedAt, initiative.UpdatedAt,
	}
}
