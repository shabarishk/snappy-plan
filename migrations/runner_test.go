package migrations

import (
	"context"
	"errors"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEmbeddedMigrationSequence(t *testing.T) {
	names, err := files.ReadDir(".")
	if err != nil {
		t.Fatalf("read embedded migration directory: %v", err)
	}
	var versions []int64
	for _, entry := range names {
		if !strings.HasSuffix(entry.Name(), ".up.sql") {
			continue
		}
		version, err := migrationVersion(entry.Name())
		if err != nil {
			t.Fatalf("migrationVersion(%q): %v", entry.Name(), err)
		}
		versions = append(versions, version)
	}
	if len(versions) != 11 {
		t.Fatalf("migration count = %d, want 11", len(versions))
	}
	for i, version := range versions {
		if version != int64(i+1) {
			t.Errorf("migration %d has version %d", i, version)
		}
	}
}

func TestInitialSessionsUseUsernameIdentifierType(t *testing.T) {
	schema, err := files.ReadFile("000001_init_schema.up.sql")
	if err != nil {
		t.Fatalf("read initial schema: %v", err)
	}
	if !strings.Contains(string(schema), "user_id VARCHAR(32) NOT NULL REFERENCES users(id)") {
		t.Fatal("initial sessions user_id must match the users table's VARCHAR(32) identifier")
	}
}

type migrationTestRow struct {
	value bool
	err   error
}

func (row migrationTestRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	value, ok := dest[0].(*bool)
	if !ok {
		return errors.New("expected bool destination")
	}
	*value = row.value
	return nil
}

type migrationTestTx struct {
	pgx.Tx
	connection  *migrationTestConnection
	execErr     error
	recordErr   error
	commitErr   error
	rollbackErr error
	pending     []int64
}

func (tx *migrationTestTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if strings.HasPrefix(query, "INSERT INTO "+historyTable) && tx.recordErr != nil {
		return pgconn.CommandTag{}, tx.recordErr
	}
	if query != "" && !strings.HasPrefix(query, "INSERT INTO "+historyTable) && tx.execErr != nil {
		return pgconn.CommandTag{}, tx.execErr
	}
	if strings.HasPrefix(query, "INSERT INTO "+historyTable) {
		if version, ok := args[0].(int64); ok {
			tx.pending = append(tx.pending, version)
		}
	} else {
		tx.connection.scripts = append(tx.connection.scripts, query)
		tx.connection.txArgs = append(tx.connection.txArgs, args)
	}
	return pgconn.NewCommandTag("EXECUTE"), nil
}

func (tx *migrationTestTx) Commit(context.Context) error {
	if tx.commitErr != nil {
		return tx.commitErr
	}
	for _, version := range tx.pending {
		tx.connection.applied[version] = true
	}
	return nil
}

func (tx *migrationTestTx) Rollback(context.Context) error {
	tx.connection.rollbackCount++
	return tx.rollbackErr
}

type migrationTestConnection struct {
	pgx.Tx
	hasSchema         bool
	hasHistory        bool
	applied           map[int64]bool
	lockErr           error
	createTableErr    error
	inspectSchemaErr  error
	inspectHistoryErr error
	checkErr          error
	beginErr          error
	execErr           error
	recordErr         error
	commitErr         error
	txExecErr         error
	rollbackCount     int
	beginCount        int
	scripts           []string
	txArgs            [][]any
	lastTx            *migrationTestTx
}

func (conn *migrationTestConnection) Exec(_ context.Context, query string, _ ...any) (pgconn.CommandTag, error) {
	switch {
	case strings.Contains(query, "pg_advisory_lock") && conn.lockErr != nil:
		return pgconn.CommandTag{}, conn.lockErr
	case strings.Contains(query, "CREATE TABLE IF NOT EXISTS "+historyTable) && conn.createTableErr != nil:
		return pgconn.CommandTag{}, conn.createTableErr
	}
	return pgconn.NewCommandTag("EXECUTE"), nil
}

func (conn *migrationTestConnection) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	switch {
	case strings.Contains(query, "to_regclass") && conn.inspectSchemaErr != nil:
		return migrationTestRow{err: conn.inspectSchemaErr}
	case strings.Contains(query, "to_regclass"):
		return migrationTestRow{value: conn.hasSchema}
	case strings.Contains(query, "SELECT EXISTS") && strings.Contains(query, "WHERE version") && conn.checkErr != nil:
		return migrationTestRow{err: conn.checkErr}
	case strings.Contains(query, "SELECT EXISTS") && strings.Contains(query, "WHERE version"):
		version := int64(0)
		if len(args) > 0 {
			version, _ = args[0].(int64)
		}
		return migrationTestRow{value: conn.applied[version]}
	case strings.Contains(query, "SELECT EXISTS") && conn.inspectHistoryErr != nil:
		return migrationTestRow{err: conn.inspectHistoryErr}
	case strings.Contains(query, "SELECT EXISTS"):
		return migrationTestRow{value: conn.hasHistory}
	}
	return migrationTestRow{err: errors.New("unexpected migration query")}
}

func (conn *migrationTestConnection) Begin(context.Context) (pgx.Tx, error) {
	conn.beginCount++
	if conn.beginErr != nil {
		return nil, conn.beginErr
	}
	tx := &migrationTestTx{
		connection: conn,
		execErr:    conn.txExecErr,
		recordErr:  conn.recordErr,
		commitErr:  conn.commitErr,
	}
	conn.lastTx = tx
	return tx, nil
}

