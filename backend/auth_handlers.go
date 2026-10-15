package backend

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

// Check if the application requires first-time setup
func (api *ApiConfig) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	count, err := api.DB.CountUsers(r.Context())
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{
		"setup_required": count == 0,
	})
}

// Handle the one-time creation of the Admin account
func (api *ApiConfig) handleInitialSetup(w http.ResponseWriter, r *http.Request) {
	type setupParams struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
		FullName string `json:"full_name"`
	}

	var params setupParams
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	params.Username = strings.ToLower(strings.TrimSpace(params.Username))
	params.Email = strings.TrimSpace(params.Email)
	params.FullName = strings.TrimSpace(params.FullName)
	address, err := mail.ParseAddress(params.Email)
	if !isAlphanumeric(params.Username) || len(params.Username) > 32 ||
		err != nil || address.Address != params.Email || params.FullName == "" ||
		len(params.Password) < 8 || len(params.Password) > 72 {
		http.Error(w, "Provide an alphanumeric username of at most 32 characters, a valid email, full name, and password of 8 to 72 bytes", http.StatusBadRequest)
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(params.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Failed to secure password", http.StatusInternalServerError)
		return
	}

	if api.BeginTx == nil {
		http.Error(w, "Setup is unavailable", http.StatusInternalServerError)
		return
	}
	// Serialize first-run requests so only one can observe an empty users table.
	tx, err := api.BeginTx(r.Context())
	if err != nil {
		http.Error(w, "Failed to initialize setup", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock($1)", int64(731942610)); err != nil {
		http.Error(w, "Failed to initialize setup", http.StatusInternalServerError)
		return
	}
	txQueries := dbgen.New(tx)
	count, err := txQueries.CountUsers(r.Context())
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	if count > 0 {
		http.Error(w, "Setup already complete. Please log in.", http.StatusForbidden)
		return
	}

	user, err := txQueries.CreateUser(r.Context(), dbgen.CreateUserParams{
		ID:           params.Username,
		Email:        params.Email,
		PasswordHash: string(hashedPassword),
		FullName:     params.FullName,
		Role:         "admin",
	})
	if err != nil {
		http.Error(w, "Failed to create admin user", http.StatusInternalServerError)
		return
	}
	if _, err := txQueries.CreatePersonalBoard(r.Context(), dbgen.CreatePersonalBoardParams{
		Title:   personalBoardTitle("", user.FullName),
		OwnerID: user.ID,
	}); err != nil {
		http.Error(w, "Failed to create personal board", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "Failed to create admin user", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Admin account created successfully",
		"user_id": user.ID,
	})
}

func (api *ApiConfig) handleLogin(w http.ResponseWriter, r *http.Request) {
	type loginParams struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	var params loginParams
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&params); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	params.Email = strings.TrimSpace(params.Email)
	if params.Email == "" || params.Password == "" {
		http.Error(w, "Invalid email or password", http.StatusUnauthorized)
		return
	}

	user, err := api.DB.GetUserByEmail(r.Context(), params.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "Invalid email or password", http.StatusUnauthorized)
			return
		}
		http.Error(w, "Failed to validate credentials", http.StatusInternalServerError)
		return
	}

	// 2. Validate the password hash
	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(params.Password))
	if err != nil {
		http.Error(w, "Invalid email or password", http.StatusUnauthorized)
		return
	}

	// Generate a cryptographically secure, unguessable session token.
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}
	token := base64.RawURLEncoding.EncodeToString(b)

	expiresAt := time.Now().Add(30 * 24 * time.Hour)
	_, err = api.DB.CreateSession(r.Context(), dbgen.CreateSessionParams{
		Token:     token,
		UserID:    user.ID,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "snappy_session",
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int((30 * 24 * time.Hour).Seconds()),
		HttpOnly: true, // Prevents JavaScript access (XSS protection)
		Secure:   api.SecureCookie,
		SameSite: http.SameSiteStrictMode,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Logged in successfully"})
}

func (api *ApiConfig) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	_, ok, err := api.authenticatedSession(r)
	if err != nil {
		http.Error(w, "Failed to validate session", http.StatusInternalServerError)
		return
	}
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"authenticated": false})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"authenticated": true})
}

func (api *ApiConfig) handleLogout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("snappy_session")
	if err == nil {
		if err := api.DB.DeleteSession(r.Context(), cookie.Value); err != nil {
			http.Error(w, "Failed to log out", http.StatusInternalServerError)
			return
		}
	} else if !errors.Is(err, http.ErrNoCookie) {
		http.Error(w, "Failed to log out", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "snappy_session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   api.SecureCookie,
		SameSite: http.SameSiteStrictMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (api *ApiConfig) authenticatedSession(r *http.Request) (dbgen.Session, bool, error) {
	cookie, err := r.Cookie("snappy_session")
	if err != nil {
		return dbgen.Session{}, false, nil
	}

	session, err := api.DB.GetSession(r.Context(), cookie.Value)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return dbgen.Session{}, false, nil
		}
		return dbgen.Session{}, false, err
	}
	return session, true, nil
}
