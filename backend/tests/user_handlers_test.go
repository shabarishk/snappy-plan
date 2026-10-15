package backend_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"snappy-plan/backend"
	"snappy-plan/dbgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

func TestProfileEndpoints(t *testing.T) {
	const ownerID = "owner1"
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}

	t.Run("requires authentication", func(t *testing.T) {
		handler := newHandler(&fakeDB{}, nil, false)
		for _, method := range []string{http.MethodGet, http.MethodPut} {
			response := send(handler, method, "/api/profile",
				`{"full_name":"Updated User","email":"updated@example.com"}`, nil)
			if response.Code != http.StatusUnauthorized {
				t.Errorf("%s status = %d, want %d", method, response.Code, http.StatusUnauthorized)
			}

		}
	})

	t.Run("returns only profile fields", func(t *testing.T) {
		user := newUser("password123")
		user.ID = ownerID
		user.PreferredName = "Sam"
		db := &fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}, user: user}
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/profile", "", cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		var body map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode profile: %v", err)
		}
		if body["username"] != ownerID || body["full_name"] != user.FullName ||
			body["preferred_name"] != "Sam" || body["email"] != user.Email {
			t.Fatalf("profile = %#v", body)
		}
		if strings.Contains(response.Body.String(), user.PasswordHash) {
			t.Fatal("profile response included the password hash")
		}
	})

	t.Run("reports profile lookup failures", func(t *testing.T) {
		for _, test := range []struct {
			name       string
			sessionErr error
			userErr    error
			wantStatus int
		}{
			{name: "session validation error", sessionErr: errors.New("session query failed"), wantStatus: http.StatusInternalServerError},
			{name: "missing user", userErr: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
			{name: "database failure", userErr: errors.New("user query failed"), wantStatus: http.StatusInternalServerError},
		} {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session:    dbgen.Session{Token: "token", UserID: ownerID},
					sessionErr: test.sessionErr,
					userErr:    test.userErr,
				}
				response := send(newHandler(db, nil, false), http.MethodGet, "/api/profile", "", cookie)
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
				}
			})
		}
	})

	t.Run("updates full name and email", func(t *testing.T) {
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    dbgen.User{Role: "user"},
		}
		response := send(newHandler(db, nil, false), http.MethodPut, "/api/profile",
			`{"full_name":"Updated User","preferred_name":"Sam","email":"updated@example.com"}`, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if len(db.updateProfileArgs) != 4 || db.updateProfileArgs[0] != ownerID ||
			db.updateProfileArgs[1] != "updated@example.com" || db.updateProfileArgs[2] != "Updated User" ||
			db.updateProfileArgs[3] != "Sam" {
			t.Fatalf("update args = %#v", db.updateProfileArgs)
		}
		var body map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode profile: %v", err)
		}
		if body["username"] != ownerID || body["full_name"] != "Updated User" ||
			body["preferred_name"] != "Sam" || body["email"] != "updated@example.com" ||
			body["role"] != "user" || len(body) != 5 {
			t.Fatalf("updated profile = %#v", body)
		}
	})

	t.Run("validates profile fields", func(t *testing.T) {
		for _, body := range []string{
			`{`,
			`{"full_name":" ","email":"valid@example.com"}`,
			`{"full_name":"User","email":"not-an-email"}`,
			`{"full_name":"User","email":"User <user@example.com>"}`,
			`{"full_name":"` + strings.Repeat("a", 101) + `","email":"valid@example.com"}`,
			`{"full_name":"User","preferred_name":"` + strings.Repeat("a", 101) + `","email":"valid@example.com"}`,
		} {
			response := send(newHandler(&fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}}, nil, false),
				http.MethodPut, "/api/profile", body, cookie)
			if response.Code != http.StatusBadRequest {
				t.Errorf("body %q status = %d, want %d", body, response.Code, http.StatusBadRequest)
			}
		}
	})

	t.Run("reports duplicate email and database failures", func(t *testing.T) {
		for _, test := range []struct {
			name       string
			err        error
			wantStatus int
		}{
			{name: "duplicate email", err: &pgconn.PgError{Code: "23505"}, wantStatus: http.StatusConflict},
			{name: "missing user", err: pgx.ErrNoRows, wantStatus: http.StatusNotFound},
			{name: "database failure", err: errors.New("database unavailable"), wantStatus: http.StatusInternalServerError},
		} {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session:          dbgen.Session{Token: "token", UserID: ownerID},
					updateProfileErr: test.err,
				}
				response := send(newHandler(db, nil, false), http.MethodPut, "/api/profile",
					`{"full_name":"Updated User","email":"updated@example.com"}`, cookie)
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
				}
			})
		}
	})

	t.Run("reports session validation errors", func(t *testing.T) {
		db := &fakeDB{
			session:    dbgen.Session{Token: "token", UserID: ownerID},
			sessionErr: errors.New("session query failed"),
		}
		for _, method := range []string{http.MethodGet, http.MethodPut} {
			response := send(newHandler(db, nil, false), method, "/api/profile",
				`{"full_name":"Updated User","email":"updated@example.com"}`, cookie)
			if response.Code != http.StatusInternalServerError {
				t.Errorf("%s status = %d, want %d", method, response.Code, http.StatusInternalServerError)
			}
		}
	})
}

