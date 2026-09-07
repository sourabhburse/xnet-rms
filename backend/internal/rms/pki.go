package rms

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Authority struct {
	Certificate *x509.Certificate
	Key         *ecdsa.PrivateKey
}

func LoadAuthority(dir string) (*Authority, error) {
	b, e := os.ReadFile(filepath.Join(dir, "ca.crt"))
	if e != nil {
		return nil, e
	}
	p, _ := pem.Decode(b)
	if p == nil {
		return nil, errors.New("invalid CA PEM")
	}
	cert, e := x509.ParseCertificate(p.Bytes)
	if e != nil {
		return nil, e
	}
	b, e = os.ReadFile(filepath.Join(dir, "ca.key"))
	if e != nil {
		return nil, e
	}
	p, _ = pem.Decode(b)
	if p == nil {
		return nil, errors.New("invalid key PEM")
	}
	k, e := x509.ParseECPrivateKey(p.Bytes)
	if e != nil {
		return nil, e
	}
	if !cert.IsCA || !k.PublicKey.Equal(cert.PublicKey) {
		return nil, errors.New("CA key mismatch")
	}
	return &Authority{cert, k}, nil
}
func parseCSR(s string) (*x509.CertificateRequest, error) {
	p, _ := pem.Decode([]byte(s))
	if p == nil {
		return nil, errors.New("CSR PEM required")
	}
	c, e := x509.ParseCertificateRequest(p.Bytes)
	if e != nil {
		return nil, e
	}
	if e = c.CheckSignature(); e != nil {
		return nil, e
	}
	k, ok := c.PublicKey.(*ecdsa.PublicKey)
	if !ok || k.Curve != elliptic.P256() {
		return nil, errors.New("P-256 key required")
	}
	return c, nil
}
func (a *Authority) Issue(id string, pub any, now time.Time) (string, error) {
	if now.Before(a.Certificate.NotBefore) || now.AddDate(1, 0, 0).After(a.Certificate.NotAfter) {
		return "", errors.New("issuing CA validity insufficient")
	}
	n, e := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if e != nil {
		return "", e
	}
	c := &x509.Certificate{SerialNumber: n, Subject: pkix.Name{CommonName: id}, NotBefore: now.Add(-5 * time.Minute), NotAfter: now.AddDate(1, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, BasicConstraintsValid: true}
	b, e := x509.CreateCertificate(rand.Reader, c, a.Certificate, pub, a.Key)
	if e != nil {
		return "", e
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: b})), nil
}
func verifyProof(pub []byte, message, signature string) bool {
	k, e := x509.ParsePKIXPublicKey(pub)
	if e != nil {
		return false
	}
	ec, ok := k.(*ecdsa.PublicKey)
	if !ok {
		return false
	}
	b, e := base64.StdEncoding.DecodeString(signature)
	if e != nil {
		return false
	}
	h := sha256.Sum256([]byte(message))
	return ecdsa.VerifyASN1(ec, h[:], b)
}
func TLSConfig(dir, identity string, server bool) (*tls.Config, error) {
	ca, e := os.ReadFile(filepath.Join(dir, "ca.crt"))
	if e != nil {
		return nil, e
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		return nil, errors.New("invalid CA")
	}
	cert, e := tls.LoadX509KeyPair(filepath.Join(dir, identity+".crt"), filepath.Join(dir, identity+".key"))
	if e != nil {
		return nil, e
	}
	// Public HTTPS server trust must not authorize public-CA client identities.
	serverRoots, err := x509.SystemCertPool()
	if err != nil || serverRoots == nil {
		serverRoots = x509.NewCertPool()
	}
	serverRoots.AppendCertsFromPEM(ca)
	c := &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: serverRoots, ClientCAs: roots, Certificates: []tls.Certificate{cert}}
	if server {
		c.ClientAuth = tls.VerifyClientCertIfGiven
		if _, err := os.Stat(filepath.Join(dir, "wildcard.crt")); err == nil {
			wildcard, err := tls.LoadX509KeyPair(filepath.Join(dir, "wildcard.crt"), filepath.Join(dir, "wildcard.key"))
			if err != nil {
				return nil, err
			}
			c.Certificates = append(c.Certificates, wildcard)
		} else if !os.IsNotExist(err) {
			return nil, err
		}
	}
	return c, nil
}

