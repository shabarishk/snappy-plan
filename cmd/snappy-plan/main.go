package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"snappy-plan/backend"
	"time"
)

func main() {
	if err := runLaunchServer(os.Getenv, http.ListenAndServe); err != nil {
		log.Fatal(err)
	}
}

func runLaunchServer(getenv func(string) string, listen func(string, http.Handler) error) error {
	frontendFiles, err := backend.FrontendFiles()
	if err != nil {
		return fmt.Errorf("load frontend assets: %w", err)
	}
	configPath := getenv("SNAPPY_CONFIG_FILE")
	if configPath == "" {
		configPath = defaultLaunchConfigPath
	}
	runtime := newLaunchRuntime(configPath, getenv("SNAPPY_SETUP_TOKEN"), getenv("COOKIE_SECURE") == "true", frontendFiles)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if databaseURL := getenv("DATABASE_URL"); databaseURL != "" {
		err = runtime.activateURL(ctx, databaseURL, nil, false)
	} else {
		err = runtime.activateSavedConfig(ctx)
	}
	if err != nil && !os.IsNotExist(err) {
		log.Printf("Saved PostgreSQL configuration is unavailable; Snappy Plan will retry the connection: %v", err)
	}
	runtime.mu.RLock()
	hasSavedConfig := runtime.configured
	databaseReady := runtime.active != nil
	runtime.mu.RUnlock()
	if hasSavedConfig && !databaseReady {
		go runtime.retrySavedConfig(context.Background())
	}
	log.Println("Server starting on port 8080...")
	return listen(":8080", runtime.handler())
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
