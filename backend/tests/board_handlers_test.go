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

func TestCreateBoardEndpoint(t *testing.T) {
	t.Run("requires a session", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPost, "/api/boards", `{"title":"Board"}`, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	for _, test := range []struct {
		name       string
		body       string
		sessionErr error
		boardErr   error
		userErr    error
		beginErr   error
		commitErr  error
		beginNil   bool
		wantStatus int
	}{
		{name: "database session error", body: `{"title":"Board"}`, sessionErr: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError},
		{name: "invalid JSON", body: `{`, wantStatus: http.StatusBadRequest},
		{name: "empty title", body: `{"title":" "}`, wantStatus: http.StatusBadRequest},
		{name: "title exceeds maximum length", body: `{"title":"` + strings.Repeat("a", 101) + `"}`, wantStatus: http.StatusBadRequest},
		{name: "missing transaction provider", body: `{"title":"Board"}`, beginNil: true, wantStatus: http.StatusInternalServerError},
		{name: "transaction begin failure", body: `{"title":"Board"}`, beginErr: errors.New("begin failed"), wantStatus: http.StatusInternalServerError},
		{name: "board insert failure", body: `{"title":"Board"}`, boardErr: errors.New("insert failed"), wantStatus: http.StatusInternalServerError},
		{name: "invalid member", body: `{"title":"Board","user_ids":["bad-id"]}`, wantStatus: http.StatusBadRequest},
		{name: "missing member", body: `{"title":"Board","user_ids":["member1"]}`, userErr: pgx.ErrNoRows, wantStatus: http.StatusBadRequest},
		{name: "member lookup failure", body: `{"title":"Board","user_ids":["member1"]}`, userErr: errors.New("lookup failed"), wantStatus: http.StatusInternalServerError},
		{name: "transaction commit failure", body: `{"title":"Board"}`, commitErr: errors.New("commit failed"), wantStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{
				session:        dbgen.Session{Token: "token", UserID: "owner7"},
				sessionErr:     test.sessionErr,
				createBoardErr: test.boardErr,
				userErr:        test.userErr,
			}
			var begin func(context.Context) (backend.SetupTransaction, error)
			if !test.beginNil {
				tx := &fakeTx{fakeDB: db, commitErr: test.commitErr}
				begin = func(context.Context) (backend.SetupTransaction, error) {
					if test.beginErr != nil {
						return nil, test.beginErr
					}
					return tx, nil
				}
			}
			response := send(newHandler(db, begin, false), http.MethodPost, "/api/boards", test.body,
				&http.Cookie{Name: "snappy_session", Value: "token"})
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
		})
	}

	t.Run("uses session owner instead of request owner", func(t *testing.T) {
		ownerID := "owner7"
		now := time.Now()
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    dbgen.User{ID: ownerID, FullName: "Owner"},
			board: dbgen.Board{
				ID: newUUID(8), Title: "Family Board", OwnerID: ownerID,
				CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
				UpdatedAt: pgtype.Timestamptz{Time: now, Valid: true},
			},
		}
		tx := &fakeTx{fakeDB: db}
		response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false), http.MethodPost, "/api/boards",
			`{"title":" Family Board ","user_ids":["member7","member7"],"owner_id":"attacker-controlled"}`,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusCreated || !tx.committed {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if db.boardArgs[0] != "Family Board" || db.boardArgs[1] != ownerID {
			t.Fatalf("board args = %#v, want normalized title and session owner", db.boardArgs)
		}
		if len(db.boardMemberArgs) != 2 {
			t.Fatalf("board member inserts = %#v, want owner and one deduplicated selected user", db.boardMemberArgs)
		}
		for _, args := range db.boardMemberArgs {
			if args[0] != db.board.ID {
				t.Fatalf("board member args = %#v, want created board ID", args)
			}
		}
	})

	t.Run("rolls back board creation if access cannot be granted", func(t *testing.T) {
		db := &fakeDB{
			session:        dbgen.Session{Token: "token", UserID: "owner7"},
			user:           dbgen.User{ID: "member7", FullName: "Member"},
			boardMemberErr: errors.New("membership insert failed"),
		}
		tx := &fakeTx{fakeDB: db}
		response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false), http.MethodPost, "/api/boards",
			`{"title":"Shared","user_ids":["member7"]}`,
			&http.Cookie{Name: "snappy_session", Value: "token"})
		if response.Code != http.StatusInternalServerError || tx.committed || !tx.rolledBack {
			t.Fatalf("status=%d committed=%t rolledBack=%t",
				response.Code, tx.committed, tx.rolledBack)
		}
	})
}

func TestGetBoardsEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodGet, "/api/boards", "", nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("returns boards owned by the session user", func(t *testing.T) {
		board := dbgen.Board{ID: newUUID(8), Title: "Personal Board", OwnerID: "owner7"}
		response := send(newHandler(&fakeDB{
			session: dbgen.Session{Token: "token", UserID: "owner7"},
			boards:  []dbgen.Board{board},
		}, nil, false), http.MethodGet, "/api/boards", "", cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		var boards []dbgen.Board
		if err := json.Unmarshal(response.Body.Bytes(), &boards); err != nil {
			t.Fatalf("decode boards: %v", err)
		}
		if len(boards) != 1 || boards[0].Title != board.Title || boards[0].OwnerID != "owner7" {
			t.Fatalf("boards = %#v", boards)
		}
	})
}

func TestUpdateBoardOrderEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPut,
			"/api/boards/order", `{"board_ids":[]}`, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	boardID1, boardID2 := newUUID(1), newUUID(2)
	t.Run("persists the requested order for all accessible boards", func(t *testing.T) {
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: "owner7"},
			boards: []dbgen.Board{
				{ID: boardID1, Title: "First", OwnerID: "owner7"},
				{ID: boardID2, Title: "Second", OwnerID: "owner7"},
			},
		}
		tx := &fakeTx{fakeDB: db}
		handler := newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false)

		response := send(handler, http.MethodPut, "/api/boards/order",
			`{"board_ids":["`+boardID2.String()+`","`+boardID1.String()+`"]}`, cookie)
		if response.Code != http.StatusNoContent || !tx.committed {
			t.Fatalf("status = %d, committed = %t, want no content and committed transaction: %s",
				response.Code, tx.committed, response.Body.String())
		}
		if len(db.boardOrderDeleteArgs) != 1 || db.boardOrderDeleteArgs[0] != "owner7" {
			t.Fatalf("board order delete args = %#v", db.boardOrderDeleteArgs)
		}
		if len(db.boardOrderInsertArgs) != 2 {
			t.Fatalf("board order inserts = %#v", db.boardOrderInsertArgs)
		}
		if db.boardOrderInsertArgs[0][0] != "owner7" || db.boardOrderInsertArgs[0][1] != boardID2 ||
			db.boardOrderInsertArgs[0][2] != int32(0) ||
			db.boardOrderInsertArgs[1][1] != boardID1 || db.boardOrderInsertArgs[1][2] != int32(1) {
			t.Fatalf("board order insert args = %#v", db.boardOrderInsertArgs)
		}
	})

	for _, test := range []struct {
		name string
		body string
	}{
		{name: "invalid JSON", body: `{`},
		{name: "missing board IDs", body: `{}`},
		{name: "invalid board ID", body: `{"board_ids":["invalid"]}`},
		{name: "duplicate board ID", body: `{"board_ids":["` + boardID1.String() + `","` + boardID1.String() + `"]}`},
		{name: "incomplete board order", body: `{"board_ids":["` + boardID1.String() + `"]}`},
		{name: "inaccessible board", body: `{"board_ids":["` + boardID1.String() + `","` + newUUID(3).String() + `"]}`},
	} {
		t.Run("rejects "+test.name, func(t *testing.T) {
			db := &fakeDB{
				session: dbgen.Session{Token: "token", UserID: "owner7"},
				boards: []dbgen.Board{
					{ID: boardID1, Title: "First", OwnerID: "owner7"},
					{ID: boardID2, Title: "Second", OwnerID: "owner7"},
				},
			}
			response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
				return &fakeTx{fakeDB: db}, nil
			}, false), http.MethodPut, "/api/boards/order", test.body, cookie)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
			if len(db.boardOrderInsertArgs) != 0 {
				t.Fatalf("invalid order was persisted: %#v", db.boardOrderInsertArgs)
			}
		})
	}

	t.Run("reports board-order persistence failures", func(t *testing.T) {
		for _, test := range []struct {
			name           string
			boardsErr      error
			deleteOrderErr error
			insertOrderErr error
		}{
			{name: "board access query", boardsErr: errors.New("board query failed")},
			{name: "delete existing order", deleteOrderErr: errors.New("delete failed")},
			{name: "insert new order", insertOrderErr: errors.New("insert failed")},
		} {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session:             dbgen.Session{Token: "token", UserID: "owner7"},
					boards:              []dbgen.Board{{ID: boardID1, Title: "First", OwnerID: "owner7"}},
					boardsErr:           test.boardsErr,
					boardOrderDeleteErr: test.deleteOrderErr,
					boardOrderInsertErr: test.insertOrderErr,
				}
				tx := &fakeTx{fakeDB: db}
				response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
					return tx, nil
				}, false), http.MethodPut, "/api/boards/order",
					`{"board_ids":["`+boardID1.String()+`"]}`, cookie)
				if response.Code != http.StatusInternalServerError || tx.committed {
					t.Fatalf("status = %d, committed = %t, want internal error and rollback: %s",
						response.Code, tx.committed, response.Body.String())
				}
			})
		}
	})
}