func TestProfilePictureEndpoints(t *testing.T) {
	const ownerID = "owner1"
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	var imageBuffer bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 256, 256))
	for y := 0; y < 256; y++ {
		for x := 0; x < 256; x++ {
			picture.Set(x, y, color.RGBA{R: 30, G: 100, B: 200, A: 255})
		}
	}
	if err := jpeg.Encode(&imageBuffer, picture, nil); err != nil {
		t.Fatalf("encode test picture: %v", err)
	}
	dataURL := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(imageBuffer.Bytes())

	t.Run("uploads picture and returns it", func(t *testing.T) {
		db := &fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}}
		response := send(newHandler(db, nil, false), http.MethodPut, "/api/profile/picture",
			`{"profile_picture":"`+dataURL+`"}`, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if len(db.updateProfilePictureArgs) != 2 || db.updateProfilePictureArgs[1] != ownerID ||
			db.updateProfilePictureArgs[0].(pgtype.Text).String != dataURL {
			t.Fatalf("update args = %#v", db.updateProfilePictureArgs)
		}
		var body map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode profile: %v", err)
		}
		if body["profile_picture"] != dataURL {
			t.Fatal("profile picture was not returned")
		}
	})

	t.Run("rejects invalid picture data", func(t *testing.T) {
		for _, pictureData := range []string{"", "data:image/png;base64,YQ==", "data:image/jpeg;base64,YQ=="} {
			response := send(newHandler(&fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}},
				nil, false), http.MethodPut, "/api/profile/picture",
				`{"profile_picture":"`+pictureData+`"}`, cookie)
			if response.Code != http.StatusBadRequest {
				t.Errorf("picture %q status = %d, want %d", pictureData, response.Code, http.StatusBadRequest)
			}
		}
	})

	t.Run("removes picture", func(t *testing.T) {
		db := &fakeDB{session: dbgen.Session{Token: "token", UserID: ownerID}}
		response := send(newHandler(db, nil, false), http.MethodDelete, "/api/profile/picture", "", cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if len(db.updateProfilePictureArgs) != 2 || db.updateProfilePictureArgs[0].(pgtype.Text).Valid {
			t.Fatalf("remove args = %#v", db.updateProfilePictureArgs)
		}
		if strings.Contains(response.Body.String(), "profile_picture") {
			t.Fatalf("removed picture was returned: %s", response.Body.String())
		}
	})

	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPut, "/api/profile/picture",
			`{"profile_picture":"`+dataURL+`"}`, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})
}

