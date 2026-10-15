package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"snappy-plan/backend"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type startupSchemaTx struct {
	execCalls    []string
	failContains string
	committed    bool
	rolledBack   bool
}

func (tx *startupSchemaTx) Exec(_ context.Context, query string, _ ...any) (pgconn.CommandTag, error) {
	tx.execCalls = append(tx.execCalls, query)
	if tx.failContains != "" && strings.Contains(query, tx.failContains) {
		return pgconn.CommandTag{}, errors.New("schema update failed")
	}
	return pgconn.CommandTag{}, nil
}

func (*startupSchemaTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query")
}

func (*startupSchemaTx) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

func (tx *startupSchemaTx) Commit(context.Context) error {
	tx.committed = true
	return nil
}

func (tx *startupSchemaTx) Rollback(context.Context) error {
	if !tx.committed {
		tx.rolledBack = true
	}
	return nil
}

func TestUpgradeProfileSchemas(t *testing.T) {
	t.Run("applies both upgrades", func(t *testing.T) {
		transactions := []*startupSchemaTx{{}, {}}
		next := 0
		beginTx := func(context.Context) (backend.SetupTransaction, error) {
			tx := transactions[next]
			next++
			return tx, nil
		}

		if err := upgradeProfileSchemas(context.Background(), beginTx); err != nil {
			t.Fatalf("upgradeProfileSchemas returned error: %v", err)
		}
		if next != 2 || !strings.Contains(transactions[0].execCalls[1], "profile_picture TEXT") ||
			!strings.Contains(transactions[1].execCalls[1], "preferred_name VARCHAR(100)") ||
			!transactions[0].committed || !transactions[1].committed {
			t.Fatalf("transactions = %#v", transactions)
		}
	})

	t.Run("reports preferred name upgrade failures", func(t *testing.T) {
		transactions := []*startupSchemaTx{{}, {failContains: "preferred_name"}}
		next := 0
		beginTx := func(context.Context) (backend.SetupTransaction, error) {
			tx := transactions[next]
			next++
			return tx, nil
		}

		err := upgradeProfileSchemas(context.Background(), beginTx)
		if err == nil || !strings.Contains(err.Error(), "update preferred name schema") ||
			!transactions[0].committed || transactions[1].committed || !transactions[1].rolledBack {
			t.Fatalf("error=%v transactions=%#v", err, transactions)
		}
	})

	t.Run("reports profile picture upgrade failures", func(t *testing.T) {
		transactions := []*startupSchemaTx{{failContains: "profile_picture"}}
		beginTx := func(context.Context) (backend.SetupTransaction, error) {
			return transactions[0], nil
		}

		err := upgradeProfileSchemas(context.Background(), beginTx)
		if err == nil || !strings.Contains(err.Error(), "update profile picture schema") ||
			transactions[0].committed || !transactions[0].rolledBack {
			t.Fatalf("error=%v transactions=%#v", err, transactions)
		}
	})
}