func TestDeleteBoardEndpoint(t *testing.T) {
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodDelete,
			"/api/boards/"+newUUID(8).String(), "", nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	for _, test := range []struct {
		name       string
		boardID    string
		rows       int64
		deleteErr  error
		sessionErr error
		role       string
		boardOwner string
		personal   bool
		wantStatus int
	}{
		{name: "invalid board ID", boardID: "invalid", wantStatus: http.StatusBadRequest},
		{name: "board does not belong to user", boardID: newUUID(8).String(), rows: 1, role: "user", boardOwner: "other", wantStatus: http.StatusNotFound},
		{name: "session lookup error", boardID: newUUID(8).String(), sessionErr: errors.New("session lookup failed"), wantStatus: http.StatusInternalServerError},
		{name: "database error", boardID: newUUID(8).String(), deleteErr: errors.New("delete failed"), wantStatus: http.StatusInternalServerError},
		{name: "deletes owned board", boardID: newUUID(8).String(), rows: 1, role: "user", boardOwner: "owner7", wantStatus: http.StatusNoContent},
		{name: "admin deletes any board", boardID: newUUID(8).String(), rows: 1, role: "admin", boardOwner: "other", wantStatus: http.StatusNoContent},
		{name: "user cannot delete personal board", boardID: newUUID(8).String(), rows: 1, role: "user", boardOwner: "owner7", personal: true, wantStatus: http.StatusNotFound},
		{name: "admin cannot delete personal board", boardID: newUUID(8).String(), rows: 1, role: "admin", boardOwner: "other", personal: true, wantStatus: http.StatusNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := &fakeDB{
				session:         dbgen.Session{Token: "token", UserID: "owner7"},
				sessionErr:      test.sessionErr,
				user:            dbgen.User{ID: "owner7", Role: test.role},
				board:           dbgen.Board{OwnerID: test.boardOwner, IsPersonal: test.personal},
				deleteBoardRows: test.rows,
				deleteBoardErr:  test.deleteErr,
			}
			response := send(newHandler(db, nil, false), http.MethodDelete,
				"/api/boards/"+test.boardID, "", cookie)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
			if test.boardID != "invalid" && test.sessionErr == nil && test.deleteErr == nil {
				boardID := pgtype.UUID{}
				if err := boardID.Scan(test.boardID); err != nil {
					t.Fatalf("parse test board ID: %v", err)
				}
				if len(db.deleteBoardArgs) != 2 || db.deleteBoardArgs[0] != boardID || db.deleteBoardArgs[1] != "owner7" {
					t.Fatalf("delete args = %#v, want requested board and authenticated owner", db.deleteBoardArgs)
				}
				if !strings.Contains(db.deleteBoardQuery, "role = 'admin'") {
					t.Fatalf("delete query = %q, want admin role check", db.deleteBoardQuery)
				}
				if !strings.Contains(db.deleteBoardQuery, "NOT board.is_personal") {
					t.Fatalf("delete query = %q, want personal board protection", db.deleteBoardQuery)
				}
			}
		})
	}
}

