package main

import (
	"context"
	"database/sql"
	"errors"

	"github.com/lib/pq"
	"github.com/mindcapp/spectre-web/pkg/models"
)

var (
	ErrDomainExists   = errors.New("domain already exists")
	ErrDomainNotFound = errors.New("domain not found")
)

type DomainRepository interface {
	Register(context.Context, models.Domain) error
	Resolve(context.Context, string) (models.Domain, error)
	ListActive(context.Context) ([]models.Domain, error)
}

type DomainStore struct{ db *sql.DB }

func (s *DomainStore) InitSchema(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS domains (
		name TEXT PRIMARY KEY,
		target_url TEXT NOT NULL,
		is_active BOOLEAN NOT NULL DEFAULT TRUE
	)`)
	return err
}

func (s *DomainStore) Register(ctx context.Context, domain models.Domain) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO domains (name, target_url, is_active) VALUES ($1, $2, $3)`,
		domain.Name, domain.TargetURL, domain.IsActive)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			return ErrDomainExists
		}
		return err
	}
	return nil
}

func (s *DomainStore) Resolve(ctx context.Context, name string) (models.Domain, error) {
	var domain models.Domain
	err := s.db.QueryRowContext(ctx,
		`SELECT name, target_url, is_active FROM domains WHERE name = $1 AND is_active = TRUE`, name,
	).Scan(&domain.Name, &domain.TargetURL, &domain.IsActive)
	if errors.Is(err, sql.ErrNoRows) {
		return models.Domain{}, ErrDomainNotFound
	}
	if err != nil {
		return models.Domain{}, err
	}
	return domain, nil
}

func (s *DomainStore) ListActive(ctx context.Context) ([]models.Domain, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT name, target_url, is_active FROM domains WHERE is_active = TRUE ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	domains := make([]models.Domain, 0)
	for rows.Next() {
		var domain models.Domain
		if err := rows.Scan(&domain.Name, &domain.TargetURL, &domain.IsActive); err != nil {
			return nil, err
		}
		domains = append(domains, domain)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return domains, nil
}
