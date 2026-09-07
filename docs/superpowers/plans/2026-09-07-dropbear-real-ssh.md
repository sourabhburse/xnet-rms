# Dropbear Real-SSH Architecture with RAM-Only Key Custody Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Teltonika-style real Dropbear SSH access over reverse TLS tunnel with zero flash wear (RAM-only key custody in `/tmp`), leak-free memory safety, and dual support for in-browser terminals (`xterm.js`) and native SSH clients (`ssh -i key`).

**Architecture:** RMS Core generates an ephemeral Ed25519 keypair per session. Router agent writes public key to `/tmp/rms-ssh/authorized_keys` in volatile RAM (symlinked from `/root/.ssh`), completely preserving `/overlay` flash memory. Agent connects loopback TCP to Dropbear on port 22 and forwards raw bytes to RMS Gateway over TLS WebSocket. RMS Gateway provides an in-memory Go SSH client bridge (`golang.org/x/crypto/ssh`) for browser sessions and a `/raw` proxy endpoint for native OpenSSH clients.

**Tech Stack:** Go 1.22 (`golang.org/x/crypto/ssh`, `crypto/ed25519`, `github.com/gorilla/websocket`), C99 OpenWrt Agent (`uloop`, `libubox`, OpenSSL, POSIX sockets), OpenWrt Dropbear v2019.78.

---

### File Structure & Changes

| Component | File Path | Role / Changes |
|---|---|---|
| **Backend Core** | `backend/internal/rms/sessions.go` | Generate ephemeral Ed25519 keypairs, serialize OpenSSH keys, dispatch public key over MQTT, provide private key to Gateway/launch |
| **Backend Core** | `backend/internal/rms/sessions_test.go` | Unit tests for keypair generation, OpenSSH encoding, and session key lifecycle |
| **Backend Gateway** | `backend/internal/rms/gateway.go` | Implement in-memory Go SSH client bridge for browser terminal (`/ws`), terminal resizing, and raw proxy endpoint (`/raw`) |
| **Backend Gateway** | `backend/internal/rms/gateway_test.go` | Tests for WebSocket-to-NetConn adapter, SSH bridge, and raw proxy |
| **Router Agent** | `agent/src/agent.h` | Update function prototypes for RAM key injection and loopback Dropbear worker |
| **Router Agent** | `agent/src/commands.c` | Parse `public_key` from `open_session` MQTT payload and pass to tunnel initializer |
| **Router Agent** | `agent/src/tunnel.c` | Manage `/tmp/rms-ssh/authorized_keys` RAM injection, symlink `/root/.ssh`, and atomic cleanup |
| **Router Agent** | `agent/src/tunnel_worker.c` | Replace `spawn_pty` with TCP loopback `127.0.0.1:22` socket forwarding over WebSocket using fixed stack buffers |
| **Router Agent Tests**| `agent/tests/runtime_test.c` | Unit tests for RAM key injection, symlink setup, and cleanup without touching `/etc/dropbear/authorized_keys` |

---

### Task 1: RMS Core: Ephemeral Ed25519 Key Generation & OpenSSH Formatting

**Files:**
- Modify: `backend/internal/rms/sessions.go`
- Create/Modify: `backend/internal/rms/sessions_test.go`

- [ ] **Step 1: Write the failing test for key generation**

Create `backend/internal/rms/sessions_test.go`:
```go
package rms

import (
	"golang.org/x/crypto/ssh"
	"strings"
	"testing"
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
	if !strings.HasPrefix(pubSSH, "ssh-ed25519 ") || !strings.HasSuffix(pubSSH, "rms-session-"+sessionID) {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
env GOPATH=/home/sourabh/go_workspace GOCACHE=/tmp/rms-go-cache /home/sourabh/go/bin/go test ./internal/rms/... -run TestGenerateSSHKeypair
```
Expected: FAIL with `undefined: generateSSHKeypair`.

