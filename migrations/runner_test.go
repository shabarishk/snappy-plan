package migrations

import (
	"strings"
	"testing"
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
