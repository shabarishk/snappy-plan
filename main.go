package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"snappy-plan/dbgen"
	"time"

	"github.com/jackc/pgx/v5"
)

func main() { // Read from Docker env, fallback to localhost for manual testing
	dbUrl := os.Getenv("DATABASE_URL")
	if dbUrl == "" {
		dbUrl = "postgres://postgres:password@localhost:5432/snappyplan?sslmode=disable"
	}
	var conn *pgx.Conn
	var err error

	// Retry connecting every 2 seconds (up to 5 times)
	for i := 0; i < 5; i++ {
		conn, err = pgx.Connect(context.Background(), dbUrl)
		if err == nil {
			break // Successfully connected
		}
		log.Printf("Database not ready, retrying in 2 seconds... (%d/5)\n", i+1)
		time.Sleep(2 * time.Second)
	}

	if err != nil {
		log.Fatalf("Unable to connect to database: %v\n", err)
	}
	defer conn.Close(context.Background())

	log.Println("Successfully connected to PostgreSQL!")

	// 2. Initialize the sqlc queries with the live connection
	queries := dbgen.New(conn)

	// 3. Create our config struct holding the database pointer
	apiCfg := &ApiConfig{
		DB: queries,
	}

	// 4. Set up the HTTP router (Go 1.22+ standard library)
	mux := http.NewServeMux()

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
