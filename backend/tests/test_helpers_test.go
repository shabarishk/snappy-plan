package backend_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing/fstest"
	"time"

	"snappy-plan/backend"
	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

type fakeDB struct {
	count                  int64
	countErr               error
	user                   dbgen.User
	userErr                error
	session                dbgen.Session
	sessionErr             error
	board                  dbgen.Board
	destinationBoard       dbgen.Board
	boards                 []dbgen.Board
	boardErr               error
	destinationBoardErr    error
	column                 dbgen.Column
	columnErr              error
	task                   dbgen.Task
	createTaskErr          error
	createColumnErr        error
	moveTaskErr            error
	updateTaskErr          error
	updateProfileErr       error
	updatePasswordErr      error
	tasksErr               error
	assigneesErr           error
	assignees              []dbgen.GetUsersForAssignmentRow
	adminUsers             []dbgen.GetUsersForAdminRow
	adminBoards            []dbgen.GetAllBoardsForAdminRow
	adminBoardsErr         error
	tasks                  []dbgen.Task
	boardArgs              []any
	columnArgs             []any
	taskArgs               []any
	moveTaskArgs           []any
	updateTaskArgs         []any
	updateProfileArgs      []any
	updateUserRoleErr      error
	updateUserRoleArgs     []any
	updatePasswordArgs     []any
	deleteSessionArgs      []any
	sessionArgs            []any
	createUserArgs         []any
	createBoardErr         error
	boardMemberArgs        [][]any
	boardMemberErr         error
	boardMembers           []string
	boardMembersErr        error
	boardMembersDeleteArgs []any
	boardMembersDeleteErr  error
	deleteBoardArgs        []any
	deleteBoardQuery       string
	deleteBoardRows        int64
	deleteBoardErr         error
	createSessionError     error
	createUserError        error
	deleteSessionErr       error
}

type failingResponseWriter struct {
	header http.Header
	status int
	err    error
}

func (writer *failingResponseWriter) Header() http.Header {
	if writer.header == nil {
		writer.header = make(http.Header)
	}
	return writer.header
}

func (writer *failingResponseWriter) WriteHeader(status int) {
	writer.status = status
}

func (writer *failingResponseWriter) Write([]byte) (int, error) {
	return 0, writer.err
}

func (db *fakeDB) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if strings.Contains(query, "DELETE FROM boards") {
		db.deleteBoardArgs = args
		db.deleteBoardQuery = query
		if db.deleteBoardErr != nil {
			return pgconn.CommandTag{}, db.deleteBoardErr
		}
		canDelete := db.board.OwnerID == args[1].(string) ||
			(strings.Contains(query, "role = 'admin'") && db.user.Role == "admin")
		if canDelete && db.deleteBoardRows > 0 {
			return pgconn.NewCommandTag("DELETE 1"), nil
		}
		return pgconn.NewCommandTag("DELETE 0"), nil
	}
	if strings.Contains(query, "INSERT INTO board_members") {
		db.boardMemberArgs = append(db.boardMemberArgs, args)
		return pgconn.CommandTag{}, db.boardMemberErr
	}
	if strings.Contains(query, "DELETE FROM board_members AS member") {
		db.boardMembersDeleteArgs = args
		return pgconn.CommandTag{}, db.boardMembersDeleteErr
	}
	if strings.Contains(query, "DELETE FROM sessions") {
		db.deleteSessionArgs = args
		return pgconn.CommandTag{}, db.deleteSessionErr
	}
	if strings.Contains(query, "UPDATE users") && strings.Contains(query, "password_hash") {
		db.updatePasswordArgs = args
		if db.updatePasswordErr != nil {
			return pgconn.CommandTag{}, db.updatePasswordErr
		}
		db.user.ID = args[0].(string)
		db.user.PasswordHash = args[1].(string)
	}
	return pgconn.CommandTag{}, nil
}

