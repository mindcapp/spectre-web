package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

func main() {
	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {

			pathParts := strings.Split(strings.TrimPrefix(req.URL.Path, "/proxy/"), "/")
			targetDomain := pathParts[0]

			// заглушка до интеграции с базой Антона
			// маппим имя домена на локальный адрес
			targetAddr := resolveDomain(targetDomain)

			targetURL, err := url.Parse(targetAddr)
			if err != nil {
				log.Printf("Invalid target URL: %v", err)
				return
			}

			req.URL.Scheme = targetURL.Scheme
			req.URL.Host = targetURL.Host
			req.URL.Path = "/" + strings.Join(pathParts[1:], "/")
			req.Host = targetURL.Host
		},
	}

	http.HandleFunc("/proxy/", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[Gateway] Incoming request: %s", r.URL.Path)
		proxy.ServeHTTP(w, r)
	})

	log.Println("[Gateway] Server listening on :8080...")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Gateway failed: %v", err)
	}
}

func resolveDomain(domain string) string {
	// временный тест-маппинг
	routes := map[string]string{
		"test.spec": "http://localhost:3000",
	}

	if target, exists := routes[domain]; exists {
		return target
	}
	return "http://localhost:8080/404"
}
