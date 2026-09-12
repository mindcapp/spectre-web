package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

type ResolveResponse struct {
	Domain    string `json:"domain"`
	TargetURL string `json:"target_url"`
	IsActive  bool   `json:"is_active"`
}

type cacheEntry struct {
	targetURL string
	expiresAt time.Time
}

type DomainResolver struct {
	registryURL string
	httpClient  *http.Client
	cache       sync.Map
	ttl         time.Duration
}

func NewDomainResolver(registryURL string, ttl time.Duration) *DomainResolver {
	r := &DomainResolver{
		registryURL: registryURL,
		httpClient: &http.Client{
			Timeout: 3 * time.Second,
		},
		ttl: ttl,
	}
	go r.startCleanupWorker(5 * time.Minute)
	return r
}

func (r *DomainResolver) Resolve(domain string) (string, error) {

	if val, ok := r.cache.Load(domain); ok {
		entry := val.(cacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.targetURL, nil
		}
		r.cache.Delete(domain)
	}

	reqURL := fmt.Sprintf("%s/internal/resolve?domain=%s", r.registryURL, url.QueryEscape(domain))
	resp, err := r.httpClient.Get(reqURL)
	if err != nil {

		if domain == "test.spec" {
			log.Printf("[RESOLVER] Registry unavailable, using dev fallback for %s", domain)
			return "http://localhost:3000", nil
		}
		return "", fmt.Errorf("registry connection error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return "", fmt.Errorf("domain %s not registered", domain)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registry returned status %d", resp.StatusCode)
	}

	var data ResolveResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", fmt.Errorf("malformed registry response: %w", err)
	}

	if !data.IsActive {
		return "", fmt.Errorf("domain %s is inactive", domain)
	}

	r.cache.Store(domain, cacheEntry{
		targetURL: data.TargetURL,
		expiresAt: time.Now().Add(r.ttl),
	})

	return data.TargetURL, nil
}

func (r *DomainResolver) startCleanupWorker(interval time.Duration) {
	ticker := time.NewTicker(interval)
	for range ticker.C {
		now := time.Now()
		r.cache.Range(func(key, value any) bool {
			if entry, ok := value.(cacheEntry); ok && now.After(entry.expiresAt) {
				r.cache.Delete(key)
			}
			return true
		})
	}
}

func main() {
	resolver := NewDomainResolver("http://localhost:8081", 2*time.Minute)

	http.HandleFunc("/proxy/", func(w http.ResponseWriter, r *http.Request) {

		path := strings.TrimPrefix(r.URL.Path, "/proxy/")
		parts := strings.SplitN(path, "/", 2)
		domain := parts[0]

		if domain == "" {
			http.Error(w, "missing domain in proxy path", http.StatusBadRequest)
			return
		}

		targetURL, err := resolver.Resolve(domain)
		if err != nil {
			log.Printf("[PROXY] Resolution failed for %s: %v", domain, err)
			http.Error(w, fmt.Sprintf("Gateway error: %v", err), http.StatusBadGateway)
			return
		}

		target, err := url.Parse(targetURL)
		if err != nil {
			http.Error(w, "invalid target URL", http.StatusInternalServerError)
			return
		}

		// обратный прокси
		proxy := httputil.NewSingleHostReverseProxy(target)
		originalDirector := proxy.Director

		proxy.Director = func(req *http.Request) {
			originalDirector(req)
			//  убираем /proxy/{domain}
			subPath := "/"
			if len(parts) > 1 {
				subPath += parts[1]
			}
			req.URL.Path = subPath
			req.Host = target.Host

			//  проксирование
			req.Header.Set("X-Forwarded-Host", r.Host)
			req.Header.Set("X-Forwarded-Proto", "http")
			req.Header.Set("X-Spectre-Proxy", "gateway-v1")
		}

		// CORS
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		proxy.ServeHTTP(w, r)
	})

	log.Println("Spectre Gateway listening on :8080...")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Gateway server error: %v", err)
	}
}
