package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"snappy-plan/backend"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() { // Read from Docker env, fallback to localhost for manual testing
	dbUrl := os.Getenv("DATABASE_URL")
	if dbUrl == "" {
		dbUrl = "postgres://postgres:password@localhost:5432/snappyplan?sslmode=disable"
	}
	var pool *pgxpool.Pool
	var err error

	// Retry connecting every 2 seconds (up to 5 times)
	for i := 0; i < 5; i++ {
		pool, err = pgxpool.New(context.Background(), dbUrl)
		if err == nil {
			err = pool.Ping(context.Background())
			if err == nil {
				break // Successfully connected
			}
			pool.Close()
		}
		log.Printf("Database not ready, retrying in 2 seconds... (%d/5)\n", i+1)
		time.Sleep(2 * time.Second)
	}

	if err != nil {
		log.Fatalf("Unable to connect to database: %v\n", err)
	}
	defer pool.Close()

	log.Println("Successfully connected to PostgreSQL!")
	if err := backend.EnsureUserIDSchema(context.Background(), func(ctx context.Context) (backend.SetupTransaction, error) {
		return pool.Begin(ctx)
	}); err != nil {
		log.Fatalf("Unable to update user ID schema: %v\n", err)
	}
	if err := backend.EnsurePersonalBoards(context.Background(), func(ctx context.Context) (backend.SetupTransaction, error) {
		return pool.Begin(ctx)
	}); err != nil {
		log.Fatalf("Unable to create personal boards: %v\n", err)
	}
	if err := backend.EnsureTaskSchema(context.Background(), func(ctx context.Context) (backend.SetupTransaction, error) {
		return pool.Begin(ctx)
	}); err != nil {
		log.Fatalf("Unable to update task schema: %v\n", err)
	}

	frontendFiles, err := backend.FrontendFiles()
	if err != nil {
		log.Fatalf("Unable to load frontend assets: %v\n", err)
	}
	handler := backend.NewHandler(pool, func(ctx context.Context) (backend.SetupTransaction, error) {
		return pool.Begin(ctx)
	}, os.Getenv("COOKIE_SECURE") == "true", frontendFiles)

	// 5. Start the server
	log.Println("Server starting on port 8080...")
	err = http.ListenAndServe(":8080", handler)
	if err != nil {
		log.Fatal(err)
	}
}