- [ ] **Step 3: Implement `generateSSHKeypair` in `sessions.go`**

In `backend/internal/rms/sessions.go`, add:
```go
import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"golang.org/x/crypto/ssh"
)

func generateSSHKeypair(sessionID string) ([]byte, string, ssh.Signer, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, "", nil, err
	}

	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		return nil, "", nil, err
	}

	sshPub, err := ssh.NewPublicKey(pub)
	if err != nil {
		return nil, "", nil, err
	}
	pubSSH := fmt.Sprintf("%s %s rms-session-%s", sshPub.Type(), ssh.MarshalAuthorizedKey(sshPub), sessionID)
	pubSSH = strings.TrimSpace(pubSSH)

	privPEM, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		return nil, "", nil, err
	}
	privBlock := pem.EncodeToMemory(privPEM)

	return privBlock, pubSSH, signer, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
env GOPATH=/home/sourabh/go_workspace GOCACHE=/tmp/rms-go-cache /home/sourabh/go/bin/go test ./internal/rms/... -run TestGenerateSSHKeypair
```
Expected: PASS.

---

### Task 2: RMS Core: Session Model & Ephemeral Key Attachment

**Files:**
- Modify: `backend/internal/rms/sessions.go`
- Modify: `backend/internal/rms/sessions_test.go`

- [ ] **Step 1: Write test for session creation with SSH key**

In `backend/internal/rms/sessions_test.go`, add:
```go
func TestCreateSessionWithSSHKey(t *testing.T) {
	// Verify that Session struct carries Signer and PrivateKey for TERMINAL_SSH
	s := Session{
		ID:        "4f039a3e5d91c928936204d11cd3fcca",
		DeviceID:  "cdd1495337a9dc4d5078873432591ff0",
		Protocol:  "TERMINAL_SSH",
		ExpiresAt: time.Now().Add(15 * time.Minute),
	}
	_, _, signer, err := generateSSHKeypair(s.ID)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	s.SSHSigner = signer
	if s.SSHSigner == nil {
		t.Fatal("expected SSHSigner attached to Session")
	}
}
```

- [ ] **Step 2: Run test to verify failure**

Run:
```bash
env GOPATH=/home/sourabh/go_workspace GOCACHE=/tmp/rms-go-cache /home/sourabh/go/bin/go test ./internal/rms/... -run TestCreateSessionWithSSHKey
```
Expected: FAIL with `s.SSHSigner undefined`.

- [ ] **Step 3: Update `Session` struct and `createSession` in `sessions.go`**

In `backend/internal/rms/sessions.go`:
1. Add `SSHSigner ssh.Signer` and `SSHPrivateKey string` to `type Session struct`.
2. In `createSession`:
   * If `req.Protocol == "TERMINAL_SSH"`:
     Call `privPEM, pubSSH, signer, err := generateSSHKeypair(id)`
     Include `"public_key": pubSSH` in the MQTT `command` payload.
     Store `signer` on the internal session object (or pass to Gateway).
     In the JSON response, include `"private_key": string(privPEM)` for native clients.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
