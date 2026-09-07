package rms

import (
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestGenerateSSHKeypair(t *testing.T) {
	sessionID := "4f039a3e5d91c928936204d11cd3fcca"
	privPEM, pubSSH, signer, err := generateSSHKeypair(sessionID)
	if err != nil {
		t.Fatalf("generateSSHKeypair failed: %v", err)
	}
	if len(privPEM) == 0 || !strings.Contains(string(privPEM), "BEGIN OPENSSH PRIVATE KEY") {
		t.Errorf("expected OpenSSH private key PEM block, got:\n%s", string(privPEM))
	}
	if !strings.HasPrefix(pubSSH, "ssh-rsa ") || !strings.HasSuffix(pubSSH, "rms-session-"+sessionID) {
		t.Errorf("expected OpenSSH public key format, got: %s", pubSSH)
	}
	if signer == nil {
		t.Fatal("expected non-nil ssh.Signer")
	}

	// Verify the signer public key matches pubSSH
	pubKeyBytes := signer.PublicKey().Marshal()
	parsedPub, _, _, _, err := ssh.ParseAuthorizedKey([]byte(pubSSH))
	if err != nil {
		t.Fatalf("failed to parse generated public key: %v", err)
	}
	if string(pubKeyBytes) != string(parsedPub.Marshal()) {
		t.Errorf("public key mismatch between signer and authorized_keys line")
	}
}
