package rms

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"net"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestWsNetConnAdapter(t *testing.T) {
	pr, pw := io.Pipe()
	defer pr.Close()
	defer pw.Close()

	initial := []byte("SSH-2.0-Dropbear_2019.78\r\n")
	conn := &wsNetConn{
		r: io.MultiReader(bytes.NewReader(initial), pr),
		p: &Pair{},
	}

	buf := make([]byte, 64)
	n, err := conn.Read(buf)
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if !bytes.Contains(buf[:n], []byte("SSH-2.0-Dropbear")) {
		t.Errorf("unexpected banner: %s", string(buf[:n]))
	}

	if conn.LocalAddr().String() != "127.0.0.1:0" {
		t.Errorf("unexpected LocalAddr: %s", conn.LocalAddr().String())
	}
	if conn.RemoteAddr().String() != "127.0.0.1:22" {
		t.Errorf("unexpected RemoteAddr: %s", conn.RemoteAddr().String())
	}
}

func TestSSHClientBridgeHandshake(t *testing.T) {
	// Generate server host key
	_, serverPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("host key gen failed: %v", err)
	}
	serverSigner, err := ssh.NewSignerFromKey(serverPriv)
	if err != nil {
		t.Fatalf("signer failed: %v", err)
	}

	// Generate client key
	clientPub, clientPriv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("client key gen failed: %v", err)
	}
	clientSigner, err := ssh.NewSignerFromKey(clientPriv)
	if err != nil {
		t.Fatalf("client signer failed: %v", err)
	}
	clientSSHPub, err := ssh.NewPublicKey(clientPub)
	if err != nil {
		t.Fatalf("client ssh pubkey failed: %v", err)
	}

	serverConfig := &ssh.ServerConfig{
		PublicKeyCallback: func(conn ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if bytes.Equal(key.Marshal(), clientSSHPub.Marshal()) {
				return nil, nil
			}
			return nil, ssh.ErrNoAuth
		},
	}
	serverConfig.AddHostKey(serverSigner)

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}
	defer l.Close()

	serverDone := make(chan struct{})
	go func() {
		defer close(serverDone)
		c1, err := l.Accept()
		if err != nil {
			return
		}
		defer c1.Close()

		sConn, chans, reqs, sErr := ssh.NewServerConn(c1, serverConfig)
		if sErr != nil {
			t.Errorf("server handshake failed: %v", sErr)
			return
		}
		defer sConn.Close()
		go ssh.DiscardRequests(reqs)

		for newChannel := range chans {
			if newChannel.ChannelType() != "session" {
				newChannel.Reject(ssh.UnknownChannelType, "unknown channel type")
				continue
			}
			channel, requests, cErr := newChannel.Accept()
			if cErr != nil {
				t.Errorf("accept channel failed: %v", cErr)
				return
			}
			defer channel.Close()

			go func() {
				for req := range requests {
					switch req.Type {
					case "pty-req":
						req.Reply(true, nil)
					case "shell":
						req.Reply(true, nil)
						channel.Write([]byte("root@router:~# "))
					default:
						req.Reply(false, nil)
					}
				}
			}()

			buf := make([]byte, 128)
			n, _ := channel.Read(buf)
			if string(buf[:n]) == "uname -a\n" {
				channel.Write([]byte("Linux router 5.4.0 mips\r\n"))
			}
			return
		}
	}()

	c2, err := net.Dial("tcp", l.Addr().String())
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer c2.Close()

	clientConfig := &ssh.ClientConfig{
		User:            "root",
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(clientSigner)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	}

	ncc, chans, reqs, err := ssh.NewClientConn(c2, "127.0.0.1:22", clientConfig)
	if err != nil {
		t.Fatalf("client handshake failed: %v", err)
	}
	client := ssh.NewClient(ncc, chans, reqs)
	defer client.Close()

	sess, err := client.NewSession()
	if err != nil {
		t.Fatalf("client session failed: %v", err)
	}
	defer sess.Close()

	if err := sess.RequestPty("xterm-256color", 30, 100, ssh.TerminalModes{ssh.ECHO: 1}); err != nil {
		t.Fatalf("request pty failed: %v", err)
	}

	stdin, err := sess.StdinPipe()
	if err != nil {
		t.Fatalf("stdin failed: %v", err)
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		t.Fatalf("stdout failed: %v", err)
	}

	if err := sess.Shell(); err != nil {
		t.Fatalf("shell failed: %v", err)
	}

	buf := make([]byte, 128)
	n, err := stdout.Read(buf)
	if err != nil {
		t.Fatalf("stdout read prompt failed: %v", err)
	}
	if !bytes.Contains(buf[:n], []byte("root@router")) {
		t.Errorf("expected prompt, got: %s", string(buf[:n]))
	}

	if _, err := stdin.Write([]byte("uname -a\n")); err != nil {
		t.Fatalf("stdin write failed: %v", err)
	}

	n, err = stdout.Read(buf)
	if err != nil {
		t.Fatalf("stdout read response failed: %v", err)
	}
	if !bytes.Contains(buf[:n], []byte("Linux router")) {
		t.Errorf("expected Linux router, got: %s", string(buf[:n]))
	}

	<-serverDone
}