func TestAdminUserEndpoints(t *testing.T) {
	const adminID = "admin1"
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	admin := newUser("password123")

	t.Run("requires administrator privileges", func(t *testing.T) {
		for _, test := range []struct {
			name   string
			user   dbgen.User
			cookie *http.Cookie
			want   int
		}{
			{name: "unauthenticated", want: http.StatusUnauthorized},
			{name: "regular user", user: dbgen.User{ID: "user1", Role: "user"}, cookie: cookie, want: http.StatusForbidden},
		} {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session: dbgen.Session{Token: "token", UserID: test.user.ID},
					user:    test.user,
				}
				for _, request := range []struct {
					method string
					path   string
					body   string
				}{
					{http.MethodGet, "/api/admin/users", ""},
					{http.MethodGet, "/api/admin/boards", ""},
					{http.MethodPost, "/api/admin/users", `{"username":"newuser","email":"new@example.com","password":"password123"}`},
					{http.MethodPatch, "/api/admin/users/user1/role", `{"role":"admin"}`},
				} {
					response := send(newHandler(db, nil, false), request.method, request.path, request.body, test.cookie)
					if response.Code != test.want {
						t.Errorf("%s %s status = %d, want %d", request.method, request.path, response.Code, test.want)
					}
				}
			})
		}
	})

	t.Run("lists users without exposing password hashes", func(t *testing.T) {
		db := &fakeDB{
			session:    dbgen.Session{Token: "token", UserID: adminID},
			user:       admin,
			adminUsers: []dbgen.GetUsersForAdminRow{{ID: "member", FullName: "Member", PreferredName: "Sam", Email: "member@example.com", Role: "user"}},
		}
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/admin/users", "", cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		var users []adminUserResponseTest
		if err := json.Unmarshal(response.Body.Bytes(), &users); err != nil {
			t.Fatalf("decode admin users: %v", err)
		}
		if len(users) != 1 || users[0].Username != "member" ||
			users[0].PreferredName != "Sam" || users[0].Role != "user" {
			t.Fatalf("admin users = %#v", users)
		}
		if strings.Contains(response.Body.String(), "password_hash") {
			t.Fatal("user list exposed password hashes")
		}
	})

	t.Run("lists all boards with owner details", func(t *testing.T) {
		boardID := newUUID(7)
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: adminID},
			user:    admin,
			adminBoards: []dbgen.GetAllBoardsForAdminRow{{
				ID: boardID, Title: "Personal board", OwnerID: "member", FullName: "Member User",
			}},
		}
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/admin/boards", "", cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		var boards []struct {
			ID        pgtype.UUID `json:"id"`
			Title     string      `json:"title"`
			OwnerID   string      `json:"owner_id"`
			OwnerName string      `json:"owner_name"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &boards); err != nil {
			t.Fatalf("decode admin boards: %v", err)
		}
		if len(boards) != 1 || boards[0].ID != boardID || boards[0].Title != "Personal board" ||
			boards[0].OwnerID != "member" || boards[0].OwnerName != "Member User" {
			t.Fatalf("admin boards = %#v", boards)
		}
	})

	t.Run("returns an empty list when there are no boards", func(t *testing.T) {
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: adminID},
			user:    admin,
		}
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/admin/boards", "", cookie)
		if response.Code != http.StatusOK || response.Body.String() != "[]\n" {
			t.Fatalf("status=%d body=%q, want empty board list", response.Code, response.Body.String())
		}
	})

	t.Run("reports board query failures", func(t *testing.T) {
		db := &fakeDB{
			session:        dbgen.Session{Token: "token", UserID: adminID},
			user:           admin,
			adminBoardsErr: errors.New("query failed"),
		}
		response := send(newHandler(db, nil, false), http.MethodGet, "/api/admin/boards", "", cookie)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
		}
	})

	t.Run("reports response encoding failures", func(t *testing.T) {
		handler := newHandler(&fakeDB{
			session: dbgen.Session{Token: "token", UserID: adminID},
			user:    admin,
			adminBoards: []dbgen.GetAllBoardsForAdminRow{{
				ID: newUUID(8), Title: "Board", OwnerID: "member", FullName: "Member",
			}},
		}, nil, false)
		request := httptest.NewRequest(http.MethodGet, "/api/admin/boards", nil)
		request.AddCookie(cookie)
		writer := &failingResponseWriter{err: errors.New("write failed")}

		handler.ServeHTTP(writer, request)
		if writer.status != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d", writer.status, http.StatusInternalServerError)
		}
	})

	t.Run("creates a regular user with a hashed password", func(t *testing.T) {
		db := &fakeDB{session: dbgen.Session{Token: "token", UserID: adminID}, user: admin}
		tx := &fakeTx{fakeDB: db}
		response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false), http.MethodPost, "/api/admin/users",
			`{"username":" NewUser ","full_name":" New User ","preferred_name":" Sam ","email":"new@example.com","password":"password123"}`, cookie)
		if response.Code != http.StatusCreated || !tx.committed {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusCreated, response.Body.String())
		}
		if len(db.createUserArgs) != 6 || db.createUserArgs[0] != "newuser" ||
			db.createUserArgs[1] != "new@example.com" || db.createUserArgs[3] != "New User" ||
			db.createUserArgs[4] != "Sam" || db.createUserArgs[5] != "user" {
			t.Fatalf("create user args = %#v", db.createUserArgs)
		}
		if len(db.boardArgs) != 2 || db.boardArgs[0] != "New User" || db.boardArgs[1] != "newuser" {
			t.Fatalf("personal board args = %#v", db.boardArgs)
		}
		if err := bcrypt.CompareHashAndPassword([]byte(db.createUserArgs[2].(string)), []byte("password123")); err != nil {
			t.Fatalf("created password hash does not match: %v", err)
		}
		if strings.Contains(response.Body.String(), db.createUserArgs[2].(string)) {
			t.Fatal("create user response exposed password hash")
		}
		var createdUser adminUserResponseTest
		if err := json.Unmarshal(response.Body.Bytes(), &createdUser); err != nil {
			t.Fatalf("decode created user: %v", err)
		}
		if createdUser.PreferredName != "Sam" {
			t.Fatalf("created user preferred name = %q", createdUser.PreferredName)
		}
	})

	t.Run("rolls back user creation if personal board creation fails", func(t *testing.T) {
		db := &fakeDB{
			session:        dbgen.Session{Token: "token", UserID: adminID},
			user:           admin,
			createBoardErr: errors.New("board insert failed"),
		}
		tx := &fakeTx{fakeDB: db}
		response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
			return tx, nil
		}, false), http.MethodPost, "/api/admin/users",
			`{"username":"newuser","full_name":"New User","email":"new@example.com","password":"password123"}`, cookie)
		if response.Code != http.StatusInternalServerError || tx.committed || !tx.rolledBack {
			t.Fatalf("status=%d committed=%t rolledBack=%t",
				response.Code, tx.committed, tx.rolledBack)
		}
	})

	t.Run("rejects invalid and duplicate users", func(t *testing.T) {
		for _, test := range []struct {
			name       string
			body       string
			createErr  error
			wantStatus int
		}{
			{name: "invalid username", body: `{"username":"bad name","email":"new@example.com","password":"password123"}`, wantStatus: http.StatusBadRequest},
			{name: "missing full name", body: `{"username":"newuser","email":"new@example.com","password":"password123"}`, wantStatus: http.StatusBadRequest},
			{name: "blank full name", body: `{"username":"newuser","full_name":"  ","email":"new@example.com","password":"password123"}`, wantStatus: http.StatusBadRequest},
			{name: "full name too long", body: `{"username":"newuser","full_name":"` + strings.Repeat("a", 101) + `","email":"new@example.com","password":"password123"}`, wantStatus: http.StatusBadRequest},
			{name: "preferred name too long", body: `{"username":"newuser","full_name":"New User","preferred_name":"` + strings.Repeat("a", 101) + `","email":"new@example.com","password":"password123"}`, wantStatus: http.StatusBadRequest},
			{name: "invalid email", body: `{"username":"newuser","email":"not-email","password":"password123"}`, wantStatus: http.StatusBadRequest},
			{name: "short password", body: `{"username":"newuser","email":"new@example.com","password":"short"}`, wantStatus: http.StatusBadRequest},
			{name: "duplicate", body: `{"username":"newuser","full_name":"New User","email":"new@example.com","password":"password123"}`, createErr: &pgconn.PgError{Code: "23505"}, wantStatus: http.StatusConflict},
		} {
			t.Run(test.name, func(t *testing.T) {
				db := &fakeDB{
					session:         dbgen.Session{Token: "token", UserID: adminID},
					user:            admin,
					createUserError: test.createErr,
				}
				tx := &fakeTx{fakeDB: db}
				response := send(newHandler(db, func(context.Context) (backend.SetupTransaction, error) {
					return tx, nil
				}, false), http.MethodPost, "/api/admin/users", test.body, cookie)
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
				}
			})
		}
	})

	t.Run("promotes another user but not the current admin", func(t *testing.T) {
		db := &fakeDB{session: dbgen.Session{Token: "token", UserID: adminID}, user: admin}
		response := send(newHandler(db, nil, false), http.MethodPatch, "/api/admin/users/member/role",
			`{"role":"admin"}`, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if len(db.updateUserRoleArgs) != 2 || db.updateUserRoleArgs[0] != "member" ||
			db.updateUserRoleArgs[1] != "admin" {
			t.Fatalf("role update args = %#v", db.updateUserRoleArgs)
		}

		selfPromotion := send(newHandler(db, nil, false), http.MethodPatch,
			"/api/admin/users/"+adminID+"/role", `{"role":"admin"}`, cookie)
		if selfPromotion.Code != http.StatusBadRequest {
			t.Fatalf("self-promotion status = %d, want %d", selfPromotion.Code, http.StatusBadRequest)
		}
	})
}

func TestUpdatePasswordEndpoint(t *testing.T) {
	const ownerID = "owner1"
	cookie := &http.Cookie{Name: "snappy_session", Value: "token"}
	validBody := `{"current_password":"password123","new_password":"new-password","confirm_password":"new-password"}`

	t.Run("requires authentication", func(t *testing.T) {
		response := send(newHandler(&fakeDB{}, nil, false), http.MethodPut,
			"/api/profile/password", validBody, nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("updates password after validating current password", func(t *testing.T) {
		user := newUser("password123")
		user.ID = ownerID
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    user,
		}
		response := send(newHandler(db, nil, false), http.MethodPut,
			"/api/profile/password", validBody, cookie)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
		}
		if len(db.updatePasswordArgs) != 2 || db.updatePasswordArgs[0] != ownerID {
			t.Fatalf("password update args = %#v", db.updatePasswordArgs)
		}
		if err := bcrypt.CompareHashAndPassword([]byte(db.user.PasswordHash), []byte("new-password")); err != nil {
			t.Fatalf("stored password hash does not match new password: %v", err)
		}
		var body map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if body["message"] != "Password updated successfully" {
			t.Fatalf("response = %#v", body)
		}
	})

	t.Run("rejects invalid password fields", func(t *testing.T) {
		for _, body := range []string{
			`{`,
			`{"current_password":"password123","new_password":"","confirm_password":""}`,
			`{"current_password":"password123","new_password":"new-password","confirm_password":"different-password"}`,
			`{"current_password":"","new_password":"new-password","confirm_password":"new-password"}`,
			`{"current_password":"password123","new_password":"short","confirm_password":"short"}`,
			`{"current_password":"password123","new_password":"` + strings.Repeat("a", 73) + `","confirm_password":"` + strings.Repeat("a", 73) + `"}`,
		} {
			user := newUser("password123")
			user.ID = ownerID
			db := &fakeDB{
				session: dbgen.Session{Token: "token", UserID: ownerID},
				user:    user,
			}
			response := send(newHandler(db, nil, false), http.MethodPut,
				"/api/profile/password", body, cookie)
			if response.Code != http.StatusBadRequest {
				t.Errorf("body %q status = %d, want %d", body, response.Code, http.StatusBadRequest)
			}
			if len(db.updatePasswordArgs) != 0 {
				t.Errorf("invalid password request wrote to database: %#v", db.updatePasswordArgs)
			}
		}
	})

	t.Run("rejects an incorrect current password", func(t *testing.T) {
		user := newUser("password123")
		user.ID = ownerID
		db := &fakeDB{
			session: dbgen.Session{Token: "token", UserID: ownerID},
			user:    user,
		}
		body := `{"current_password":"incorrect","new_password":"new-password","confirm_password":"new-password"}`
		response := send(newHandler(db, nil, false), http.MethodPut,
			"/api/profile/password", body, cookie)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
		if len(db.updatePasswordArgs) != 0 {
			t.Fatalf("incorrect current password updated database: %#v", db.updatePasswordArgs)
		}
	})

	t.Run("reports lookup, session, and update failures", func(t *testing.T) {
		for _, test := range []struct {
			name       string
			db         *fakeDB
			wantStatus int
		}{
			{
				name: "session validation failure",
				db: &fakeDB{
					session:    dbgen.Session{Token: "token", UserID: ownerID},
					sessionErr: errors.New("session query failed"),
				},
				wantStatus: http.StatusInternalServerError,
			},
			{
				name: "missing user",
				db: &fakeDB{
					session: dbgen.Session{Token: "token", UserID: ownerID},
					userErr: pgx.ErrNoRows,
				},
				wantStatus: http.StatusNotFound,
			},
			{
				name: "user lookup failure",
				db: &fakeDB{
					session: dbgen.Session{Token: "token", UserID: ownerID},
					userErr: errors.New("user query failed"),
				},
				wantStatus: http.StatusInternalServerError,
			},
			{
				name: "password update failure",
				db: &fakeDB{
					session:           dbgen.Session{Token: "token", UserID: ownerID},
					user:              newUser("password123"),
					updatePasswordErr: errors.New("password update failed"),
				},
				wantStatus: http.StatusInternalServerError,
			},
		} {
			t.Run(test.name, func(t *testing.T) {
				test.db.user.ID = ownerID
				response := send(newHandler(test.db, nil, false), http.MethodPut,
					"/api/profile/password", validBody, cookie)
				if response.Code != test.wantStatus {
					t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
				}
			})
		}
	})
}
