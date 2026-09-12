package models

type Domain struct {
	Name      string `json:"domain"`
	TargetURL string `json:"target_url"`
	IsActive  bool   `json:"is_active,omitempty"`
}

type RegisterDomainRequest struct {
	Name      string `json:"name"`
	TargetURL string `json:"target_url"`
}