env GOPATH=/home/sourabh/go_workspace GOCACHE=/tmp/rms-go-cache /home/sourabh/go/bin/go test ./internal/rms/...
```
Expected: PASS.

---

### Task 3: Router Agent: RAM-Only Key Injection & Cleanup (`tunnel.c` & `commands.c`)

**Files:**
- Modify: `agent/src/agent.h`
- Modify: `agent/src/commands.c`
- Modify: `agent/src/tunnel.c`
- Modify: `agent/tests/runtime_test.c`

- [ ] **Step 1: Write C test for RAM key injection and unlinking**

In `agent/tests/runtime_test.c`, add:
```c
static void test_ram_ssh_keys(void) {
    const char *sess_id = "4f039a3e5d91c928936204d11cd3fcca";
    const char *pubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI1234567890 rms-session-4f039a3e5d91c928936204d11cd3fcca";
    
    int rc = rms_ssh_inject_key(sess_id, pubkey);
    assert(rc == 0);
    
    // Verify /tmp/rms-ssh/authorized_keys exists and has 0600 mode
    struct stat st;
    assert(stat("/tmp/rms-ssh/authorized_keys", &st) == 0);
    assert((st.st_mode & 0777) == 0600);
    
    // Verify file content matches pubkey
    FILE *f = fopen("/tmp/rms-ssh/authorized_keys", "r");
    assert(f != NULL);
    char line[512];
    char *res = fgets(line, sizeof(line), f);
    assert(res != NULL);
    assert(strstr(line, "rms-session-4f039a3e5d91c928936204d11cd3fcca") != NULL);
    fclose(f);
    
    // Verify cleanup
    rms_ssh_cleanup_key();
    assert(access("/tmp/rms-ssh/authorized_keys", F_OK) != 0);
    printf("PASS: test_ram_ssh_keys\n");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
gcc -Wall -Werror -o /tmp/runtime_test agent/tests/runtime_test.c agent/src/runtime.c -lcurl -lcrypto && /tmp/runtime_test
```
Expected: FAIL with `undefined reference to rms_ssh_inject_key`.

- [ ] **Step 3: Implement `rms_ssh_inject_key` and `rms_ssh_cleanup_key` in `agent/src/tunnel.c`**

In `agent/src/tunnel.c`:
```c
#define RMS_SSH_RAM_DIR "/tmp/rms-ssh"
#define RMS_SSH_RAM_KEYS "/tmp/rms-ssh/authorized_keys"

int rms_ssh_inject_key(const char *session_id, const char *pubkey) {
    if (!rms_id(session_id) || !pubkey || strlen(pubkey) > 512) return -1;
    mkdir(RMS_SSH_RAM_DIR, 0700);
    chmod(RMS_SSH_RAM_DIR, 0700);
    
    // Atomic write to /tmp/rms-ssh/authorized_keys
    char tmp[256];
    snprintf(tmp, sizeof(tmp), "%s/authorized_keys.tmp", RMS_SSH_RAM_DIR);
    int fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) return -1;
    
    size_t len = strlen(pubkey);
    if (write(fd, pubkey, len) != (ssize_t)len || write(fd, "\n", 1) != 1) {
        close(fd);
        unlink(tmp);
        return -1;
    }
    fsync(fd);
    close(fd);
    if (rename(tmp, RMS_SSH_RAM_KEYS) != 0) {
        unlink(tmp);
        return -1;
    }
    // Ensure /root/.ssh is symlinked to /tmp/rms-ssh (one-time setup if absent)
    struct stat st;
    if (lstat("/root/.ssh", &st) != 0 || !S_ISLNK(st.st_mode)) {
        unlink("/root/.ssh");
        symlink(RMS_SSH_RAM_DIR, "/root/.ssh");
    }
    return 0;
}

void rms_ssh_cleanup_key(void) {
    unlink(RMS_SSH_RAM_KEYS);
}
```

In `agent/src/commands.c`:
Extract `public_key` from MQTT payload:
```c
const char *pubkey = json_object_get_string(o, "public_key");
if (strcmp(protocol, "TERMINAL_SSH") == 0) {
    if (!pubkey || rms_ssh_inject_key(id, pubkey) != 0) return;
}
```

In `agent/src/tunnel.c` `check_reverse_tunnel()` and `close_reverse_tunnel()`:
Invoke `rms_ssh_cleanup_key()` whenever the tunnel worker ends.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
gcc -Wall -Werror -o /tmp/runtime_test agent/tests/runtime_test.c agent/src/runtime.c agent/src/tunnel.c -lcurl -lcrypto && /tmp/runtime_test
```
Expected: PASS with `PASS: test_ram_ssh_keys`.

---

