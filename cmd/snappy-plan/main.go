package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"snappy-plan/backend"
	"snappy-plan/migrations"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if os.Getenv("DATABASE_URL") == "" {
		launchMain()
		return
	}
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
	if err := migrations.Apply(context.Background(), pool); err != nil {
		log.Fatalf("Unable to apply database migrations: %v\n", err)
	}
	if err := backend.EnsureUserIDSchema(context.Background(), func(ctx context.Context) (backend.SetupTransaction, error) {
		return pool.Begin(ctx)
	}); err != nil {
		log.Fatalf("Unable to update user ID schema: %v\n", err)
	}
	if err := backend.EnsureTaskSchema(context.Background(), func(ctx context.Context) (backend.SetupTransaction, error) {
		return pool.Begin(ctx)
	}); err != nil {
		log.Fatalf("Unable to update task schema: %v\n", err)
	}
	if err := backend.EnsureInitiativeSchema(context.Background(), func(ctx context.Context) (backend.SetupTransaction, error) {
		return pool.Begin(ctx)
	}); err != nil {
		log.Fatalf("Unable to update initiative schema: %v\n", err)
	}
	if err := upgradeProfileSchemas(context.Background(), func(ctx context.Context) (backend.SetupTransaction, error) {
		return pool.Begin(ctx)
	}); err != nil {
		log.Fatalf("Unable to update profile schemas: %v\n", err)
	}
	if err := backend.EnsurePersonalBoards(context.Background(), func(ctx context.Context) (backend.SetupTransaction, error) {
		return pool.Begin(ctx)
	}); err != nil {
		log.Fatalf("Unable to create personal boards: %v\n", err)
	}

	frontendFiles, err := backend.FrontendFiles()
	if err != nil {
		log.Fatalf("Unable to load frontend assets: %v\n", err)
	}
	handler := backend.NewHandlerWithSetupToken(pool, func(ctx context.Context) (backend.SetupTransaction, error) {
		return pool.Begin(ctx)
	}, os.Getenv("COOKIE_SECURE") == "true", os.Getenv("SNAPPY_SETUP_TOKEN"), frontendFiles)

	// 5. Start the server
	log.Println("Server starting on port 8080...")
	err = http.ListenAndServe(":8080", handler)
	if err != nil {
		log.Fatal(err)
	}
}

func launchMain() {
	frontendFiles, err := backend.FrontendFiles()
	if err != nil {
		log.Fatalf("Unable to load frontend assets: %v", err)
	}
	configPath := os.Getenv("SNAPPY_CONFIG_FILE")
	if configPath == "" {
		configPath = defaultLaunchConfigPath
	}
	runtime := newLaunchRuntime(configPath, os.Getenv("SNAPPY_SETUP_TOKEN"), os.Getenv("COOKIE_SECURE") == "true", frontendFiles)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	err = runtime.activateSavedConfig(ctx)
	cancel()
	if err != nil && !os.IsNotExist(err) {
		log.Printf("Saved PostgreSQL configuration is unavailable; use the Launching page to retry: %v", err)
	}
	log.Println("Server starting on port 8080...")
	if err := http.ListenAndServe(":8080", runtime.handler()); err != nil {
		log.Fatal(err)
	}
}

func upgradeProfileSchemas(ctx context.Context, beginTx func(context.Context) (backend.SetupTransaction, error)) error {
	if err := backend.EnsureProfilePictureSchema(ctx, beginTx); err != nil {
		return fmt.Errorf("update profile picture schema: %w", err)
	}
	if err := backend.EnsurePreferredNameSchema(ctx, beginTx); err != nil {
		return fmt.Errorf("update preferred name schema: %w", err)
	}
	return nil
}
