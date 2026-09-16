package rms

import (
	"database/sql"
	"errors"
)

type identityOwner struct {
	Kind string
	ID   string
}

func identityOwnerFor(tx *sql.Tx, kind, value string) (*identityOwner, error) {
	var ownerKind, ownerID string
	err := tx.QueryRow(`SELECT CASE WHEN device_id IS NOT NULL THEN 'device'
        WHEN pending_id IS NOT NULL THEN 'pending' ELSE 'registration' END,
        COALESCE(device_id, pending_id, registration_id)
        FROM identity_claims WHERE kind=$1 AND value=$2`, kind, value).Scan(&ownerKind, &ownerID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &identityOwner{Kind: ownerKind, ID: ownerID}, nil
}

func insertIdentityClaim(tx *sql.Tx, kind, value, ownerKind, ownerID string) error {
	if value == "" {
		return nil
	}
	var query string
	switch ownerKind {
	case "device":
		query = "INSERT INTO identity_claims(kind,value,device_id) VALUES($1,$2,$3)"
	case "pending":
		query = "INSERT INTO identity_claims(kind,value,pending_id) VALUES($1,$2,$3)"
	case "registration":
		query = "INSERT INTO identity_claims(kind,value,registration_id) VALUES($1,$2,$3)"
	default:
		return errors.New("invalid identity owner")
	}
	_, err := tx.Exec(query, kind, value, ownerID)
	return err
}

func insertIdentityClaims(tx *sql.Tx, ownerKind, ownerID string, claims map[string]string) error {
	for kind, value := range claims {
		if err := insertIdentityClaim(tx, kind, value, ownerKind, ownerID); err != nil {
			return err
		}
	}
	return nil
}

// ensureIdentityClaims adds newly observed claims while preserving ownership
// of claims already attached to the same object. Enrollment is serialized by
// the advisory lock, so the check and insert are one logical operation.
func ensureIdentityClaims(tx *sql.Tx, ownerKind, ownerID string, claims map[string]string) error {
	for kind, value := range claims {
		if value == "" {
			continue
		}
		owner, err := identityOwnerFor(tx, kind, value)
		if err != nil {
			return err
		}
		if owner != nil {
			if owner.Kind != ownerKind || owner.ID != ownerID {
				return errors.New("identity_conflict")
			}
			continue
		}
		if err := insertIdentityClaim(tx, kind, value, ownerKind, ownerID); err != nil {
			return err
		}
	}
	return nil
}

func deleteIdentityClaims(tx *sql.Tx, ownerKind, ownerID string) error {
	column := map[string]string{"device": "device_id", "pending": "pending_id", "registration": "registration_id"}[ownerKind]
	if column == "" {
		return errors.New("invalid identity owner")
	}
	_, err := tx.Exec("DELETE FROM identity_claims WHERE "+column+"=$1", ownerID)
	return err
}

func transferIdentityClaims(tx *sql.Tx, fromKind, fromID, deviceID string) error {
	column := map[string]string{"pending": "pending_id", "registration": "registration_id"}[fromKind]
	if column == "" {
		return errors.New("identity transfer must start from pending or registration")
	}
	_, err := tx.Exec("UPDATE identity_claims SET device_id=$1,pending_id=NULL,registration_id=NULL WHERE "+column+"=$2", deviceID, fromID)
	return err
}

func identityClaimsConflict(tx *sql.Tx, claims map[string]string, allowOwner *identityOwner) error {
	for kind, value := range claims {
		owner, err := identityOwnerFor(tx, kind, value)
		if err != nil {
			return err
		}
		if owner == nil {
			continue
		}
		if allowOwner == nil || owner.Kind != allowOwner.Kind || owner.ID != allowOwner.ID {
			return errors.New("identity_conflict")
		}
	}
	return nil
}

func requestIdentifierMap(identifiers map[string]string, legacyMAC string) map[string]string {
	out := make(map[string]string, len(identifiers)+1)
	for kind, value := range identifiers {
		out[kind] = value
	}
	if out["mac"] == "" && legacyMAC != "" {
		out["mac"] = legacyMAC
	}
	return out
}
