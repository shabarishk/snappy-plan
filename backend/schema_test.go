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
	execCalls        []string
	execErr          error
	failExecContains string
	committed        bool
	rolledBack       bool
	commitErr        error
}

func (tx *schemaTestTx) Exec(_ context.Context, query string, _ ...any) (pgconn.CommandTag, error) {
	tx.execCalls = append(tx.execCalls, query)
	isUpgradeStatement := strings.Contains(query, "DO $$") || strings.Contains(query, "INSERT INTO boards") ||
		strings.Contains(query, "board_members") || strings.Contains(query, "CREATE TABLE IF NOT EXISTS initiatives") ||
		strings.Contains(query, "CREATE TABLE IF NOT EXISTS task_comments") ||
		strings.Contains(query, "ADD COLUMN IF NOT EXISTS profile_picture") ||
		strings.Contains(query, "ADD COLUMN IF NOT EXISTS preferred_name") ||
		strings.Contains(query, "is_personal")
	if tx.execErr != nil && ((tx.failExecContains != "" && strings.Contains(query, tx.failExecContains)) ||
		(tx.failExecContains == "" && isUpgradeStatement)) {
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

func TestEnsureInitiativeSchema(t *testing.T) {
	t.Run("creates initiative tables and indexes in a transaction", func(t *testing.T) {
		tx := &schemaTestTx{}
		err := EnsureInitiativeSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if err != nil {
			t.Fatalf("EnsureInitiativeSchema returned error: %v", err)
		}
		if len(tx.execCalls) != 6 || !strings.Contains(tx.execCalls[0], "pg_advisory_xact_lock") ||
			!strings.Contains(tx.execCalls[1], "CREATE TABLE IF NOT EXISTS initiatives") ||
			!strings.Contains(tx.execCalls[2], "CREATE TABLE IF NOT EXISTS initiative_tasks") ||
			!strings.Contains(tx.execCalls[3], "idx_initiatives_assigned_to") ||
			!strings.Contains(tx.execCalls[5], "idx_initiative_tasks_task") ||
			!tx.committed || tx.rolledBack {
			t.Fatalf("initiative schema calls=%#v committed=%t rolledBack=%t",
				tx.execCalls, tx.committed, tx.rolledBack)
		}
	})

	t.Run("returns begin errors", func(t *testing.T) {
		beginErr := errors.New("begin failed")
		err := EnsureInitiativeSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return nil, beginErr
		})
		if !errors.Is(err, beginErr) {
			t.Fatalf("EnsureInitiativeSchema error = %v, want %v", err, beginErr)
		}
	})

	t.Run("rolls back on schema errors", func(t *testing.T) {
		schemaErr := errors.New("schema failed")
		tx := &schemaTestTx{execErr: schemaErr}
		err := EnsureInitiativeSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, schemaErr) || tx.committed || !tx.rolledBack {
			t.Fatalf("error=%v committed=%t rolledBack=%t", err, tx.committed, tx.rolledBack)
		}
	})
}

func TestEnsureTaskCommentSchema(t *testing.T) {
	t.Run("reports begin errors", func(t *testing.T) {
		beginErr := errors.New("begin failed")
		err := EnsureTaskCommentSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return nil, beginErr
		})
		if !errors.Is(err, beginErr) {
			t.Fatalf("EnsureTaskCommentSchema error = %v", err)
		}
	})

	t.Run("creates the task comments table and index in a transaction", func(t *testing.T) {
		tx := &schemaTestTx{}
		err := EnsureTaskCommentSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if err != nil {
			t.Fatalf("EnsureTaskCommentSchema returned error: %v", err)
		}
		if len(tx.execCalls) != 3 || !strings.Contains(tx.execCalls[0], "pg_advisory_xact_lock") ||
			!strings.Contains(tx.execCalls[1], "CREATE TABLE IF NOT EXISTS task_comments") ||
			!strings.Contains(tx.execCalls[2], "idx_task_comments_task_created") ||
			!tx.committed || tx.rolledBack {
			t.Fatalf("task comment schema calls=%#v committed=%t rolledBack=%t",
				tx.execCalls, tx.committed, tx.rolledBack)
		}
	})

	t.Run("rolls back when the advisory lock fails", func(t *testing.T) {
		lockErr := errors.New("lock failed")
		tx := &schemaTestTx{execErr: lockErr, failExecContains: "pg_advisory_xact_lock"}
		err := EnsureTaskCommentSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, lockErr) || tx.committed || !tx.rolledBack {
			t.Fatalf("error=%v committed=%t rolledBack=%t", err, tx.committed, tx.rolledBack)
		}
	})

	t.Run("rolls back when schema creation fails", func(t *testing.T) {
		schemaErr := errors.New("schema failed")
		tx := &schemaTestTx{execErr: schemaErr}
		err := EnsureTaskCommentSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, schemaErr) || tx.committed || !tx.rolledBack {
			t.Fatalf("error=%v committed=%t rolledBack=%t", err, tx.committed, tx.rolledBack)
		}
	})

	t.Run("reports commit errors", func(t *testing.T) {
		commitErr := errors.New("commit failed")
		tx := &schemaTestTx{commitErr: commitErr}
		err := EnsureTaskCommentSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, commitErr) {
			t.Fatalf("EnsureTaskCommentSchema error = %v", err)
		}
	})
}

