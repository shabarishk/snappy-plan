package migrations

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed *.up.sql
var files embed.FS

const historyTable = "snappy_plan_schema_migrations"

func Apply(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration connection: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", int64(731942617)); err != nil {
		return fmt.Errorf("lock schema migrations: %w", err)
	}
	defer conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", int64(731942617))

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS `+historyTable+` (
		version BIGINT PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)`); err != nil {
		return fmt.Errorf("create migration history: %w", err)
	}

	names, err := fs.Glob(files, "*.up.sql")
	if err != nil {
		return fmt.Errorf("list embedded migrations: %w", err)
	}
	sort.Strings(names)

	var hasExistingSchema bool
	if err := conn.QueryRow(ctx, `
		SELECT to_regclass('users') IS NOT NULL
		   AND to_regclass('boards') IS NOT NULL
		   AND to_regclass('columns') IS NOT NULL
		   AND to_regclass('tasks') IS NOT NULL
		   AND to_regclass('sessions') IS NOT NULL
	`).Scan(&hasExistingSchema); err != nil {
		return fmt.Errorf("inspect existing schema: %w", err)
	}
	var hasHistory bool
	if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM "+historyTable+")").Scan(&hasHistory); err != nil {
		return fmt.Errorf("inspect migration history: %w", err)
	}
	if hasExistingSchema && !hasHistory {
		tx, err := conn.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin existing schema baseline: %w", err)
		}
		for _, name := range names {
			version, err := migrationVersion(name)
			if err != nil {
				_ = tx.Rollback(context.Background())
				return err
			}
			if _, err := tx.Exec(ctx, "INSERT INTO "+historyTable+" (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING", version, name); err != nil {
				_ = tx.Rollback(context.Background())
				return fmt.Errorf("baseline existing schema at migration %s: %w", name, err)
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit existing schema baseline: %w", err)
		}
		return nil
	}

	for _, name := range names {
		version, err := migrationVersion(name)
		if err != nil {
			return err
		}
		var applied bool
		if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM "+historyTable+" WHERE version = $1)", version).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if applied {
			continue
		}

		sql, err := files.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", name, err)
		}
		script := strings.TrimSpace(string(sql))
		script = strings.TrimPrefix(script, "BEGIN;")
		script = strings.TrimSuffix(strings.TrimSpace(script), "COMMIT;")
		if _, err := tx.Exec(ctx, script, pgx.QueryExecModeSimpleProtocol); err != nil {
			_ = tx.Rollback(context.Background())
			return fmt.Errorf("execute migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO "+historyTable+" (version, name) VALUES ($1, $2)", version, name); err != nil {
			_ = tx.Rollback(context.Background())
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}
	return nil
}

func migrationVersion(name string) (int64, error) {
	base := path.Base(name)
	separator := strings.IndexByte(base, '_')
	if separator < 1 {
		return 0, fmt.Errorf("invalid migration filename %q", name)
	}
	version, err := strconv.ParseInt(base[:separator], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse migration version %q: %w", name, err)
	}
	return version, nil
}