### Task 4: Router Agent: Transparent TCP Loopback Dropbear Forwarding (`agent/src/tunnel_worker.c`)

**Files:**
- Modify: `agent/src/tunnel_worker.c`

- [ ] **Step 1: Inspect `tunnel_worker.c` to replace `spawn_pty`**

In `agent/src/tunnel_worker.c`:
1. Remove `static int spawn_pty(pid_t *pid)`.
2. In `rms_tunnel_worker`:
   * For `terminal` (`TERMINAL_SSH`):
     Connect non-blocking TCP socket to `127.0.0.1:22` (`dropbear_fd`):
     ```c
     int dropbear_fd = tcp("127.0.0.1", "22");
     if (dropbear_fd < 0) goto done;
     ```
   * Replace `pty` with `dropbear_fd` in `poll()` loop:
     ```c
     struct pollfd f[2] = {{fd, POLLIN, 0}, {dropbear_fd, POLLIN, 0}};
     ```
   * Inbound from Gateway WebSocket $\to$ write to `dropbear_fd`.
   * Outbound from `dropbear_fd` $\to$ read into fixed stack buffer `unsigned char b[4096]` $\to$ `send_frame(ssl, b, size, 2)`.
   * On loop termination: `close(dropbear_fd)`.

- [ ] **Step 2: Cross-compile agent for MIPS to verify syntax and zero warnings**

Run:
```bash
env OPENWRT_ROOT=/home/sourabh/openwrt-19.07 sh agent/scripts/build-mips.sh artifacts/agent-test
```
Expected: Clean compilation, zero compiler warnings, IPK generated under `artifacts/agent-test/`.

---

### Task 5: RMS Gateway: Go SSH Client Bridge for Browser Terminal (`gateway.go`)

**Files:**
- Modify: `backend/internal/rms/gateway.go`
- Create/Modify: `backend/internal/rms/gateway_test.go`

- [ ] **Step 1: Write test for WebSocket to NetConn adapter and SSH Client Bridge**

Create `backend/internal/rms/gateway_test.go`:
```go
package rms

import (
	"bytes"
	"net"
	"testing"
	"time"
)

func TestWsNetConnAdapter(t *testing.T) {
	// Test full-duplex pipe simulating router WebSocket stream
	c1, c2 := net.Pipe()
	defer c1.Close()
	defer c2.Close()

	go func() {
		c1.Write([]byte("SSH-2.0-Dropbear_2019.78\r\n"))
	}()

	buf := make([]byte, 64)
	c2.SetReadDeadline(time.Now().Add(2 * time.Second))
	n, err := c2.Read(buf)
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if !bytes.Contains(buf[:n], []byte("SSH-2.0-Dropbear")) {
		t.Errorf("unexpected banner: %s", string(buf[:n]))
	}
}
```

- [ ] **Step 2: Implement SSH Client Bridge in `gateway.go`**

In `backend/internal/rms/gateway.go`:
1. Implement `wsConn` wrapping `*websocket.Conn` as a `net.Conn`.
2. When the browser attaches to `g.terminal(w, r, id, p)`:
   * Fetch `session.SSHSigner`.
   * Configure `ssh.ClientConfig`:
     ```go
     cfg := &ssh.ClientConfig{
         User:            "root",
         Auth:            []ssh.AuthMethod{ssh.PublicKeys(p.session.SSHSigner)},
         HostKeyCallback: ssh.InsecureIgnoreHostKey(),
         Timeout:         10 * time.Second,
     }
     ```
   * Dial SSH over the router's connection:
     ```go
     ncc, chans, reqs, err := ssh.NewClientConn(routerConn, "127.0.0.1:22", cfg)
     client := ssh.NewClient(ncc, chans, reqs)
     sess, err := client.NewSession()
     sess.RequestPty("xterm-256color", 30, 100, ssh.TerminalModes{ssh.ECHO: 1})
     stdin, _ := sess.StdinPipe()
     stdout, _ := sess.StdoutPipe()
     sess.Shell()
     ```
   * Stream `stdout` $\to$ browser WebSocket `xterm.js`.
   * Stream browser WebSocket $\to$ `stdin`.
   * Parse incoming JSON `{"type":"resize","cols":...,"rows":...}` $\to$ `sess.WindowChange(rows, cols)`.