// Browser session hosts authenticate with their host-only session cookie.
// Requesting a TLS client certificate here can make Chromium cancel WebSocket
// handshakes when moving between session subdomains. Keep mTLS on the router
// host; a request routed to /router on a browser TLS connection still fails
// the gateway's VerifiedChains check.
func ConfigureTunnelTLS(c *tls.Config, domain string) {
	browser := c.Clone()
	browser.ClientAuth = tls.NoClientCert
	browser.ClientCAs = nil
	browser.GetConfigForClient = nil
	c.GetConfigForClient = func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
		suffix := "." + domain
		if strings.HasSuffix(hello.ServerName, suffix) && validID(strings.TrimSuffix(hello.ServerName, suffix)) {
			return browser, nil
		}
		return nil, nil
	}
}

func InitPKI(dir string, hosts []string) error {
	if len(hosts) == 0 {
		return errors.New("server DNS names required")
	}
	if _, e := os.Stat(filepath.Join(dir, "ca.key")); e == nil {
		return errors.New("refusing to replace existing CA")
	}
	if e := os.MkdirAll(dir, 0700); e != nil {
		return e
	}
	k, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return e
	}
	now := time.Now()
	n, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	c := &x509.Certificate{SerialNumber: n, Subject: pkix.Name{CommonName: "XNET RMS installation CA"}, NotBefore: now.Add(-time.Hour), NotAfter: now.AddDate(10, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign}
	der, e := x509.CreateCertificate(rand.Reader, c, c, &k.PublicKey, k)
	if e != nil {
		return e
	}
	cert, _ := x509.ParseCertificate(der)
	key, _ := x509.MarshalECPrivateKey(k)
	if e = writePEM(dir, "ca", "CERTIFICATE", der, "EC PRIVATE KEY", key); e != nil {
		return e
	}
	a := Authority{cert, k}
	for _, id := range []string{"server", "rms-core", "rms-tunnel", "collector"} {
		child, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if e != nil {
			return e
		}
		var b []byte
		if id == "server" {
			n, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
			leaf := &x509.Certificate{SerialNumber: n, Subject: pkix.Name{CommonName: hosts[0]}, NotBefore: now.Add(-time.Hour), NotAfter: now.AddDate(1, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
			for _, h := range hosts {
				if ip := net.ParseIP(h); ip != nil {
					leaf.IPAddresses = append(leaf.IPAddresses, ip)
				} else {
					leaf.DNSNames = append(leaf.DNSNames, h)
				}
			}
			b, e = x509.CreateCertificate(rand.Reader, leaf, cert, &child.PublicKey, k)
		} else {
			var s string
			s, e = a.Issue(id, &child.PublicKey, now)
			p, _ := pem.Decode([]byte(s))
			if p != nil {
				b = p.Bytes
			}
		}
		if e != nil {
			return e
		}
		kb, _ := x509.MarshalECPrivateKey(child)
		if e = writePEM(dir, id, "CERTIFICATE", b, "EC PRIVATE KEY", kb); e != nil {
			return e
		}
		if id == "collector" {
			pub, _ := x509.MarshalPKIXPublicKey(&child.PublicKey)
			if e = os.WriteFile(filepath.Join(dir, "collector.pub"), pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub}), 0644); e != nil {
				return e
			}
		}
	}
	return nil
}
func writePEM(dir, id, ct string, c []byte, kt string, k []byte) error {
	if e := os.WriteFile(filepath.Join(dir, id+".key"), pem.EncodeToMemory(&pem.Block{Type: kt, Bytes: k}), 0600); e != nil {
		return e
	}
	return os.WriteFile(filepath.Join(dir, id+".crt"), pem.EncodeToMemory(&pem.Block{Type: ct, Bytes: c}), 0644)
}