func (db *fakeDB) Query(_ context.Context, query string, _ ...any) (pgx.Rows, error) {
	switch {
	case strings.Contains(query, "FROM tasks AS task"):
		if db.tasksErr != nil {
			return nil, db.tasksErr
		}
		rows := make([][]any, len(db.tasks))
		for i, task := range db.tasks {
			rows[i] = taskValues(task)
		}
		return &fakeRows{values: rows}, nil
	case strings.Contains(query, "FROM boards") && strings.Contains(query, "WHERE owner_id"):
		rows := make([][]any, len(db.boards))
		for i, board := range db.boards {
			rows[i] = []any{board.ID, board.Title, board.OwnerID, board.CreatedAt, board.UpdatedAt}
		}
		return &fakeRows{values: rows}, nil
	case strings.Contains(query, "FROM boards AS board"):
		if db.adminBoardsErr != nil {
			return nil, db.adminBoardsErr
		}
		rows := make([][]any, len(db.adminBoards))
		for i, board := range db.adminBoards {
			rows[i] = []any{board.ID, board.Title, board.OwnerID, board.FullName}
		}
		return &fakeRows{values: rows}, nil
	case strings.Contains(query, "FROM board_members"):
		if db.boardMembersErr != nil {
			return nil, db.boardMembersErr
		}
		rows := make([][]any, len(db.boardMembers))
		for i, userID := range db.boardMembers {
			rows[i] = []any{userID}
		}
		return &fakeRows{values: rows}, nil
	case strings.Contains(query, "SELECT id, full_name, email, role"):
		rows := make([][]any, len(db.adminUsers))
		for i, user := range db.adminUsers {
			rows[i] = []any{user.ID, user.FullName, user.Email, user.Role}
		}
		return &fakeRows{values: rows}, nil
	case strings.Contains(query, "SELECT id, full_name"):
		if db.assigneesErr != nil {
			return nil, db.assigneesErr
		}
		rows := make([][]any, len(db.assignees))
		for i, user := range db.assignees {
			rows[i] = []any{user.ID, user.FullName}
		}
		return &fakeRows{values: rows}, nil
	default:
		return nil, errors.New("unexpected query: " + query)
	}
}

