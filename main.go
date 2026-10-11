package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"snappy-plan/dbgen"
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

	// 2. Initialize the sqlc queries with the live connection
	queries := dbgen.New(pool)

	// 3. Create our config struct holding the database pointer
	apiCfg := &ApiConfig{
		DB:           queries,
		Pool:         pool,
		SecureCookie: os.Getenv("COOKIE_SECURE") == "true",
	}

	// 4. Set up the HTTP router (Go 1.22+ standard library)
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/setup/status", apiCfg.handleSetupStatus)
	mux.HandleFunc("POST /api/setup", apiCfg.handleInitialSetup)
	mux.HandleFunc("POST /api/login", apiCfg.handleLogin)
	mux.HandleFunc("GET /api/auth/status", apiCfg.handleAuthStatus)

	// Map the URL endpoint to our handler function
	mux.HandleFunc("POST /api/boards", apiCfg.handleCreateBoard)

	// Add a simple health check endpoint
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Snappy Plan Backend is running!"))
	})

	// 5. Start the server
	log.Println("Server starting on port 8080...")
	err = http.ListenAndServe(":8080", mux)
	if err != nil {
		log.Fatal(err)
	}
}