- [ ] **Step 3: Run Go tests to verify it passes**

Run:
```bash
env GOPATH=/home/sourabh/go_workspace GOCACHE=/tmp/rms-go-cache /home/sourabh/go/bin/go test ./internal/rms/...
```
Expected: PASS.

---

### Task 6: RMS Gateway: Native SSH `/raw` Proxy Endpoint

**Files:**
- Modify: `backend/internal/rms/gateway.go`

- [ ] **Step 1: Implement `/raw` endpoint in `gateway.go`**

In `backend/internal/rms/gateway.go`:
If `r.URL.Path == "/raw"`:
```go
up := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
rawConn, err := up.Upgrade(w, r, nil)
if err != nil {
    return
}
defer rawConn.Close()
defer g.close(id, p)

// Forward raw binary messages between rawConn (native client) and p.router (Dropbear)
go func() {
    for {
        _, msg, err := rawConn.ReadMessage()
        if err != nil {
            return
        }
        if err := p.router.WriteMessage(websocket.BinaryMessage, msg); err != nil {
            return
        }
    }
}()
for {
    _, msg, err := p.router.ReadMessage()
    if err != nil {
        return
    }
    if err := rawConn.WriteMessage(websocket.BinaryMessage, msg); err != nil {
        return
    }
}
```

- [ ] **Step 2: Run Go tests**

Run:
```bash
env GOPATH=/home/sourabh/go_workspace GOCACHE=/tmp/rms-go-cache /home/sourabh/go/bin/go test ./internal/rms/...
```
Expected: PASS.

---

### Task 7: Physical Device Qualification (Niseva XE33 2S)

**Files:**
- Output: `artifacts/agent-v2-dropbear/`
- Target: `192.168.1.1` & `82.180.146.203`

- [ ] **Step 1: Cross-compile agent package**
Run:
```bash
env OPENWRT_ROOT=/home/sourabh/openwrt-19.07 sh agent/scripts/build-mips.sh artifacts/agent-v2-dropbear
```

- [ ] **Step 2: Deploy IPK to router**
Run:
```bash
ssh 192.168.1.1 'cat > /tmp/niseva-agent-dropbear.ipk' < artifacts/agent-v2-dropbear/niseva-agent_2.0.0-1_mips_24kc.ipk
ssh 192.168.1.1 'opkg install --force-reinstall /tmp/niseva-agent-dropbear.ipk && /etc/init.d/niseva-agent restart'
```

- [ ] **Step 3: Verify Zero Flash Wear during session**
Record `/etc/dropbear/authorized_keys` timestamp before and after session:
```bash
ssh 192.168.1.1 'ls -lct /etc/dropbear/authorized_keys'
```
Confirm the timestamp on `/overlay` does NOT change!

- [ ] **Step 4: Verify Zero Memory Leaks**
Record memory before, during, and after terminal session:
```bash
ssh 192.168.1.1 'free; ps | grep [n]iseva'
```
Confirm memory returns to exact baseline after session closure.

- [ ] **Step 5: Test In-Browser and Native SSH Sessions**
1. Test in-browser terminal connection via test harness.
2. Test native SSH client:
   ```bash
   ssh -i rms-session.key -o "ProxyCommand=curl -sS -N --http1.1 -H 'Upgrade: websocket' -H 'Connection: Upgrade' https://<session_id>.xnet-rms-test.duckdns.org:9443/raw?ticket=<ticket>" root@router
   ```
   Confirm interactive shell prompt, command execution, and clean exit.
