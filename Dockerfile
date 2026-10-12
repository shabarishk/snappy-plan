# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Build the Go server with the frontend embedded
FROM golang:alpine AS backend-builder
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=frontend-builder /app/frontend/dist ./backend/web/dist
RUN CGO_ENABLED=0 GOOS=linux go build -o snappy-api ./cmd/snappy-plan

# Stage 3: Minimal runtime
FROM alpine:latest
WORKDIR /app

COPY --from=backend-builder /app/snappy-api .

EXPOSE 8080
CMD ["./snappy-api"]