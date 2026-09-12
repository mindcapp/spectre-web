package search

import (
	"encoding/json"
	"net/http"
	"strings"
)

type SearchHandler struct {
	indexer *Indexer
}

func NewSearchHandler(indexer *Indexer) *SearchHandler {
	return &SearchHandler{indexer: indexer}
}

func (h *SearchHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/search":
		h.Search(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/internal/index":
		h.IndexDocument(w, r)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

func (h *SearchHandler) Search(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeError(w, http.StatusBadRequest, "query parameter 'q' is required")
		return
	}

	docs, err := h.indexer.Search(query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to search")
		return
	}

	result := make([]SearchResult, 0, len(docs))
	for _, doc := range docs {
		snippet := doc.Content
		if len(snippet) > 150 {
			snippet = snippet[:150] + "..."
		}
		result = append(result, SearchResult{
			Title:   doc.Title,
			URL:     doc.URL,
			Snippet: snippet,
		})
	}

	writeJSON(w, http.StatusOK, result)
}

func (h *SearchHandler) IndexDocument(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req IndexDocumentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	if req.URL == "" || req.Title == "" || req.Content == "" {
		writeError(w, http.StatusBadRequest, "url, title and content are required")
		return
	}

	doc := PageDocument{
		URL:     req.URL,
		Title:   req.Title,
		Content: req.Content,
	}

	if err := h.indexer.AddDocument(doc); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to index document")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"status": "indexed"})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
