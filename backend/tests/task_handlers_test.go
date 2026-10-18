package backend_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"snappy-plan/backend"
	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestGetTasksEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodGet, "/api/tasks?board_id="+newUUID(4).String(), "", nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	for _, test := range []struct {
		name       string
		boardID    string
		boardErr   error
		tasksErr   error
		moveErr    error
		wantStatus int
	}{
		{name: "rejects an invalid board ID", boardID: "invalid", wantStatus: http.StatusBadRequest},
		{name: "rejects an inaccessible board", boardID: newUUID(4).String(), boardErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "reports a board access query error", boardID: newUUID(4).String(), boardErr: errors.New("lookup failed"), wantStatus: http.StatusInternalServerError},
		{name: "reports a due-task update error", boardID: newUUID(4).String(), moveErr: errors.New("update failed"), wantStatus: http.StatusInternalServerError},
		{name: "reports a task query error", boardID: newUUID(4).String(), tasksErr: errors.New("task query failed"), wantStatus: http.StatusInternalServerError},
		{name: "returns tasks for an accessible board", boardID: newUUID(4).String(), wantStatus: http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{
				session:         dbgen.Session{Token: "token", UserID: "owner7"},
				board:           dbgen.Board{ID: newUUID(4), Title: "Shared", OwnerID: "owner1"},
				boardErr:        test.boardErr,
				tasksErr:        test.tasksErr,
				moveDueTasksErr: test.moveErr,
				tasks:           []dbgen.Task{{ID: newUUID(8), Title: "Board task"}},
			}
			response := send(newHandler(db, nil, false), http.MethodGet,
				"/api/tasks?board_id="+test.boardID, "", cookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
			if test.name == "returns tasks for an accessible board" {
				if len(db.moveDueTasksArgs) != 2 || db.moveDueTasksArgs[0] != "owner7" ||
					db.moveDueTasksArgs[1] != newUUID(4) {
					t.Fatalf("due-task update args = %#v", db.moveDueTasksArgs)
				}
				var tasks []dbgen.Task
				if err := json.Unmarshal(response.Body.Bytes(), &tasks); err != nil {
					t.Fatalf("decode tasks: %v", err)
				}
				if len(tasks) != 1 || tasks[0].Title != "Board task" {
					t.Fatalf("tasks = %#v", tasks)
				}
			}
		})
	}
}

