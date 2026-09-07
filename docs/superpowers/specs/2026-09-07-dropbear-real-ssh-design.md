# Teltonika-Style Dropbear Real-SSH Architecture Specification

**Status:** Approved Design  
**Date:** 2026-09-07  
**Author:** Pair Programming Agent & Platform Owner  
**Target:** Stage 1 Real-SSH Architecture (Dropbear Reverse Tunnel with RAM-Only Key Custody)  
**Hardware Reference:** Niseva XE33 2S (MIPS 24kc, QCA9533, OpenWrt 19.07, 128 MB RAM, 16 MB SPI Flash)

---

## 1. Executive Summary & Intent

This specification defines the architectural transition from direct agent `/bin/ash` PTY spawning to native **Dropbear SSH server** access over an authenticated reverse TLS tunnel. 

### Core Goals
1. **Real SSH Experience**: Dropbear handles authentication, PTY allocation, session initialization, and shell management. Native SSH tools (`ssh`, `scp`, `sftp`, `rsync`) work alongside in-browser terminals (`xterm.js`).
2. **Zero Flash Wear (RAM-Only Key Custody)**: Ephemeral session keys are managed exclusively in volatile RAM (`tmpfs` at `/tmp`). No writes occur to `/overlay` during session establishment or teardown, completely preserving the 16 MB SPI flash endurance.
3. **Zero Memory Leaks & Minimal RAM Footprint**:
   * Router Agent (`niseva-agent`) uses fixed-size stack buffers for loopback TCP forwarding.
   * Dropbear's per-connection memory (~1.08 MB) is consumed only during an active session and is completely freed upon disconnection.
4. **Permanent Key Isolation**: Existing administrator keys in `/etc/dropbear/authorized_keys` remain untouched on persistent storage.

---

## 2. System Architecture & Topology

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Operator (Browser or Native SSH)
    participant Core as RMS Core API (:8445)
    participant GW as RMS Gateway (:9443)
    participant MQTT as Mosquitto Broker (:8883)
    participant Agent as Router Agent (niseva-agent)
    participant Dropbear as Dropbear SSH (127.0.0.1:22)

    Operator->>Core: POST /api/v1/sessions (protocol: TERMINAL_SSH)
    Note over Core: 1. Generates Ephemeral Ed25519 Keypair<br/>2. Holds private key in RAM<br/>3. Sets 15-minute expiration
    Core->>MQTT: Publish command: open_session + public_key
    Core-->>Operator: Return launch_url (Browser) or private_key + ProxyCommand (Native)

    MQTT->>Agent: Deliver open_session payload
    Note over Agent: 1. Writes public_key to RAM (/tmp/rms-ssh/authorized_keys)<br/>2. Symlinks /root/.ssh -> /tmp/rms-ssh<br/>3. Arms 15-min autonomous watchdog
    Agent->>GW: Connect outbound TLS WebSocket (/router/{session_id})
    Agent->>Dropbear: Connect loopback TCP socket (127.0.0.1:22)

    alt Browser Terminal (xterm.js)
        Operator->>GW: Connect WebSocket /ws (session cookie)
        Note over GW: Uses in-memory private key via Go ssh.Client<br/>Establishes SSH session through router WebSocket
        GW->>Dropbear: SSH handshake & Ed25519 authentication
        GW-->>Operator: Stream xterm.js terminal I/O (ANSI)
    else Native SSH Client (OpenSSH)
        Operator->>GW: Connect via ProxyCommand to /raw
        GW->>Agent: Raw binary SSH protocol stream
        Agent->>Dropbear: Raw binary SSH protocol stream
        Note over Dropbear: Authenticates operator's downloaded private key
    end

    Note over Operator,Dropbear: Session Termination (User Close, 15m Expiry, or Network Drop)
    Agent->>Dropbear: Close loopback TCP socket (Dropbear reaps shell)
    Agent->>Agent: Unlink /tmp/rms-ssh/authorized_keys in RAM
    GW->>GW: Zero and purge ephemeral private key from memory
