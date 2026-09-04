# Multi-stage Dockerfile for Niseva Cloud RMS (Go)
# Stage 1: Build the stripped native machine-code binary
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install git and ca-certificates
RUN apk add --no-cache git ca-certificates tzdata

# Copy module definitions and pre-fetch dependencies
COPY backend/go.mod ./
# Note: go.sum will be downloaded by go mod tidy
RUN go mod download || true

# Copy backend source code
COPY backend/ ./

# Compile stripped native binary (Zero debug symbols, pure machine code)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/niseva-rms-server ./cmd/server

# Stage 2: Ultra-minimal, secure, closed-source runtime image
FROM alpine:3.20

WORKDIR /app

RUN apk --no-cache add ca-certificates tzdata

# Copy ONLY the compiled binary (Zero human-readable source code included)
COPY --from=builder /app/niseva-rms-server /app/niseva-rms-server

EXPOSE 8080

ENTRYPOINT ["/app/niseva-rms-server"]
