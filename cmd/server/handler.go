package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/mindcapp/spectre-web/pkg/models"
)

type RegistryHandler struct{ repository DomainRepository }

func NewRegistryHandler(repository DomainRepository) http.Handler {
	h := &RegistryHandler{repository: repository}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/domains/register", h.register)
	mux.HandleFunc("/internal/resolve", h.resolve)
	mux.HandleFunc("/internal/domains", h.listActive)
	return mux
}

func (h *RegistryHandler) register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var request models.RegisterDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	request.TargetURL = strings.TrimSpace(request.TargetURL)
	if !validDomainName(request.Name) {
		writeError(w, http.StatusBadRequest, "invalid domain name")
		return
	}
	parsed, err := url.ParseRequestURI(request.TargetURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		writeError(w, http.StatusBadRequest, "invalid target_url")
		return
	}

	domain := models.Domain{Name: request.Name, TargetURL: request.TargetURL, IsActive: true}
	if err := h.repository.Register(domain); err != nil {
		if errors.Is(err, ErrDomainExists) {
			writeError(w, http.StatusConflict, ErrDomainExists.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to register domain")
		return
	}
	writeJSON(w, http.StatusCreated, domain)
}

func (h *RegistryHandler) resolve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("domain"))
	if name == "" {
		writeError(w, http.StatusBadRequest, "domain is required")
		return
	}
	domain, err := h.repository.Resolve(name)
	if err != nil {
		if errors.Is(err, ErrDomainNotFound) {
			writeError(w, http.StatusNotFound, ErrDomainNotFound.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to resolve domain")
		return
	}
	writeJSON(w, http.StatusOK, domain)
}

func (h *RegistryHandler) listActive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	domains, err := h.repository.ListActive()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list domains")
		return
	}
	writeJSON(w, http.StatusOK, domains)
}

func validDomainName(name string) bool {
	if len(name) == 0 || len(name) > 253 || strings.HasPrefix(name, ".") || strings.HasSuffix(name, ".") {
		return false
	}
	for _, label := range strings.Split(name, ".") {
		if label == "" || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, character := range label {
			if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') &&
				(character < '0' || character > '9') && character != '-' {
				return false
			}
		}
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

var _ context.Context
