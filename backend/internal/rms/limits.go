package rms

import (
	"net"
	"sync"
	"time"
)

type entryWindow struct {
	start time.Time
	count int
}
type entryLimiter struct {
	mu      sync.Mutex
	entries map[string]entryWindow
}

func newEntryLimiter() *entryLimiter { return &entryLimiter{entries: map[string]entryWindow{}} }
func (l *entryLimiter) allow(address string, now time.Time) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		host = address
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.entries) >= 10000 {
		for key, v := range l.entries {
			if now.Sub(v.start) >= time.Minute {
				delete(l.entries, key)
			}
		}
	}
	v, exists := l.entries[host]
	if !exists && len(l.entries) >= 10000 {
		return false
	}
	if now.Sub(v.start) >= time.Minute {
		v = entryWindow{start: now}
	}
	if v.count >= 120 {
		return false
	}
	v.count++
	l.entries[host] = v
	return true
}
func (s *Core) mutateAudit(org, user, action, id, query string, args ...any) error {
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.Exec(query, args...); e != nil {
		return e
	}
	if e = audit(tx, org, user, action, id); e != nil {
		return e
	}
	return tx.Commit()
}