func TestBoardMemberEndpoints(t *testing.T) {
	const ownerID = "owner7"
	boardID := newUUID(8).String()
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	board := dbgen.Board{ID: newUUID(8), Title: "Shared Board", OwnerID: ownerID}

	t.Run("gets board members with owner and admin access", func(t *testing.T) {
		for _, test := range []struct {
			name          string
			sessionUserID string
			role          string
			wantStatus    int
			wantMembers   []string
		}{
			{name: "owner", sessionUserID: ownerID, role: "user", wantStatus: http.StatusOK, wantMembers: []string{"member7"}},
			{name: "admin", sessionUserID: "admin1", role: "admin", wantStatus: http.StatusOK, wantMembers: []string{"member7"}},
		} {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session:      dbgen.Session{Token: "token", UserID: test.sessionUserID},
					user:         dbgen.User{ID: test.sessionUserID, Role: test.role},
					board:        board,
					boardMembers: []string{ownerID, "member7"},
				}
				response := send(newHandler(db, nil, false), http.MethodGet,
					"/api/boards/"+boardID+"/members", "", cookie)
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
				}
				var result struct {
					UserIDs []string `json:"user_ids"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
					t.Fatalf("decode board members: %v", err)
				}
				if strings.Join(result.UserIDs, ",") != strings.Join(test.wantMembers, ",") {
					t.Fatalf("user_ids = %#v, want %#v", result.UserIDs, test.wantMembers)
				}
			})
		}
	})

	t.Run("rejects unauthorized or unavailable board member reads", func(t *testing.T) {
		for _, test := range []struct {
			name          string
			boardID       string
			sessionUserID string
			role          string
			sessionErr    error
			boardErr      error
			userErr       error
			membersErr    error
			withCookie    bool
			wantStatus    int
		}{
			{name: "authentication required", boardID: boardID, wantStatus: http.StatusUnauthorized},
			{name: "invalid board ID", boardID: "invalid", sessionUserID: ownerID, withCookie: true, wantStatus: http.StatusBadRequest},
			{name: "session lookup failure", boardID: boardID, sessionUserID: ownerID, sessionErr: errors.New("session failed"), withCookie: true, wantStatus: http.StatusInternalServerError},
			{name: "board missing", boardID: boardID, sessionUserID: ownerID, boardErr: pgx.ErrNoRows, withCookie: true, wantStatus: http.StatusNotFound},
			{name: "board lookup failure", boardID: boardID, sessionUserID: ownerID, boardErr: errors.New("board query failed"), withCookie: true, wantStatus: http.StatusInternalServerError},
			{name: "non-owner is hidden", boardID: boardID, sessionUserID: "member7", role: "user", withCookie: true, wantStatus: http.StatusNotFound},
			{name: "admin validation failure", boardID: boardID, sessionUserID: "admin1", userErr: errors.New("user query failed"), withCookie: true, wantStatus: http.StatusInternalServerError},
			{name: "member lookup failure", boardID: boardID, sessionUserID: ownerID, membersErr: errors.New("members query failed"), withCookie: true, wantStatus: http.StatusInternalServerError},
		} {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session:         dbgen.Session{Token: "token", UserID: test.sessionUserID},
					sessionErr:      test.sessionErr,
					user:            dbgen.User{ID: test.sessionUserID, Role: test.role},
					userErr:         test.userErr,
					board:           board,
					boardErr:        test.boardErr,
					boardMembersErr: test.membersErr,
				}
				var requestCookie *http.Cookie
				if test.withCookie {
					requestCookie = cookie
				}
				response := send(newHandler(db, nil, false), http.MethodGet,
					"/api/boards/"+test.boardID+"/members", "", requestCookie)
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
				}
			})
		}
	})

	t.Run("updates and deduplicates board members", func(t *testing.T) {
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    dbgen.User{ID: "member7", Role: "user"},
			board:   board,
		}
		tx := &fakeTx{fakeDB: db}
		response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false), http.MethodPut, "/api/boards/"+boardID+"/members",
			`{"user_ids":["owner7","member7"," member8 ","member7"]}`, cookie)
		if response.Code != http.StatusOK || !tx.committed {
			t.Fatalf("status = %d, committed = %t: %s", response.Code, tx.committed, response.Body.String())
		}
		if len(db.boardMembersDeleteArgs) != 1 || db.boardMembersDeleteArgs[0] != board.ID {
			t.Fatalf("deleted board members args = %#v", db.boardMembersDeleteArgs)
		}
		if len(db.boardMemberArgs) != 2 || db.boardMemberArgs[0][1] != "member7" ||
			db.boardMemberArgs[1][1] != "member8" {
			t.Fatalf("board member inserts = %#v", db.boardMemberArgs)
		}
		var result struct {
			UserIDs []string `json:"user_ids"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatalf("decode updated board members: %v", err)
		}
		if strings.Join(result.UserIDs, ",") != "member7,member8" {
			t.Fatalf("user_ids = %#v, want [member7 member8]", result.UserIDs)
		}
	})

	t.Run("rejects invalid board member updates", func(t *testing.T) {
		for _, test := range []struct {
			name          string
			body          string
			sessionUserID string
			role          string
			userErr       error
			deleteErr     error
			insertErr     error
			beginErr      error
			commitErr     error
			transaction   bool
			wantStatus    int
		}{
			{name: "invalid JSON", body: `{`, wantStatus: http.StatusBadRequest},
			{name: "transaction unavailable", body: `{"user_ids":[]}`, wantStatus: http.StatusInternalServerError},
			{name: "transaction start failure", body: `{"user_ids":[]}`, transaction: true, beginErr: errors.New("begin failed"), wantStatus: http.StatusInternalServerError},
			{name: "delete failure", body: `{"user_ids":[]}`, transaction: true, deleteErr: errors.New("delete failed"), wantStatus: http.StatusInternalServerError},
			{name: "invalid member ID", body: `{"user_ids":["bad id"]}`, transaction: true, wantStatus: http.StatusBadRequest},
			{name: "member does not exist", body: `{"user_ids":["missing"]}`, transaction: true, userErr: pgx.ErrNoRows, wantStatus: http.StatusBadRequest},
			{name: "member lookup failure", body: `{"user_ids":["member7"]}`, transaction: true, userErr: errors.New("lookup failed"), wantStatus: http.StatusInternalServerError},
			{name: "member insert failure", body: `{"user_ids":["member7"]}`, transaction: true, insertErr: errors.New("insert failed"), wantStatus: http.StatusInternalServerError},
			{name: "commit failure", body: `{"user_ids":[]}`, transaction: true, commitErr: errors.New("commit failed"), wantStatus: http.StatusInternalServerError},
			{name: "non-owner cannot update", body: `{"user_ids":[]}`, sessionUserID: "member7", role: "user", transaction: true, wantStatus: http.StatusNotFound},
		} {
			t.Run(test.name, func(t *testing.T) {
				sessionUserID := test.sessionUserID
				if sessionUserID == "" {
					sessionUserID = ownerID
				}
				db := &fakeDB{
					session:               dbgen.Session{Token: "token", UserID: sessionUserID},
					user:                  dbgen.User{ID: sessionUserID, Role: test.role},
					userErr:               test.userErr,
					board:                 board,
					boardMembersDeleteErr: test.deleteErr,
					boardMemberErr:        test.insertErr,
				}
				var beginTx func(context.Context) (backend.SetupTransaction, error)
				if test.transaction {
					beginTx = func(context.Context) (backend.SetupTransaction, error) {
						if test.beginErr != nil {
							return nil, test.beginErr
						}
						return &fakeTx{fakeDB: db, commitErr: test.commitErr}, nil
					}
				}
				response := send(newHandler(db, beginTx, false), http.MethodPut,
					"/api/boards/"+boardID+"/members", test.body, cookie)
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
				}
			})
		}
	})
}
