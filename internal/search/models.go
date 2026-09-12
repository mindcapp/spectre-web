package search

type PageDocument struct {
	ID      string `json:"id"`
	URL     string `json:"url"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

type IndexDocumentRequest struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

type SearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}