func migrationFixture() fstest.MapFS {
	return fstest.MapFS{
		"000001_first.up.sql":  {Data: []byte("BEGIN;\nCREATE TABLE first_table(id INT);\nCOMMIT;")},
		"000002_second.up.sql": {Data: []byte("CREATE TABLE second_table(id INT);")},
	}
}

func TestApplyWithConnectionAppliesAndSkipsMigrations(t *testing.T) {
	connection := &migrationTestConnection{applied: make(map[int64]bool)}
	if err := applyWithConnection(context.Background(), connection, migrationFixture()); err != nil {
		t.Fatalf("applyWithConnection returned error: %v", err)
	}
	if len(connection.scripts) != 2 || connection.beginCount != 2 || !connection.applied[1] || !connection.applied[2] {
		t.Fatalf("applied scripts=%q begins=%d versions=%v", connection.scripts, connection.beginCount, connection.applied)
	}
	if strings.TrimSpace(connection.scripts[0]) != "CREATE TABLE first_table(id INT);" ||
		len(connection.txArgs[0]) != 1 || connection.txArgs[0][0] != pgx.QueryExecModeSimpleProtocol {
		t.Fatalf("migration transaction did not strip transaction statements or use simple protocol: scripts=%q args=%#v", connection.scripts, connection.txArgs)
	}

	connection.hasHistory = true
	if err := applyWithConnection(context.Background(), connection, migrationFixture()); err != nil {
		t.Fatalf("reapply with migration history: %v", err)
	}
	if connection.beginCount != 2 {
		t.Fatalf("already-applied migrations began %d transactions, want 2", connection.beginCount)
	}
}

func TestApplyWithConnectionBaselinesExistingSchema(t *testing.T) {
	connection := &migrationTestConnection{hasSchema: true, applied: make(map[int64]bool)}
	if err := applyWithConnection(context.Background(), connection, migrationFixture()); err != nil {
		t.Fatalf("baseline existing schema: %v", err)
	}
	if connection.beginCount != 1 || !connection.applied[1] || !connection.applied[2] || len(connection.scripts) != 0 {
		t.Fatalf("baseline began=%d versions=%v scripts=%q", connection.beginCount, connection.applied, connection.scripts)
	}
}

func TestApplyWithConnectionReportsDatabaseFailures(t *testing.T) {
	failure := errors.New("database failure")
	tests := []struct {
		name       string
		connection *migrationTestConnection
		files      fs.FS
		want       string
	}{
		{name: "lock", connection: &migrationTestConnection{lockErr: failure}, files: migrationFixture(), want: "lock schema migrations"},
		{name: "create history", connection: &migrationTestConnection{createTableErr: failure}, files: migrationFixture(), want: "create migration history"},
		{name: "inspect schema", connection: &migrationTestConnection{inspectSchemaErr: failure}, files: migrationFixture(), want: "inspect existing schema"},
		{name: "inspect history", connection: &migrationTestConnection{inspectHistoryErr: failure}, files: migrationFixture(), want: "inspect migration history"},
		{name: "begin baseline", connection: &migrationTestConnection{hasSchema: true, beginErr: failure}, files: migrationFixture(), want: "begin existing schema baseline"},
		{name: "record baseline", connection: &migrationTestConnection{hasSchema: true, recordErr: failure}, files: migrationFixture(), want: "baseline existing schema"},
		{name: "commit baseline", connection: &migrationTestConnection{hasSchema: true, commitErr: failure}, files: migrationFixture(), want: "commit existing schema baseline"},
		{name: "invalid baseline filename", connection: &migrationTestConnection{hasSchema: true}, files: fstest.MapFS{"bad.up.sql": {Data: []byte("SELECT 1;")}}, want: "invalid migration filename"},
		{name: "check history", connection: &migrationTestConnection{checkErr: failure}, files: migrationFixture(), want: "check migration"},
		{name: "begin migration", connection: &migrationTestConnection{beginErr: failure}, files: migrationFixture(), want: "begin migration"},
		{name: "execute migration", connection: &migrationTestConnection{txExecErr: failure}, files: migrationFixture(), want: "execute migration"},
		{name: "record migration", connection: &migrationTestConnection{recordErr: failure}, files: migrationFixture(), want: "record migration"},
		{name: "commit migration", connection: &migrationTestConnection{commitErr: failure}, files: migrationFixture(), want: "commit migration"},
		{name: "invalid filename", connection: &migrationTestConnection{}, files: fstest.MapFS{"bad.up.sql": {Data: []byte("SELECT 1;")}}, want: "invalid migration filename"},
		{name: "unreadable migration", connection: &migrationTestConnection{}, files: fstest.MapFS{"000001_unreadable.up.sql": {Mode: fs.ModeDir}}, want: "read migration"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.connection.applied == nil {
				test.connection.applied = make(map[int64]bool)
			}
			err := applyWithConnection(context.Background(), test.connection, test.files)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("applyWithConnection error = %v, want containing %q", err, test.want)
			}
		})
	}
}

func TestApplyReportsConnectionAcquisitionFailure(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://user:pass@127.0.0.1:5432/db")
	if err != nil {
		t.Fatalf("create PostgreSQL pool: %v", err)
	}
	pool.Close()
	if err := Apply(context.Background(), pool); err == nil || !strings.Contains(err.Error(), "acquire migration connection") {
		t.Fatalf("Apply error = %v, want acquisition failure", err)
	}
}

func TestMigrationVersionRejectsInvalidNames(t *testing.T) {
	for _, name := range []string{"migration.up.sql", "x_invalid.up.sql", "not-a-number_name.up.sql"} {
		if _, err := migrationVersion(name); err == nil {
			t.Errorf("migrationVersion(%q) accepted invalid version", name)
		}
	}
}
