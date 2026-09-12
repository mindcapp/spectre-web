package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://spectre:spectre@localhost:5432/spectre?sslmode=disable"
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("connect to database: %v", err)
	}

	store := &DomainStore{db: db}
	if err := store.InitSchema(context.Background()); err != nil {
		log.Fatalf("initialize database schema: %v", err)
	}

	server := &http.Server{
		Addr:              ":8081",
		Handler:           NewRegistryHandler(store),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Println("API Server listening on :8081")
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("API server failed: %v", err)
	}
}