```

---

## 3. Component Details & Protocols

### 3.1. RMS Core API (`backend/internal/rms/sessions.go`)
* **Key Generation**: Generates an ephemeral Ed25519 keypair (`crypto/ed25519`) for each session request.
* **OpenSSH Formatting**:
  * Public key formatted as: `ssh-ed25519 <Base64Data> rms-session-<session_id>`.
  * Private key formatted as OpenSSH PEM block: `-----BEGIN OPENSSH PRIVATE KEY-----...`.
* **Database & Concurrency**:
  * Enforces maximum 25 simultaneous active sessions system-wide and exactly 1 active session per router.
  * Rejects duplicate requests with `409 Conflict ("router busy")`.
* **Payload Dispatch**:
  ```json
  {
    "action": "open_session",
    "session_id": "4f039a3e5d91c928936204d11cd3fcca",
    "protocol": "TERMINAL_SSH",
    "public_key": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... rms-session-4f039a3e5d91c928936204d11cd3fcca",
    "expires_at": 1788765400,
    "gateway_url": "https://xnet-rms-test.duckdns.org:9443"
  }
  ```

### 3.2. Router Agent (`agent/src/tunnel.c` & `tunnel_worker.c`)
* **RAM-Only Key Injection**:
  1. Creates directory `/tmp/rms-ssh` (mode `0700` in `tmpfs` RAM).
  2. Writes public key to `/tmp/rms-ssh/authorized_keys` (mode `0600`).
  3. Symlinks `/root/.ssh` $\to$ `/tmp/rms-ssh` (or ensures symlink exists).
  4. Zero writes to `/overlay` or flash storage.
* **Transparent Loopback Socket Bridge**:
  1. Replaces custom PTY allocation and `/bin/ash` execution with `connect()` to `127.0.0.1:22`.
  2. Runs a single `poll()` loop over:
     * `ssl` / `fd`: Outbound TLS WebSocket to Gateway.
     * `dropbear_fd`: Local TCP socket to Dropbear.
  3. Uses a 4 KB stack-allocated buffer for reading/writing. No dynamic heap allocations (`malloc`) inside the forwarding loop, ensuring **zero memory leaks**.
* **Key Cleanup**:
  * On socket close, worker SIGTERM, or watchdog expiry:
    1. Closes `dropbear_fd`.
    2. Unlinks `/tmp/rms-ssh/authorized_keys`.
    3. Exits worker process.

### 3.3. RMS Gateway (`backend/internal/rms/gateway.go`)
* **Browser Terminal Bridge (`/ws`)**:
  * Adapts the router WebSocket stream to an `io.ReadWriter` / `net.Conn`.
  * Initializes an in-memory `ssh.Client` using `golang.org/x/crypto/ssh` and the session's ephemeral private key.
  * Requests PTY (`xterm-256color`, 30 rows, 100 cols) and opens an interactive shell.
  * Streams browser `xterm.js` keystrokes to `stdin` and reads `stdout`/`stderr` to `xterm.js`.
  * Handles dynamic window resize events (`sess.WindowChange(rows, cols)`).
* **Native SSH Client Endpoint (`/raw`)**:
  * Exposes `wss://<session_id>.<tunnel_domain>:9443/raw?ticket=<ticket>`.
  * Provides a direct binary pipe between the native client connection and the router's Dropbear socket.

---

## 4. Security, Failsafe & Memory Guarantees

### 4.1. Zero Flash Wear Guarantee
* `/etc/dropbear/authorized_keys` is never modified or opened for writing by the agent.
* Temporary keys are written strictly to `/tmp/rms-ssh/authorized_keys`.
* `/tmp` is mounted as `tmpfs` (virtual memory). Flash erase-cycle counters remain untouched.

### 4.2. Zero Memory Leak Architecture
* In `niseva-agent`:
  * All buffer reads (`read()` / `SSL_read()`) in the forwarding loop use fixed stack buffers (`char b[4096]`).
  * No `malloc()` or string duplication occurs during continuous data streaming.
  * The session worker runs as an isolated child process (`fork()`), ensuring the OS automatically frees all process resources upon termination.
* In Dropbear:
  * Dropbear forks a per-connection process (~1.08 MB) when `127.0.0.1:22` connects.
  * When the loopback socket closes, Dropbear receives `EOF`, sends `SIGHUP` to the shell, and exits. The kernel reaps the process.

### 4.3. Autonomous Watchdog & Boot Recovery
* **Network Partition**: If the WAN cuts or the RMS server drops, the agent's local `uloop` timer terminates the worker at `expires_at` (15m max), closes the Dropbear socket, and unlinks `/tmp/rms-ssh/authorized_keys`.
* **Power Loss**: If the router abruptly loses power while an SSH session is active, the temporary key disappears automatically upon reboot because `/tmp` is in RAM.
* **Daemon Startup Sweep**: In `main()`, the agent clears any `/tmp/rms-ssh` artifacts before connecting to the cloud.

---

## 5. Verification & Test Plan

### 5.1. Automated Unit Tests
* **Go Core/Gateway**:
  * Keypair generation: Verify valid Ed25519 signatures and OpenSSH serialization.
  * Concurrency locks: Verify rejection of overlapping session requests.
  * SSH Bridge: Mock Dropbear handshake and verify PTY allocation and byte streaming.
* **C Agent**:
  * Test RAM key injection and atomic unlinking in `agent/tests/runtime_test.c`.
  * Verify `/etc/dropbear/authorized_keys` file remains unmodified.

### 5.2. Physical Device Qualification (Niseva XE33 2S)
1. **Compilation & Packaging**:
   * Build stripped MIPS package with `agent/scripts/build-mips.sh`.
   * Confirm package size remains < 25 KB and binary < 45 KB.
2. **Flash Wear Verification**:
   * Record `/overlay` file modification times before, during, and after an SSH session:
     ```sh
     ls -lct /etc/dropbear/authorized_keys
     ```
     Verify that the timestamp does not change.
3. **RAM & Leak Verification**:
   * Measure router free memory before, during, and after an SSH session:
     ```sh
     free; ps | grep -E "(dropbear|niseva)"
     ```
   * Confirm memory returns to exact baseline after session closure.
4. **Interactive Session Verification**:
   * In-Browser: Verify responsive xterm.js prompt, `top`, `logread`, and resize.
   * Native SSH: Verify `ssh -i rms-session.key ...` and `scp` file transfer.
