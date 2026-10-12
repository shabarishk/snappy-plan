package dbgen

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type queryDB struct {
	query    string
	args     []any
	row      pgx.Row
	rows     pgx.Rows
	queryErr error
}

func (db *queryDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unexpected Exec")
}

func (db *queryDB) Query(_ context.Context, query string, args ...any) (pgx.Rows, error) {
	db.query = query
	db.args = args
	if db.queryErr != nil {
		return nil, db.queryErr
	}
	return db.rows, nil
}

func (db *queryDB) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	db.query = query
	db.args = args
	return db.row
}

type resultRow struct {
	values []any
	err    error
}

func (row resultRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	return assignValues(dest, row.values)
}

type resultRows struct {
	values  [][]any
	index   int
	err     error
	scanErr error
	closed  bool
}

func (rows *resultRows) Close() {
	rows.closed = true
}

func (rows *resultRows) Err() error {
	return rows.err
}

func (*resultRows) CommandTag() pgconn.CommandTag {
	return pgconn.CommandTag{}
}

func (*resultRows) FieldDescriptions() []pgconn.FieldDescription {
	return nil
}

func (rows *resultRows) Next() bool {
	if rows.index >= len(rows.values) {
		return false
	}
	rows.index++
	return true
}

func (rows *resultRows) Scan(dest ...any) error {
	if rows.scanErr != nil {
		return rows.scanErr
	}
	if rows.index == 0 || rows.index > len(rows.values) {
		return errors.New("Scan called without a current row")
	}
	return assignValues(dest, rows.values[rows.index-1])
}

func (*resultRows) Values() ([]any, error) {
	return nil, errors.New("unexpected Values")
}

func (*resultRows) RawValues() [][]byte {
	return nil
}

func (*resultRows) Conn() *pgx.Conn {
	return nil
}

func (*resultRows) TypeMap() *pgtype.Map {
	return nil
}

func assignValues(dest []any, values []any) error {
	if len(dest) != len(values) {
		return errors.New("unexpected number of scan destinations")
	}
	for i, value := range values {
		target := reflect.ValueOf(dest[i])
		if target.Kind() != reflect.Ptr || target.IsNil() {
			return errors.New("scan destination must be a non-nil pointer")
		}
		source := reflect.ValueOf(value)
		if !source.IsValid() {
			return errors.New("scan value must be non-nil")
		}
		if !source.Type().AssignableTo(target.Elem().Type()) {
			return errors.New("scan value type does not match destination")
		}
		target.Elem().Set(source)
	}
	return nil
}

func taskRow(task Task) []any {
	return []any{
		task.ID,
		task.ColumnID,
		task.Title,
		task.Description,
		task.AssignedToID,
		task.CreatedAt,
		task.UpdatedAt,
		task.CompleteBy,
		task.CompletedAt,
		task.State,
		task.Priority,
	}
}

func testTask() Task {
	now := time.Date(2026, time.October, 12, 7, 0, 0, 0, time.UTC)
	return Task{
		ID:           pgtype.UUID{Bytes: [16]byte{1}, Valid: true},
		ColumnID:     pgtype.UUID{Bytes: [16]byte{2}, Valid: true},
		Title:        "Finish task",
		Description:  pgtype.Text{String: "Optional details", Valid: true},
		AssignedToID: pgtype.UUID{Bytes: [16]byte{4}, Valid: true},
		CreatedAt:    pgtype.Timestamptz{Time: now.Add(-time.Hour), Valid: true},
		UpdatedAt:    pgtype.Timestamptz{Time: now, Valid: true},
		State:        "InProgress",
		Priority:     "High",
		CompletedAt:  pgtype.Timestamptz{Time: now, Valid: true},
	}
}

