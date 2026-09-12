package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mindcapp/spectre-web/pkg/models"
)

type fakeDomainRepository struct {
	domains map[string]models.Domain
}

func (f *fakeDomainRepository) Register(_ context.Context, domain models.Domain) error {
	if _, exists := f.domains[domain.Name]; exists {
		return ErrDomainExists
	}
	f.domains[domain.Name] = domain
	return nil
}

func (f *fakeDomainRepository) Resolve(_ context.Context, name string) (models.Domain, error) {
	domain, exists := f.domains[name]
	if !exists || !domain.IsActive {
		return models.Domain{}, ErrDomainNotFound
	}
	return domain, nil
}

func (f *fakeDomainRepository) ListActive(_ context.Context) ([]models.Domain, error) {
	result := make([]models.Domain, 0)
	for _, domain := range f.domains {
		if domain.IsActive {
			result = append(result, domain)
		}
	}
	return result, nil
}

func TestRegisterDomain(t *testing.T) {
	repository := &fakeDomainRepository{domains: make(map[string]models.Domain)}
	handler := NewRegistryHandler(repository)

	request := httptest.NewRequest(http.MethodPost, "/api/domains/register",
		strings.NewReader(`{"name":"test.spec","target_url":"http://example.com"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, response.Code)
	}
	if !repository.domains["test.spec"].IsActive {
		t.Fatal("new domain should be active")
	}
}

func TestRegisterDuplicateDomain(t *testing.T) {
	repository := &fakeDomainRepository{domains: map[string]models.Domain{
		"test.spec": {Name: "test.spec", TargetURL: "http://old.example", IsActive: true},
	}}
	handler := NewRegistryHandler(repository)

	request := httptest.NewRequest(http.MethodPost, "/api/domains/register",
		strings.NewReader(`{"name":"test.spec","target_url":"http://example.com"}`))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("expected status %d, got %d", http.StatusConflict, response.Code)
	}
}

func TestResolveDomain(t *testing.T) {
	repository := &fakeDomainRepository{domains: map[string]models.Domain{
		"test.spec": {Name: "test.spec", TargetURL: "http://example.com", IsActive: true},
	}}
	handler := NewRegistryHandler(repository)

	request := httptest.NewRequest(http.MethodGet, "/internal/resolve?domain=test.spec", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	var result models.Domain
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || result.TargetURL != "http://example.com" {
		t.Fatalf("unexpected resolve response: status=%d, result=%+v", response.Code, result)
	}
}

func TestResolveUnknownDomain(t *testing.T) {
	repository := &fakeDomainRepository{domains: make(map[string]models.Domain)}
	handler := NewRegistryHandler(repository)

	request := httptest.NewRequest(http.MethodGet, "/internal/resolve?domain=unknown.spec", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, response.Code)
	}
}

func TestListActiveDomains(t *testing.T) {
	repository := &fakeDomainRepository{domains: map[string]models.Domain{
		"active.spec":   {Name: "active.spec", TargetURL: "http://active.example", IsActive: true},
		"inactive.spec": {Name: "inactive.spec", TargetURL: "http://inactive.example", IsActive: false},
	}}
	handler := NewRegistryHandler(repository)

	request := httptest.NewRequest(http.MethodGet, "/internal/domains", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	var result []models.Domain
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || len(result) != 1 || result[0].Name != "active.spec" {
		t.Fatalf("unexpected active domains response: status=%d, result=%+v", response.Code, result)
	}
}