func (db *fakeDB) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	switch {
	case strings.Contains(query, "UPDATE tasks AS task") && strings.Contains(query, "state = CASE"):
		db.moveTaskArgs = args
		if db.moveTaskErr != nil {
			return fakeRow{err: db.moveTaskErr}
		}
		db.task.ColumnID = args[0].(pgtype.UUID)
		db.task.State = map[string]string{
			"Backlog":     "Backlog",
			"To Do":       "ToDo",
			"In Progress": "InProgress",
			"Complete":    "Complete",
		}[db.column.Title]
		if db.task.State == "Complete" {
			db.task.CompletedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
		} else {
			db.task.CompletedAt = pgtype.Timestamptz{}
		}
		return fakeRow{values: taskValues(db.task)}
	case strings.Contains(query, "UPDATE tasks AS task"):
		db.updateTaskArgs = args
		if db.updateTaskErr != nil {
			return fakeRow{err: db.updateTaskErr}
		}
		db.task.ColumnID = args[0].(pgtype.UUID)
		db.task.State = args[1].(string)
		db.task.Title = args[2].(string)
		db.task.Description = args[3].(pgtype.Text)
		db.task.Priority = args[4].(string)
		db.task.CompleteBy = args[5].(pgtype.Timestamptz)
		return fakeRow{values: taskValues(db.task)}
	case strings.Contains(query, "SET role ="):
		db.updateUserRoleArgs = args
		if db.updateUserRoleErr != nil {
			return fakeRow{err: db.updateUserRoleErr}
		}
		db.user.ID = args[0].(string)
		db.user.Role = args[1].(string)
		return fakeRow{values: userValues(db.user)}
	case strings.Contains(query, "UPDATE users"):
		db.updateProfileArgs = args
		if db.updateProfileErr != nil {
			return fakeRow{err: db.updateProfileErr}
		}
		db.user.ID = args[0].(string)
		db.user.Email = args[1].(string)
		db.user.FullName = args[2].(string)
		return fakeRow{values: userValues(db.user)}
	case strings.Contains(query, "SELECT COUNT(*) FROM users"):
		return fakeRow{values: []any{db.count}, err: db.countErr}
	case strings.Contains(query, "FROM users") && strings.Contains(query, "WHERE email"):
		return fakeRow{values: userValues(db.user), err: db.userErr}
	case strings.Contains(query, "FROM users") && strings.Contains(query, "WHERE id"):
		return fakeRow{values: userValues(db.user), err: db.userErr}
	case strings.Contains(query, "FROM tasks AS task") && strings.Contains(query, "WHERE task.id"):
		return fakeRow{values: []any{
			db.board.ID, db.board.Title, db.board.OwnerID, db.board.CreatedAt, db.board.UpdatedAt,
		}, err: db.boardErr}
	case strings.Contains(query, "FROM boards") && strings.Contains(query, "WHERE id") &&
		strings.Contains(query, "owner_id"):
		board := db.board
		err := db.boardErr
		if len(args) > 0 {
			if boardID, ok := args[0].(pgtype.UUID); ok && db.destinationBoard.ID.Valid && boardID == db.destinationBoard.ID {
				board = db.destinationBoard
				err = db.destinationBoardErr
			}
		}
		return fakeRow{values: []any{
			board.ID, board.Title, board.OwnerID, board.CreatedAt, board.UpdatedAt,
		}, err: err}
	case strings.Contains(query, "FROM boards") && strings.Contains(query, "WHERE owner_id"):
		return fakeRow{values: []any{
			db.board.ID, db.board.Title, db.board.OwnerID, db.board.CreatedAt, db.board.UpdatedAt,
		}, err: db.boardErr}
	case strings.Contains(query, "FROM columns") && strings.Contains(query, "WHERE board_id"):
		return fakeRow{values: []any{
			db.column.ID, db.column.BoardID, db.column.Title, db.column.Position, db.column.CreatedAt,
		}, err: db.columnErr}
	case strings.Contains(query, "FROM sessions"):
		return fakeRow{values: []any{db.session.Token, db.session.UserID, db.session.ExpiresAt}, err: db.sessionErr}
	case strings.Contains(query, "INSERT INTO sessions"):
		db.sessionArgs = args
		if db.createSessionError != nil {
			return fakeRow{err: db.createSessionError}
		}
		return fakeRow{values: []any{args[0], args[1], args[2]}}
	case strings.Contains(query, "INSERT INTO boards"):
		db.boardArgs = args
		if db.createBoardErr != nil {
			return fakeRow{err: db.createBoardErr}
		}
		return fakeRow{values: []any{
			db.board.ID, db.board.Title, db.board.OwnerID, db.board.CreatedAt, db.board.UpdatedAt,
		}}
	case strings.Contains(query, "INSERT INTO columns"):
		db.columnArgs = args
		if db.createColumnErr != nil {
			return fakeRow{err: db.createColumnErr}
		}
		return fakeRow{values: []any{
			db.column.ID, args[0], args[1], args[2], db.column.CreatedAt,
		}}
	case strings.Contains(query, "INSERT INTO tasks"):
		db.taskArgs = args
		if db.createTaskErr != nil {
			return fakeRow{err: db.createTaskErr}
		}
		db.task.ID = newUUID(9)
		db.task.ColumnID = args[0].(pgtype.UUID)
		db.task.State = args[1].(string)
		db.task.Title = args[2].(string)
		db.task.Description = args[3].(pgtype.Text)
		db.task.Priority = args[4].(string)
		db.task.AssignedToID = args[5].(pgtype.Text)
		db.task.CompleteBy = args[6].(pgtype.Timestamptz)
		return fakeRow{values: taskValues(db.task)}
	case strings.Contains(query, "INSERT INTO users"):
		db.createUserArgs = args
		if db.createUserError != nil {
			return fakeRow{err: db.createUserError}
		}
		return fakeRow{values: []any{
			args[0], args[1], args[2], args[3], args[4],
			db.user.CreatedAt, db.user.UpdatedAt,
		}}
	default:
		return fakeRow{err: errors.New("unexpected query: " + query)}
	}
}