func TestEnsureProfilePictureSchema(t *testing.T) {
	t.Run("reports begin errors", func(t *testing.T) {
		beginErr := errors.New("begin failed")
		err := EnsureProfilePictureSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return nil, beginErr
		})
		if !errors.Is(err, beginErr) {
			t.Fatalf("EnsureProfilePictureSchema error = %v", err)
		}
	})

	t.Run("applies upgrade in a transaction", func(t *testing.T) {
		tx := &schemaTestTx{}
		err := EnsureProfilePictureSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if err != nil {
			t.Fatalf("EnsureProfilePictureSchema returned error: %v", err)
		}
		if len(tx.execCalls) != 2 || !strings.Contains(tx.execCalls[0], "pg_advisory_xact_lock") ||
			!strings.Contains(tx.execCalls[1], "ADD COLUMN IF NOT EXISTS profile_picture TEXT") ||
			!tx.committed || tx.rolledBack {
			t.Fatalf("profile picture schema calls=%#v committed=%t rolledBack=%t",
				tx.execCalls, tx.committed, tx.rolledBack)
		}
	})

	t.Run("reports schema errors without committing", func(t *testing.T) {
		schemaErr := errors.New("schema failed")
		tx := &schemaTestTx{execErr: schemaErr}
		err := EnsureProfilePictureSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, schemaErr) || tx.committed || !tx.rolledBack {
			t.Fatalf("error=%v committed=%t rolledBack=%t", err, tx.committed, tx.rolledBack)
		}
	})

	t.Run("reports lock errors without committing", func(t *testing.T) {
		lockErr := errors.New("lock failed")
		tx := &schemaTestTx{execErr: lockErr, failExecContains: "pg_advisory_xact_lock"}
		err := EnsureProfilePictureSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, lockErr) || tx.committed || !tx.rolledBack {
			t.Fatalf("error=%v committed=%t rolledBack=%t", err, tx.committed, tx.rolledBack)
		}
	})

	t.Run("reports commit errors", func(t *testing.T) {
		commitErr := errors.New("commit failed")
		tx := &schemaTestTx{commitErr: commitErr}
		err := EnsureProfilePictureSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, commitErr) {
			t.Fatalf("EnsureProfilePictureSchema error = %v", err)
		}
	})
}