func TestCreateTaskScansNullableTaskFields(t *testing.T) {
	want := testTask()
	want.Description = pgtype.Text{}
	want.CompletedAt = pgtype.Timestamptz{}
	columnID := want.ColumnID
	assignedToID := want.AssignedToID
	db := &queryDB{row: resultRow{values: taskRow(want)}}

	got, err := New(db).CreateTask(context.Background(), CreateTaskParams{
		ColumnID:     columnID,
		Title:        want.Title,
		Description:  pgtype.Text{},
		Priority:     want.Priority,
		AssignedToID: assignedToID,
	})
	if err != nil {
		t.Fatalf("CreateTask returned error: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("CreateTask task = %#v, want %#v", got, want)
	}
	if len(db.args) != 5 || db.args[0] != columnID || db.args[1] != want.Title ||
		db.args[2] != (pgtype.Text{}) || db.args[3] != want.Priority || db.args[4] != assignedToID {
		t.Fatalf("CreateTask args = %#v", db.args)
	}
}

func TestMoveTaskReturnsCompletionTimestamp(t *testing.T) {
	want := testTask()
	db := &queryDB{row: resultRow{values: taskRow(want)}}

	got, err := New(db).MoveTask(context.Background(), MoveTaskParams{
		ColumnID: want.ColumnID,
		ID:       want.ID,
	})
	if err != nil {
		t.Fatalf("MoveTask returned error: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("MoveTask task = %#v, want %#v", got, want)
	}
	if len(db.args) != 2 || db.args[0] != want.ColumnID || db.args[1] != want.ID {
		t.Fatalf("MoveTask args = %#v", db.args)
	}
	for _, fragment := range []string{"state = CASE", "'in-progress' THEN 'InProgress'", "completed_at = CASE", "COALESCE(task.completed_at, NOW())", "ELSE NULL"} {
		if !strings.Contains(db.query, fragment) {
			t.Errorf("MoveTask query does not contain %q", fragment)
		}
	}
}

func TestGetTasksByColumnScansCompletionTimestamps(t *testing.T) {
	incomplete := testTask()
	incomplete.CompletedAt = pgtype.Timestamptz{}
	rows := &resultRows{values: [][]any{taskRow(testTask()), taskRow(incomplete)}}
	columnID := incomplete.ColumnID
	db := &queryDB{rows: rows}

	got, err := New(db).GetTasksByColumn(context.Background(), columnID)
	if err != nil {
		t.Fatalf("GetTasksByColumn returned error: %v", err)
	}
	if len(got) != 2 || !reflect.DeepEqual(got[0], testTask()) || !reflect.DeepEqual(got[1], incomplete) {
		t.Fatalf("GetTasksByColumn tasks = %#v", got)
	}
	if len(db.args) != 1 || db.args[0] != columnID {
		t.Fatalf("GetTasksByColumn args = %#v", db.args)
	}
	if !strings.Contains(db.query, "ORDER BY CASE priority") ||
		!strings.Contains(db.query, "WHEN 'High' THEN 0") ||
		!strings.Contains(db.query, "WHEN 'Medium' THEN 1") {
		t.Fatalf("GetTasksByColumn query does not order tasks by priority: %s", db.query)
	}
	if !rows.closed {
		t.Fatal("GetTasksByColumn did not close rows")
	}
}

func TestGetTasksByColumnReturnsQueryAndScanErrors(t *testing.T) {
	queryErr := errors.New("query failed")
	if _, err := New(&queryDB{queryErr: queryErr}).GetTasksByColumn(context.Background(), pgtype.UUID{}); !errors.Is(err, queryErr) {
		t.Fatalf("GetTasksByColumn query error = %v, want %v", err, queryErr)
	}

	scanErr := errors.New("scan failed")
	rows := &resultRows{values: [][]any{taskRow(testTask())}, scanErr: scanErr}
	if _, err := New(&queryDB{rows: rows}).GetTasksByColumn(context.Background(), pgtype.UUID{}); !errors.Is(err, scanErr) {
		t.Fatalf("GetTasksByColumn scan error = %v, want %v", err, scanErr)
	}
	if !rows.closed {
		t.Fatal("GetTasksByColumn did not close rows after scan error")
	}

	rowsErr := errors.New("rows failed")
	rows = &resultRows{err: rowsErr}
	if _, err := New(&queryDB{rows: rows}).GetTasksByColumn(context.Background(), pgtype.UUID{}); !errors.Is(err, rowsErr) {
		t.Fatalf("GetTasksByColumn rows error = %v, want %v", err, rowsErr)
	}
}