func TestCreateTaskEndpoint(t *testing.T) {
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPost, "/api/tasks", `{"title":"Task"}`, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	for _, body := range []string{
		`{`,
		`{"title":" "}`,
		`{"title":"Task","state":"Complete"}`,
		`{"title":"Task","priority":"Urgent"}`,
		`{"title":"Task","board_id":"not-a-uuid"}`,
		`{"title":"Task","assigned_to_id":"not-a-uuid"}`,
		`{"title":"Task","complete_by":"not-a-date"}`,
	} {
		t.Run("rejects invalid "+body, func(t *testing.T) {
			db := &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"}}
			response := send(newHandler(db, nil, false), http.MethodPost, "/api/tasks", body,
				&http.Cookie{Name: "snappy_session", Value: "token"})
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
		})
	}

	t.Run("rejects unavailable task storage and transaction failures", func(t *testing.T) {
		ownerID := "owner1"
		body := `{"title":"Task"}`
		testCases := []struct {
			name            string
			begin           func(context.Context) (backend.SetupTransaction, error)
			wantStatus      int
			createBoardErr  error
			boardErr        error
			columnErr       error
			createColumnErr error
			createTaskErr   error
			commitErr       error
		}{
			{name: "missing transaction provider", wantStatus: http.StatusInternalServerError},
			{
				name: "begin error", wantStatus: http.StatusInternalServerError,
				begin: func(context.Context) (backend.SetupTransaction, error) { return nil, errors.New("begin failed") },
			},
			{
				name: "lock error", wantStatus: http.StatusInternalServerError,
				begin: func(context.Context) (backend.SetupTransaction, error) {
					return &fakeTx{fakeDB: &fakeDB{}, execErr: errors.New("lock failed")}, nil
				},
			},
			{
				name: "board query error", wantStatus: http.StatusInternalServerError,
				boardErr: errors.New("board query failed"),
			},
			{
				name: "board creation error", wantStatus: http.StatusInternalServerError,
				boardErr: pgx.ErrNoRows, createBoardErr: errors.New("board insert failed"),
			},
			{
				name: "lane query error", wantStatus: http.StatusInternalServerError,
				columnErr: errors.New("lane query failed"),
			},
			{
				name: "lane creation error", wantStatus: http.StatusInternalServerError,
				columnErr: pgx.ErrNoRows, createColumnErr: errors.New("lane insert failed"),
			},
			{
				name: "task creation error", wantStatus: http.StatusInternalServerError,
				createTaskErr: errors.New("task insert failed"),
			},
			{
				name: "commit error", wantStatus: http.StatusInternalServerError,
				commitErr: errors.New("commit failed"),
			},
		}
		for _, test := range testCases {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session:         dbgen.Session{Token: "token", UserID: ownerID},
					board:           dbgen.Board{ID: newUUID(2), OwnerID: ownerID},
					column:          dbgen.Column{ID: newUUID(3), BoardID: newUUID(2), Title: "Backlog"},
					boardErr:        test.boardErr,
					columnErr:       test.columnErr,
					createBoardErr:  test.createBoardErr,
					createColumnErr: test.createColumnErr,
					createTaskErr:   test.createTaskErr,
				}
				begin := test.begin
				if begin == nil && test.name != "missing transaction provider" {
					tx := &fakeTx{fakeDB: db, commitErr: test.commitErr}
					begin = func(context.Context) (backend.SetupTransaction, error) { return tx, nil }
				}
				response := send(newHandler(db, begin, false), http.MethodPost, "/api/tasks", body,
					&http.Cookie{Name: "snappy_session", Value: "token"})
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
				}
			})
		}
	})

	t.Run("creates a task with defaults in the requested lane", func(t *testing.T) {
		ownerID := "owner1"
		now := time.Now()
		db := &fakeDB{
			session:  dbgen.Session{Token: "token", UserID: ownerID},
			boardErr: pgx.ErrNoRows,
			board: dbgen.Board{
				ID: newUUID(2), Title: "Board Owner", OwnerID: ownerID,
				CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
				UpdatedAt: pgtype.Timestamptz{Time: now, Valid: true},
			},
			user:      dbgen.User{ID: ownerID, FullName: "Board Owner"},
			columnErr: pgx.ErrNoRows,
			column: dbgen.Column{
				ID: newUUID(3), BoardID: newUUID(2), Title: "To Do", Position: 1,
				CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
			},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPost, "/api/tasks", `{"title":"  Call dentist  ","state":"ToDo"}`,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if !tx.committed {
			t.Fatal("task transaction was not committed")
		}
		if len(db.boardArgs) != 2 || db.boardArgs[0] != "Board Owner's personal board" || db.boardArgs[1] != ownerID ||
			!db.board.IsPersonal {
			t.Fatalf("personal board args = %#v", db.boardArgs)
		}
		if len(db.taskArgs) != 7 || db.taskArgs[0] != db.column.ID || db.taskArgs[1] != "ToDo" ||
			db.taskArgs[2] != "Call dentist" || db.taskArgs[4] != "Medium" {
			t.Fatalf("task args = %#v", db.taskArgs)
		}
		var task dbgen.Task
		if err := json.Unmarshal(response.Body.Bytes(), &task); err != nil {
			t.Fatalf("decode created task: %v", err)
		}
		if task.Title != "Call dentist" || task.State != "ToDo" || task.Priority != "Medium" {
			t.Fatalf("created task = %#v", task)
		}
	})

	t.Run("rejects To Do tasks when the lane is full", func(t *testing.T) {
		ownerID := "owner1"
		db := &fakeDB{
			session:        dbgen.Session{Token: "token", UserID: ownerID},
			board:          dbgen.Board{ID: newUUID(2), OwnerID: ownerID},
			stateTaskCount: 5,
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPost, "/api/tasks",
			`{"title":"Full lane","state":"ToDo"}`, &http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusConflict || len(db.taskArgs) != 0 {
			t.Fatalf("status = %d, task args = %#v, want conflict without creating task: %s",
				response.Code, db.taskArgs, response.Body.String())
		}
	})

	t.Run("reports lane capacity query failures", func(t *testing.T) {
		ownerID := "owner1"
		db := &fakeDB{
			session:           dbgen.Session{Token: "token", UserID: ownerID},
			board:             dbgen.Board{ID: newUUID(2), OwnerID: ownerID},
			stateTaskCountErr: errors.New("capacity query failed"),
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPost, "/api/tasks",
			`{"title":"Task","state":"ToDo"}`, &http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusInternalServerError || len(db.taskArgs) != 0 {
			t.Fatalf("status = %d, task args = %#v, want capacity error without creating task: %s",
				response.Code, db.taskArgs, response.Body.String())
		}
	})

	t.Run("creates task on the selected owned board", func(t *testing.T) {
		ownerID := "owner1"
		boardID := newUUID(4)
		db := &fakeDB{
			session:   dbgen.Session{Token: "token", UserID: ownerID},
			board:     dbgen.Board{ID: boardID, Title: "Project Board", OwnerID: ownerID},
			columnErr: pgx.ErrNoRows,
			column:    dbgen.Column{ID: newUUID(5), BoardID: boardID, Title: "Backlog"},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPost, "/api/tasks",
			`{"title":"Selected board task","board_id":"`+boardID.String()+`"}`,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if len(db.columnArgs) != 3 || db.columnArgs[0] != boardID {
			t.Fatalf("column args = %#v, want selected board %v", db.columnArgs, boardID)
		}
	})

	t.Run("rejects a board that is not owned by the user", func(t *testing.T) {
		ownerID := "owner1"
		boardID := newUUID(4)
		db := &fakeDB{
			session:  dbgen.Session{Token: "token", UserID: ownerID},
			boardErr: pgx.ErrNoRows,
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPost, "/api/tasks",
			`{"title":"Other user's board task","board_id":"`+boardID.String()+`"}`,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
		}
		if len(db.taskArgs) != 0 {
			t.Fatalf("task was created on an unowned board: %#v", db.taskArgs)
		}
	})

	t.Run("persists optional task details", func(t *testing.T) {
		ownerID := "owner1"
		due := time.Date(2026, time.October, 20, 9, 30, 0, 0, time.UTC)
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    dbgen.User{ID: "assigned1", FullName: "Assigned User"},
			board:   dbgen.Board{ID: newUUID(2), Title: "Existing", OwnerID: ownerID},
			column:  dbgen.Column{ID: newUUID(3), BoardID: newUUID(2), Title: "Backlog"},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		body := `{"title":"Plan trip","description":"Compare dates","assigned_to_id":"` + db.user.ID +
			`","state":"Backlog","priority":"High","complete_by":"` + due.Format(time.RFC3339) + `"}`

		response := send(handler, http.MethodPost, "/api/tasks", body,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if db.task.Description.String != "Compare dates" ||
			db.task.AssignedToID != (pgtype.Text{String: db.user.ID, Valid: true}) ||
			db.task.Priority != "High" || !db.task.CompleteBy.Time.Equal(due) {
			t.Fatalf("created task fields = %#v", db.task)
		}
	})
}

func TestMoveTaskEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPatch,
			"/api/tasks/"+newUUID(2).String(), `{"state":"InProgress"}`, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("persists a move to the requested state", func(t *testing.T) {
		ownerID := "owner1"
		taskID := newUUID(2)
		destinationColumnID := newUUID(3)
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			board:   dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
			column: dbgen.Column{
				ID: destinationColumnID, BoardID: newUUID(4), Title: "In Progress", Position: 2,
			},
			task: dbgen.Task{ID: taskID, Title: "Persist this move", State: "ToDo", Priority: "Medium"},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPatch, "/api/tasks/"+taskID.String(),
			`{"state":"InProgress"}`, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if !tx.committed {
			t.Fatal("task move transaction was not committed")
		}
		if len(db.moveTaskArgs) != 3 || db.moveTaskArgs[0] != destinationColumnID ||
			db.moveTaskArgs[1] != taskID || db.moveTaskArgs[2] != ownerID {
			t.Fatalf("move task args = %#v", db.moveTaskArgs)
		}
		var movedTask dbgen.Task
		if err := json.Unmarshal(response.Body.Bytes(), &movedTask); err != nil {
			t.Fatalf("decode moved task: %v", err)
		}
		if movedTask.State != "InProgress" || movedTask.ColumnID != destinationColumnID {
			t.Fatalf("moved task = %#v", movedTask)
		}
	})

	t.Run("rejects moving into a full lane", func(t *testing.T) {
		taskID := newUUID(2)
		db := &fakeDB{
			session:        dbgen.Session{Token: "token", UserID: "owner1"},
			board:          dbgen.Board{ID: newUUID(4), OwnerID: "owner1"},
			column:         dbgen.Column{ID: newUUID(3), BoardID: newUUID(4), Title: "To Do"},
			task:           dbgen.Task{ID: taskID, State: "Backlog"},
			stateTaskCount: 5,
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPatch, "/api/tasks/"+taskID.String(),
			`{"state":"ToDo"}`, cookie)
		if response.Code != http.StatusConflict || len(db.moveTaskArgs) != 0 {
			t.Fatalf("status = %d, move args = %#v, want conflict without moving task: %s",
				response.Code, db.moveTaskArgs, response.Body.String())
		}
	})

	t.Run("rejects an unsupported state", func(t *testing.T) {
		db := &fakeDB{session: dbgen.Session{Token: "token", UserID: "owner1"}}
		response := send(newHandler(db, nil, false), http.MethodPatch,
			"/api/tasks/"+newUUID(2).String(), `{"state":"Blocked"}`, cookie)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
		}
	})

	for _, test := range []struct {
		name            string
		path            string
		body            string
		beginMissing    bool
		beginErr        error
		execErr         error
		boardErr        error
		columnErr       error
		createColumnErr error
		moveTaskErr     error
		commitErr       error
		wantStatus      int
	}{
		{name: "invalid task ID", path: "/api/tasks/not-a-uuid", body: `{"state":"ToDo"}`, wantStatus: http.StatusBadRequest},
		{name: "invalid JSON", path: "/api/tasks/" + newUUID(2).String(), body: `{`, wantStatus: http.StatusBadRequest},
		{name: "missing transaction provider", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, beginMissing: true, wantStatus: http.StatusInternalServerError},
		{name: "begin error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, beginErr: errors.New("begin failed"), wantStatus: http.StatusInternalServerError},
		{name: "advisory lock error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, execErr: errors.New("lock failed"), wantStatus: http.StatusInternalServerError},
		{name: "task not found", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, boardErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "task query error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, boardErr: errors.New("query failed"), wantStatus: http.StatusInternalServerError},
		{name: "lane query error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, columnErr: errors.New("query failed"), wantStatus: http.StatusInternalServerError},
		{name: "lane creation error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, columnErr: pgx.ErrNoRows, createColumnErr: errors.New("insert failed"), wantStatus: http.StatusInternalServerError},
		{name: "task not found on update", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, moveTaskErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "update error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, moveTaskErr: errors.New("update failed"), wantStatus: http.StatusInternalServerError},
		{name: "commit error", path: "/api/tasks/" + newUUID(2).String(), body: `{"state":"ToDo"}`, commitErr: errors.New("commit failed"), wantStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			ownerID := "owner1"
			db := &fakeDB{
				session:         dbgen.Session{Token: "token", UserID: ownerID},
				board:           dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
				column:          dbgen.Column{ID: newUUID(3), BoardID: newUUID(4), Title: "To Do"},
				boardErr:        test.boardErr,
				columnErr:       test.columnErr,
				createColumnErr: test.createColumnErr,
				moveTaskErr:     test.moveTaskErr,
			}
			var begin func(context.Context) (backend.SetupTransaction, error)
			if !test.beginMissing {
				begin = func(context.Context) (backend.SetupTransaction, error) {
					if test.beginErr != nil {
						return nil, test.beginErr
					}
					return &fakeTx{
						fakeDB: db, execErr: test.execErr, commitErr: test.commitErr,
					}, nil
				}
			}
			response := send(newHandler(db, begin, false), http.MethodPatch, test.path, test.body, cookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}

	t.Run("creates a missing destination lane", func(t *testing.T) {
		ownerID := "owner1"
		db := &fakeDB{
			session:   dbgen.Session{Token: "token", UserID: ownerID},
			board:     dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
			column:    dbgen.Column{ID: newUUID(3), BoardID: newUUID(4), Title: "Complete"},
			columnErr: pgx.ErrNoRows,
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		response := send(handler, http.MethodPatch, "/api/tasks/"+newUUID(2).String(),
			`{"state":"Complete"}`, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if !tx.committed || db.columnArgs[1] != "Complete" || db.columnArgs[2] != int32(3) {
			t.Fatalf("lane creation args = %#v; committed = %t", db.columnArgs, tx.committed)
		}
	})
}

func TestUpdateTaskEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	taskID := newUUID(2)
	ownerID := "owner1"
	due := time.Date(2026, time.October, 20, 9, 30, 0, 0, time.UTC)
	body := `{"title":"  Updated task  ","description":"Revised details","priority":"High",` +
		`"state":"InProgress","complete_by":"` + due.Format(time.RFC3339) + `"}`

	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPut,
			"/api/tasks/"+taskID.String(), body, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("reports session lookup failures", func(t *testing.T) {
		db := &fakeDB{sessionErr: errors.New("session store unavailable")}
		response := send(newHandler(db, nil, false), http.MethodPut,
			"/api/tasks/"+taskID.String(), body, cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
		}
	})

	for _, test := range []struct {
		name string
		path string
		body string
		want int
	}{
		{name: "invalid task ID", path: "/api/tasks/bad-id", body: body, want: http.StatusBadRequest},
		{name: "invalid JSON", path: "/api/tasks/" + taskID.String(), body: `{`, want: http.StatusBadRequest},
		{name: "blank title", path: "/api/tasks/" + taskID.String(), body: `{"title":" ","priority":"Low","state":"Backlog"}`, want: http.StatusBadRequest},
		{name: "title too long", path: "/api/tasks/" + taskID.String(), body: `{"title":"` + strings.Repeat("x", 256) + `","priority":"Low","state":"Backlog"}`, want: http.StatusBadRequest},
		{name: "invalid priority", path: "/api/tasks/" + taskID.String(), body: `{"title":"Task","priority":"Urgent","state":"Backlog"}`, want: http.StatusBadRequest},
		{name: "invalid state", path: "/api/tasks/" + taskID.String(), body: `{"title":"Task","priority":"Low","state":"Blocked"}`, want: http.StatusBadRequest},
		{name: "invalid board ID", path: "/api/tasks/" + taskID.String(), body: `{"title":"Task","priority":"Low","state":"Backlog","board_id":"not-a-uuid"}`, want: http.StatusBadRequest},
		{name: "invalid due date", path: "/api/tasks/" + taskID.String(), body: `{"title":"Task","priority":"Low","state":"Backlog","complete_by":"not-a-date"}`, want: http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{
				session: dbgen.Session{Token: "token", UserID: ownerID},
				user:    dbgen.User{Role: "user"},
			}
			response := send(newHandler(db, nil, false), http.MethodPut, test.path, test.body, cookie)
			if response.Code != test.want {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.want, response.Body.String())
			}
		})
	}

	for _, test := range []struct {
		name            string
		beginMissing    bool
		beginErr        error
		lockErr         error
		boardErr        error
		columnErr       error
		createColumnErr error
		updateErr       error
		commitErr       error
		wantStatus      int
	}{
		{name: "missing transaction provider", beginMissing: true, wantStatus: http.StatusInternalServerError},
		{name: "transaction begin failure", beginErr: errors.New("begin failed"), wantStatus: http.StatusInternalServerError},
		{name: "transaction lock failure", lockErr: errors.New("lock failed"), wantStatus: http.StatusInternalServerError},
		{name: "task not found", boardErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "task lookup failure", boardErr: errors.New("query failed"), wantStatus: http.StatusInternalServerError},
		{name: "lane lookup failure", columnErr: errors.New("query failed"), wantStatus: http.StatusInternalServerError},
		{name: "lane creation failure", columnErr: pgx.ErrNoRows, createColumnErr: errors.New("insert failed"), wantStatus: http.StatusInternalServerError},
		{name: "task disappeared before update", updateErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
		{name: "task update failure", updateErr: errors.New("update failed"), wantStatus: http.StatusInternalServerError},
		{name: "transaction commit failure", commitErr: errors.New("commit failed"), wantStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{
				session:         dbgen.Session{Token: "token", UserID: ownerID},
				board:           dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
				column:          dbgen.Column{ID: newUUID(3), BoardID: newUUID(4), Title: "To Do"},
				boardErr:        test.boardErr,
				columnErr:       test.columnErr,
				createColumnErr: test.createColumnErr,
				updateTaskErr:   test.updateErr,
			}
			var begin func(context.Context) (backend.SetupTransaction, error)
			if !test.beginMissing {
				begin = func(context.Context) (backend.SetupTransaction, error) {
					if test.beginErr != nil {
						return nil, test.beginErr
					}
					return &fakeTx{fakeDB: db, execErr: test.lockErr, commitErr: test.commitErr}, nil
				}
			}
			requestBody := `{"title":"Updated","description":"","priority":"Low","state":"ToDo"}`
			response := send(newHandler(db, begin, false), http.MethodPut,
				"/api/tasks/"+taskID.String(), requestBody, cookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}

	for _, test := range []struct {
		name         string
		state        string
		columnTitle  string
		wantPosition int32
	}{
		{name: "To Do", state: "ToDo", columnTitle: "To Do", wantPosition: 1},
		{name: "In Progress", state: "InProgress", columnTitle: "In Progress", wantPosition: 2},
		{name: "Complete", state: "Complete", columnTitle: "Complete", wantPosition: 3},
	} {
		t.Run("creates missing "+test.name+" lane", func(t *testing.T) {
			db := &fakeDB{
				session:   dbgen.Session{Token: "token", UserID: ownerID},
				board:     dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
				column:    dbgen.Column{ID: newUUID(3), BoardID: newUUID(4), Title: test.columnTitle},
				columnErr: pgx.ErrNoRows,
			}
			tx := &fakeTx{fakeDB: db}
			handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
				return tx, nil
			}, false)
			requestBody := `{"title":"Updated","description":"","priority":"Low","state":"` + test.state + `"}`
			response := send(handler, http.MethodPut, "/api/tasks/"+taskID.String(), requestBody, cookie)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
			}
			if !tx.committed || db.columnArgs[1] != test.columnTitle || db.columnArgs[2] != test.wantPosition {
				t.Fatalf("created lane args = %#v; committed = %t", db.columnArgs, tx.committed)
			}
		})
	}

	t.Run("moves task to the selected board lane", func(t *testing.T) {
		sourceBoardID := newUUID(4)
		destinationBoardID := newUUID(5)
		columnID := newUUID(6)
		db := &fakeDB{
			session:          dbgen.Session{Token: "token", UserID: ownerID},
			board:            dbgen.Board{ID: sourceBoardID, OwnerID: ownerID},
			destinationBoard: dbgen.Board{ID: destinationBoardID, OwnerID: ownerID},
			column:           dbgen.Column{ID: columnID, BoardID: destinationBoardID, Title: "In Progress"},
			columnErr:        pgx.ErrNoRows,
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		requestBody := `{"board_id":"` + destinationBoardID.String() + `","title":"Updated","description":"","priority":"Low","state":"InProgress"}`
		response := send(handler, http.MethodPut, "/api/tasks/"+taskID.String(), requestBody, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if len(db.columnArgs) != 3 || db.columnArgs[0] != destinationBoardID {
			t.Fatalf("created lane args = %#v, want destination board %v", db.columnArgs, destinationBoardID)
		}
		if len(db.updateTaskArgs) != 9 || db.updateTaskArgs[0] != columnID {
			t.Fatalf("task update args = %#v, want destination lane %v", db.updateTaskArgs, columnID)
		}
	})

	t.Run("rejects editing a task into a full lane", func(t *testing.T) {
		db := &fakeDB{
			session:        dbgen.Session{Token: "token", UserID: ownerID},
			board:          dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
			column:         dbgen.Column{ID: newUUID(6), BoardID: newUUID(4), Title: "In Progress"},
			stateTaskCount: 5,
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		requestBody := `{"title":"Updated","description":"","priority":"Low","state":"InProgress"}`
		response := send(handler, http.MethodPut, "/api/tasks/"+taskID.String(), requestBody, cookie)
		if response.Code != http.StatusConflict || len(db.updateTaskArgs) != 0 {
			t.Fatalf("status = %d, update args = %#v, want conflict without updating task: %s",
				response.Code, db.updateTaskArgs, response.Body.String())
		}
	})

	t.Run("rejects inaccessible destination board", func(t *testing.T) {
		destinationBoardID := newUUID(5)
		db := &fakeDB{
			session:             dbgen.Session{Token: "token", UserID: ownerID},
			board:               dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
			destinationBoard:    dbgen.Board{ID: destinationBoardID},
			destinationBoardErr: pgx.ErrNoRows,
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		requestBody := `{"board_id":"` + destinationBoardID.String() + `","title":"Updated","priority":"Low","state":"ToDo"}`
		response := send(handler, http.MethodPut, "/api/tasks/"+taskID.String(), requestBody, cookie)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
		}
	})

	t.Run("persists all editable fields and state", func(t *testing.T) {
		columnID := newUUID(3)
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    dbgen.User{ID: "assignee2"},
			board:   dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
			column: dbgen.Column{
				ID: columnID, BoardID: newUUID(4), Title: "In Progress",
			},
			task: dbgen.Task{ID: taskID, Title: "Old task", State: "ToDo", Priority: "Low"},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		requestBody := `{"title":"  Updated task  ","description":"Revised details","priority":"High",` +
			`"state":"InProgress","assigned_to_id":"assignee2","complete_by":"` + due.Format(time.RFC3339) + `"}`
		response := send(handler, http.MethodPut, "/api/tasks/"+taskID.String(), requestBody, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if !tx.committed {
			t.Fatal("task update transaction was not committed")
		}
		args := db.updateTaskArgs
		if len(args) != 9 || args[0] != columnID || args[1] != "InProgress" ||
			args[2] != "Updated task" || args[3] != (pgtype.Text{String: "Revised details", Valid: true}) ||
			args[4] != "High" || args[7] != taskID || args[8] != ownerID {
			t.Fatalf("update task args = %#v", args)
		}
		if got := args[5].(pgtype.Timestamptz); !got.Valid || !got.Time.Equal(due) {
			t.Fatalf("complete-by arg = %#v, want %v", got, due)
		}
		if got := args[6].(pgtype.Text); got != (pgtype.Text{String: "assignee2", Valid: true}) {
			t.Fatalf("assigned user arg = %#v", got)
		}
		var updated dbgen.Task
		if err := json.Unmarshal(response.Body.Bytes(), &updated); err != nil {
			t.Fatalf("decode updated task: %v", err)
		}
		if updated.Title != "Updated task" || updated.State != "InProgress" || updated.Priority != "High" {
			t.Fatalf("updated task = %#v", updated)
		}
	})

	t.Run("clears optional fields", func(t *testing.T) {
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			board:   dbgen.Board{ID: newUUID(4), OwnerID: ownerID},
			column:  dbgen.Column{ID: newUUID(3), BoardID: newUUID(4), Title: "Backlog"},
			task:    dbgen.Task{ID: taskID, Title: "Task", State: "ToDo", Priority: "Medium"},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)
		response := send(handler, http.MethodPut, "/api/tasks/"+taskID.String(),
			`{"title":"Task","description":"","priority":"Medium","state":"Backlog","complete_by":null}`, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if db.task.Description.Valid || db.task.CompleteBy.Valid {
			t.Fatalf("optional fields were not cleared: %#v", db.task)
		}
	})
}

func TestTaskReadEndpointsRequireAuthentication(t *testing.T) {
	for _, path := range []string{"/api/tasks", "/api/users"} {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodGet, path, "", nil)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("%s status = %d, want %d", path, response.Code, http.StatusUnauthorized)
		}
	}
}

func TestTaskReadEndpoints(t *testing.T) {
	ownerID := "owner1"
	task := dbgen.Task{
		ID:       newUUID(2),
		ColumnID: newUUID(3),
		Title:    "Read saved task",
		State:    "Backlog",
		Priority: "Medium",
	}
	assignee := dbgen.GetUsersForAssignmentRow{ID: ownerID, FullName: "Board Owner"}
	db := &fakeDB{
		session:   dbgen.Session{Token: "token", UserID: ownerID},
		tasks:     []dbgen.Task{task},
		assignees: []dbgen.GetUsersForAssignmentRow{assignee},
	}
	handler := newHandler(db, nil, false)
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}

	tasksResponse := send(handler, http.MethodGet, "/api/tasks", "", cookie)
	if tasksResponse.Code != http.StatusOK {
		t.Fatalf("tasks status = %d, want %d: %s", tasksResponse.Code, http.StatusOK, tasksResponse.Body.String())
	}
	var tasks []dbgen.Task
	if err := json.Unmarshal(tasksResponse.Body.Bytes(), &tasks); err != nil {
		t.Fatalf("decode tasks: %v", err)
	}
	if len(tasks) != 1 || tasks[0].Title != task.Title || tasks[0].Priority != task.Priority {
		t.Fatalf("tasks = %#v", tasks)
	}

	usersResponse := send(handler, http.MethodGet, "/api/users", "", cookie)
	if usersResponse.Code != http.StatusOK {
		t.Fatalf("users status = %d, want %d: %s", usersResponse.Code, http.StatusOK, usersResponse.Body.String())
	}
	var users []dbgen.GetUsersForAssignmentRow
	if err := json.Unmarshal(usersResponse.Body.Bytes(), &users); err != nil {
		t.Fatalf("decode assignable users: %v", err)
	}
	if len(users) != 1 || users[0] != assignee {
		t.Fatalf("assignable users = %#v", users)
	}

	for _, test := range []struct {
		name string
		db   *fakeDB
		path string
	}{
		{name: "task query error", db: &fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}, tasksErr: errors.New("query failed")}, path: "/api/tasks"},
		{name: "assignee query error", db: &fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}, assigneesErr: errors.New("query failed")}, path: "/api/users"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := send(newHandler(test.db, nil, false), http.MethodGet, test.path, "", cookie)
			if response.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
			}
		})
	}

	t.Run("empty task and assignee lists are encoded as arrays", func(t *testing.T) {
		emptyDB := &fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}}
		handler := newHandler(emptyDB, nil, false)
		for _, path := range []string{"/api/tasks", "/api/users"} {
			response := send(handler, http.MethodGet, path, "", cookie)
			if response.Code != http.StatusOK || response.Body.String() != "[]\n" {
				t.Errorf("%s response = %d %q", path, response.Code, response.Body.String())
			}
		}
	})
}