func TestEnsurePreferredNameSchema(t *testing.T) {
	t.Run("reports begin errors", func(t *testing.T) {
		beginErr := errors.New("begin failed")
		err := EnsurePreferredNameSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return nil, beginErr
		})
		if !errors.Is(err, beginErr) {
			t.Fatalf("EnsurePreferredNameSchema error = %v", err)
		}
	})

	t.Run("adds the preferred name column in a transaction", func(t *testing.T) {
		tx := &schemaTestTx{}
		err := EnsurePreferredNameSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if err != nil {
			t.Fatalf("EnsurePreferredNameSchema returned error: %v", err)
		}
		if len(tx.execCalls) != 2 || !strings.Contains(tx.execCalls[0], "pg_advisory_xact_lock") ||
			!strings.Contains(tx.execCalls[1], "ADD COLUMN IF NOT EXISTS preferred_name VARCHAR(100)") ||
			!tx.committed || tx.rolledBack {
			t.Fatalf("preferred name schema calls=%#v committed=%t rolledBack=%t",
				tx.execCalls, tx.committed, tx.rolledBack)
		}
	})

	t.Run("rolls back on upgrade errors", func(t *testing.T) {
		schemaErr := errors.New("preferred name schema failed")
		tx := &schemaTestTx{execErr: schemaErr}
		err := EnsurePreferredNameSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, schemaErr) || tx.committed || !tx.rolledBack {
			t.Fatalf("error=%v committed=%t rolledBack=%t", err, tx.committed, tx.rolledBack)
		}
	})

	t.Run("reports lock errors without committing", func(t *testing.T) {
		lockErr := errors.New("lock failed")
		tx := &schemaTestTx{execErr: lockErr, failExecContains: "pg_advisory_xact_lock"}
		err := EnsurePreferredNameSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, lockErr) || tx.committed || !tx.rolledBack {
			t.Fatalf("error=%v committed=%t rolledBack=%t", err, tx.committed, tx.rolledBack)
		}
	})

	t.Run("reports commit errors", func(t *testing.T) {
		commitErr := errors.New("commit failed")
		tx := &schemaTestTx{commitErr: commitErr}
		err := EnsurePreferredNameSchema(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if !errors.Is(err, commitErr) {
			t.Fatalf("EnsurePreferredNameSchema error = %v", err)
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

func TestEnsurePersonalBoards(t *testing.T) {
	t.Run("creates missing boards in a transaction", func(t *testing.T) {
		tx := &schemaTestTx{}
		err := EnsurePersonalBoards(context.Background(), func(context.Context) (SetupTransaction, error) {
			return tx, nil
		})
		if err != nil {
			t.Fatalf("EnsurePersonalBoards returned error: %v", err)
		}
		if len(tx.execCalls) != 10 || !strings.Contains(tx.execCalls[0], "pg_advisory_xact_lock") ||
			!strings.Contains(tx.execCalls[1], "ADD COLUMN IF NOT EXISTS is_personal") ||
			!strings.Contains(tx.execCalls[2], "VARCHAR(120)") ||
			!strings.Contains(tx.execCalls[3], "ROW_NUMBER() OVER") ||
			!strings.Contains(tx.execCalls[4], "idx_boards_one_personal_per_owner") ||
			!strings.Contains(tx.execCalls[5], "UPDATE boards AS board") ||
			!strings.Contains(tx.execCalls[6], "INSERT INTO boards") ||
			!strings.Contains(tx.execCalls[7], "CREATE TABLE IF NOT EXISTS board_members") ||
			!strings.Contains(tx.execCalls[9], "INSERT INTO board_members") ||
			!tx.committed || tx.rolledBack {
			t.Fatalf("personal board upgrade calls=%#v committed=%t rolledBack=%t",
				tx.execCalls, tx.committed, tx.rolledBack)
		}
	})

	t.Run("reports startup and commit failures", func(t *testing.T) {
		beginErr := errors.New("begin failed")
		if err := EnsurePersonalBoards(context.Background(), func(context.Context) (SetupTransaction, error) {
			return nil, beginErr
		}); !errors.Is(err, beginErr) {
			t.Fatalf("begin error = %v, want %v", err, beginErr)
		}

		lockErr := errors.New("lock failed")
		lockTx := &schemaTestTx{execErr: lockErr, failExecContains: "pg_advisory_xact_lock"}
		err := EnsurePersonalBoards(context.Background(), func(context.Context) (SetupTransaction, error) {
			return lockTx, nil
		})
		if !errors.Is(err, lockErr) || lockTx.committed || !lockTx.rolledBack {
			t.Fatalf("lock error=%v committed=%t rolledBack=%t", err, lockTx.committed, lockTx.rolledBack)
		}

		commitErr := errors.New("commit failed")
		commitTx := &schemaTestTx{commitErr: commitErr}
		err = EnsurePersonalBoards(context.Background(), func(context.Context) (SetupTransaction, error) {
			return commitTx, nil
		})
		if !errors.Is(err, commitErr) || !commitTx.committed || commitTx.rolledBack {
			t.Fatalf("commit error=%v committed=%t rolledBack=%t", err, commitTx.committed, commitTx.rolledBack)
		}
	})

	for _, test := range []struct {
		name      string
		statement string
	}{
		{name: "add personal board marker", statement: "ADD COLUMN IF NOT EXISTS is_personal"},
		{name: "expand title limit", statement: "VARCHAR(120)"},
		{name: "mark existing boards", statement: "ROW_NUMBER() OVER"},
		{name: "index personal boards", statement: "idx_boards_one_personal_per_owner"},
		{name: "rename existing boards", statement: "UPDATE boards AS board"},
		{name: "create missing boards", statement: "INSERT INTO boards"},
		{name: "create membership table", statement: "CREATE TABLE IF NOT EXISTS board_members"},
		{name: "index membership table", statement: "idx_board_members_user"},
		{name: "grant owner access", statement: "INSERT INTO board_members"},
	} {
		t.Run("reports "+test.name+" errors", func(t *testing.T) {
			migrationErr := errors.New("migration failed")
			tx := &schemaTestTx{execErr: migrationErr, failExecContains: test.statement}
			err := EnsurePersonalBoards(context.Background(), func(context.Context) (SetupTransaction, error) {
				return tx, nil
			})
			if !errors.Is(err, migrationErr) || tx.committed || !tx.rolledBack {
				t.Fatalf("error=%v committed=%t rolledBack=%t", err, tx.committed, tx.rolledBack)
			}
		})
	}
}
