package backend

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type schemaTestTx struct {
	execCalls  []string
	execErr    error
	committed  bool
	rolledBack bool
	commitErr  error
}

func (tx *schemaTestTx) Exec(_ context.Context, query string, _ ...any) (pgconn.CommandTag, error) {
	tx.execCalls = append(tx.execCalls, query)
	if strings.Contains(query, "DO $$") && tx.execErr != nil {
		return pgconn.CommandTag{}, tx.execErr
	}
	return pgconn.CommandTag{}, nil
}

func (*schemaTestTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query")
}

func (*schemaTestTx) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

func (tx *schemaTestTx) Commit(context.Context) error {
	tx.committed = true
	return tx.commitErr
}

func (tx *schemaTestTx) Rollback(context.Context) error {
	if !tx.committed {
		tx.rolledBack = true
	}
	return nil
}

func TestEnsureTaskSchema(t *testing.T) {
	t.Run("applies upgrade in a transaction", func(t *testing.T) {
		tx := &schemaTestTx{}
		err := EnsureTaskSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if err != nil {
			t.Fatalf("EnsureTaskSchema returned error: %v", err)
		}

		if len(tx.execCalls) != 8 || !strings.Contains(tx.execCalls[0], "pg_advisory_xact_lock") ||
			!strings.Contains(tx.execCalls[1], "ADD COLUMN priority") ||
			!strings.Contains(tx.execCalls[3], "DROP COLUMN IF EXISTS position") ||
			!strings.Contains(tx.execCalls[4], "ADD COLUMN IF NOT EXISTS complete_by") ||
			!strings.Contains(tx.execCalls[5], "ADD COLUMN IF NOT EXISTS completed_at") ||
			!strings.Contains(tx.execCalls[6], "description DROP NOT NULL") {
			t.Fatalf("schema upgrade statements = %#v", tx.execCalls)
		}
		if !tx.committed || tx.rolledBack {
			t.Fatalf("transaction committed=%t rolledBack=%t", tx.committed, tx.rolledBack)
		}
	})

	t.Run("returns begin errors", func(t *testing.T) {
		beginErr := errors.New("begin failed")
		err := EnsureTaskSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return nil, beginErr
		})
		if !errors.Is(err, beginErr) {
			t.Fatalf("EnsureTaskSchema error = %v, want %v", err, beginErr)
		}
	})

	t.Run("returns schema errors without committing", func(t *testing.T) {
		schemaErr := errors.New("schema failed")
		tx := &schemaTestTx{execErr: schemaErr}
		err := EnsureTaskSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, schemaErr) {
			t.Fatalf("EnsureTaskSchema error = %v, want %v", err, schemaErr)
		}
		if tx.committed || !tx.rolledBack {
			t.Fatalf("transaction committed=%t rolledBack=%t", tx.committed, tx.rolledBack)
		}
	})
}

func TestEnsureUserIDSchema(t *testing.T) {
	t.Run("applies upgrade in a transaction", func(t *testing.T) {
		tx := &schemaTestTx{}
		err := EnsureUserIDSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if err != nil {
			t.Fatalf("EnsureUserIDSchema returned error: %v", err)
		}
		if len(tx.execCalls) != 2 || !strings.Contains(tx.execCalls[0], "pg_advisory_xact_lock") ||
			!strings.Contains(tx.execCalls[1], "ALTER TABLE users ALTER COLUMN id TYPE VARCHAR(32)") ||
			!strings.Contains(tx.execCalls[1], "REPLACE(owner_id::text, '-', '')") ||
			!strings.Contains(tx.execCalls[1], "users_id_alphanumeric") {
			t.Fatalf("schema upgrade statements = %#v", tx.execCalls)
		}
		if !tx.committed || tx.rolledBack {
			t.Fatalf("transaction committed=%t rolledBack=%t", tx.committed, tx.rolledBack)
		}
	})

	t.Run("returns begin errors", func(t *testing.T) {
		beginErr := errors.New("begin failed")
		err := EnsureUserIDSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return nil, beginErr
		})
		if !errors.Is(err, beginErr) {
			t.Fatalf("EnsureUserIDSchema error = %v, want %v", err, beginErr)
		}
	})

	t.Run("returns schema errors without committing", func(t *testing.T) {
		schemaErr := errors.New("schema failed")
		tx := &schemaTestTx{execErr: schemaErr}
		err := EnsureUserIDSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, schemaErr) {
			t.Fatalf("EnsureUserIDSchema error = %v, want %v", err, schemaErr)
		}
		if tx.committed || !tx.rolledBack {
			t.Fatalf("transaction committed=%t rolledBack=%t", tx.committed, tx.rolledBack)
		}
	})
}