func userValues(user dbgen.User) []any {
	return []any{
		user.ID, user.Email, user.PasswordHash, user.FullName,
		user.Role, user.CreatedAt, user.UpdatedAt,
	}
}

type fakeRow struct {
	values []any
	err    error
}

func (row fakeRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) != len(row.values) {
		return errors.New("unexpected number of scan destinations")
	}
	for i, value := range row.values {
		switch target := dest[i].(type) {
		case *int64:
			*target = value.(int64)
		case *string:
			*target = value.(string)
		case *int32:
			*target = value.(int32)
		case *pgtype.UUID:
			*target = value.(pgtype.UUID)
		case *pgtype.Text:
			*target = value.(pgtype.Text)
		case *pgtype.Timestamptz:
			*target = value.(pgtype.Timestamptz)
		default:
			return errors.New("unexpected scan destination")
		}
	}
	return nil
}

func taskValues(task dbgen.Task) []any {
	return []any{
		task.ID, task.ColumnID, task.Title, task.Description, task.AssignedToID,
		task.CreatedAt, task.UpdatedAt, task.CompleteBy, task.CompletedAt, task.State, task.Priority,
	}
}

type fakeRows struct {
	values [][]any
	index  int
}

func (rows *fakeRows) Close() {}

func (rows *fakeRows) Err() error { return nil }

func (*fakeRows) CommandTag() pgconn.CommandTag { return pgconn.CommandTag{} }

func (*fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }

func (rows *fakeRows) Next() bool {
	if rows.index >= len(rows.values) {
		return false
	}
	rows.index++
	return true
}

func (rows *fakeRows) Scan(dest ...any) error {
	if rows.index == 0 || rows.index > len(rows.values) {
		return errors.New("Scan called without a current row")
	}
	return (fakeRow{values: rows.values[rows.index-1]}).Scan(dest...)
}

func (*fakeRows) Values() ([]any, error) { return nil, errors.New("unexpected Values") }

func (*fakeRows) RawValues() [][]byte { return nil }

func (*fakeRows) Conn() *pgx.Conn { return nil }

func (*fakeRows) TypeMap() *pgtype.Map { return nil }

type fakeTx struct {
	*fakeDB
	committed  bool
	rolledBack bool
	execErr    error
	commitErr  error
}

func (tx *fakeTx) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if strings.Contains(query, "pg_advisory_xact_lock") {
		return pgconn.CommandTag{}, tx.execErr
	}
	if strings.Contains(query, "INSERT INTO board_members") {
		return tx.fakeDB.Exec(ctx, query, args...)
	}
	if strings.Contains(query, "DELETE FROM board_members AS member") {
		return tx.fakeDB.Exec(ctx, query, args...)
	}
	return pgconn.CommandTag{}, tx.execErr
}

func (tx *fakeTx) Commit(context.Context) error {
	tx.committed = true
	return tx.commitErr
}

func (tx *fakeTx) Rollback(context.Context) error {
	tx.rolledBack = true
	return nil
}

func newUUID(value byte) pgtype.UUID {
	return pgtype.UUID{Bytes: [16]byte{value}, Valid: true}
}

func newUser(password string) dbgen.User {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		panic(err)
	}
	now := time.Now()
	return dbgen.User{
		ID:           "admin1",
		Email:        "admin@example.com",
		PasswordHash: string(hash),
		FullName:     "Admin User",
		Role:         "admin",
		CreatedAt:    pgtype.Timestamptz{Time: now, Valid: true},
		UpdatedAt:    pgtype.Timestamptz{Time: now, Valid: true},
	}
}

func newHandler(db *fakeDB, beginTx func(context.Context) (backend.SetupTransaction, error), secureCookie bool) http.Handler {
	return backend.NewHandler(db, beginTx, secureCookie, fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<main>Snappy Plan</main>")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('app')")},
	})
}

func send(handler http.Handler, method, target, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

type adminUserResponseTest struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}
