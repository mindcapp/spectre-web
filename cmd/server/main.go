package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/mindcapp/spectre-web/internal/search"
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
	if err := store.InitSchema(); err != nil {
		log.Fatalf("initialize database schema: %v", err)
	}

	searchHost := os.Getenv("MEILISEARCH_HOST")
	searchKey := os.Getenv("MEILISEARCH_KEY")
	if searchHost == "" {
		searchHost = "http://localhost:7700"
	}
	if searchKey == "" {
		searchKey = "masterKey"
	}

	searchIndexer, err := search.NewIndexer(searchHost, searchKey)
	if err != nil {
		log.Fatalf("initialize search indexer: %v", err)
	}
	if err := searchIndexer.CreateIndexIfNotExists(); err != nil {
		log.Fatalf("initialize search index: %v", err)
	}

	searchHandler := search.NewSearchHandler(searchIndexer)

	mux := http.NewServeMux()
	mux.Handle("/api/domains/", NewRegistryHandler(store))
	mux.Handle("/api/search", searchHandler)
	mux.Handle("/internal/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/internal/resolve") {
			NewRegistryHandler(store).ServeHTTP(w, r)
		} else {
			writeError(w, http.StatusNotFound, "not found")
		}
	}))

	server := &http.Server{
		Addr:              ":8081",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Println("API Server listening on :8081")
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("API server failed: %v", err)
	}
}
