package search

import (
	"github.com/meilisearch/meilisearch-go"
)

type Indexer struct {
	client meilisearch.ServiceManager
}

func NewIndexer(host, apiKey string) (*Indexer, error) {
	c := meilisearch.New(host, meilisearch.WithAPIKey(apiKey))
	return &Indexer{client: c}, nil
}

func (i *Indexer) CreateIndexIfNotExists() error {
	_, err := i.client.Index("pages").FetchInfo()
	if err != nil {
		_, createErr := i.client.CreateIndex(&meilisearch.IndexConfig{
			Uid:        "pages",
			PrimaryKey: "id",
		})
		if createErr != nil {
			return createErr
		}
	}
	return nil
}

func (i *Indexer) AddDocument(doc PageDocument) error {
	doc.ID = doc.URL
	_, err := i.client.Index("pages").AddDocuments([]PageDocument{doc}, &meilisearch.DocumentOptions{
		PrimaryKey: meilisearch.StringPtr("id"),
	})
	return err
}

func (i *Indexer) AddDocuments(docs []PageDocument) error {
	for _, doc := range docs {
		doc.ID = doc.URL
	}
	_, err := i.client.Index("pages").AddDocuments(docs, &meilisearch.DocumentOptions{
		PrimaryKey: meilisearch.StringPtr("id"),
	})
	return err
}

func (i *Indexer) Search(query string) ([]PageDocument, error) {
	req := &meilisearch.SearchRequest{
		Limit:                10,
		Query:                query,
		AttributesToRetrieve: []string{"url", "title", "content"},
		AttributesToCrop:     []string{"content"},
		CropLength:           150,
		CropMarker:           "...",
	}
	resp, err := i.client.Index("pages").Search(query, req)
	if err != nil {
		return nil, err
	}

	var results []PageDocument
	if err := resp.Hits.DecodeInto(&results); err != nil {
		return nil, err
	}

	return results, nil
}
