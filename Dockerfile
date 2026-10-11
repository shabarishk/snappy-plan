# Stage 1: Build Environment
FROM golang:alpine AS builder
WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source and compile statically
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o snappy-api .

# Stage 2: Minimal Runtime
FROM alpine:latest
WORKDIR /root/

# Pull only the compiled binary
COPY --from=builder /app/snappy-api .

EXPOSE 8080
CMD ["./snappy-api"]