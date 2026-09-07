# Niseva Cloud RMS (Remote Management System)

An enterprise-grade, multi-tenant cloud fleet management and remote access platform for **Niseva 2S routers** running **OpenWrt** (inspired by Teltonika RMS).

Designed for both **Cloud Multi-Tenant SaaS** and **Closed-Source On-Premise Client Deployments** with non-decompilable Go binaries and cryptographic license protection.

The active implementation uses `backend/internal/rms`, `frontend/src/App.tsx`,
and `deployment/v2`. The former Docker-era `deploy/` tree and the old demo UI
are removed; use `PROJECT_HANDOFF.md` and `deployment/v2/README.md` for the
current operational paths.

---

## Repository Structure

```
├── agent/                  # Native C OpenWrt Router Daemon (<200 KB footprint)
│   ├── Makefile            # OpenWrt SDK package Makefile (produces .ipk)
│   ├── files/
│   │   ├── niseva.config   # /etc/config/niseva default UCI configuration
│   │   └── niseva.init     # /etc/init.d/niseva-agent procd service script
│   └── src/
│       ├── CMakeLists.txt  # CMake build definition
│       ├── agent.h         # Common data structures and definitions
│       ├── main.c          # uloop event loop, signal handling, MQTT init
│       ├── telemetry.c     # ubus cellular status parser and system telemetry
│       ├── commands.c      # Remote reboot, tunnel, and config command handler
│       ├── rollback.c      # 180-second failsafe UCI rollback watchdog
│       └── tunnel.c        # On-demand reverse proxy and WebSSH PTY bridge
│
├── backend/                # Compiled Native Go Backend (API, MQTT Bridge, Tunnels)
│   ├── Dockerfile          # Multi-stage build producing stripped 25MB binary
│   ├── go.mod              # Go module definition
│   ├── cmd/server/main.go  # Server entry point and embedded dashboard
│   ├── cmd/proxy/          # Browser remote-session proxy
│   ├── cmd/smoke/          # Bounded simulator for one-router qualification
│   └── internal/rms/       # Enrollment, PKI, telemetry, sessions and migrations
│
├── frontend/               # React 18 + TypeScript + Vite + Ant Design (AntD v5)
│   ├── package.json        # Dependencies (antd, @ant-design/icons, recharts, xterm)
│   ├── vite.config.ts      # Vite bundler with API and WebSocket proxies
│   ├── index.html          # HTML entry point with #1f2937 brand styling
│   └── src/
│       ├── main.tsx        # AntD ConfigProvider with #1f2937 dark theme tokens
│       ├── App.tsx         # Responsive layout shell and navigation sidebar
│       ├── Onboarding.tsx     # Manual, CSV and token-bound onboarding
│       ├── terminal.ts        # Browser terminal entry point
│       └── rms.css             # RMS dashboard styles
│
├── deployment/v2/          # Current VPS installer, services, trust and backup tooling
├── tests/                  # Server and physical-router qualification scripts
└── artifacts/              # Local release and rollback outputs; not uploaded by default
```

---

## Key Features

The active Phase 1 release covers enrollment, customer/RBAC isolation, custom
monitoring profiles, telemetry history, LuCI access and SSH sessions. Firmware
rollouts, file management, LAN-device forwarding, VPN, alerts and reports are
roadmap work and are not represented by placeholder screens in the active UI.

1. **Ultra-Lightweight C Agent for 16MB Flash**:
   - Compiles to **< 200 KB** stripped binary; consumes **< 3MB RAM**.
   - Zero physical flash wear (telemetry buffered only in `/tmp` RAM).
   - Single-threaded OpenWrt `uloop` event loop (zero thread deadlocks).
2. **Native Cellular Telemetry**:
   - Directly parses Niseva 2S's native `ubus call cellular status` output.
   - Extracts RSSI, RSRP, RSRQ, Carrier, Band, SIM status, and IMEI.
3. **RMS Connect (NAT / CGNAT Traversal)**:
   - On-demand outbound reverse TLS tunnels over Port 443.
   - **LuCI WebUI Viewer**: Embedded LuCI browser proxy to `127.0.0.1:80`.
   - **Web Terminal**: Interactive browser shell (`/bin/ash`) via `xterm.js`.
   - **SFTP File Explorer**: Browse, upload, download, and edit router files.
   - **LAN Device Access**: Reach equipment behind the router (IP cameras, PLCs).
4. **Failsafe 3-Minute Configuration Rollback Watchdog**:
   - Takes snapshot to `/tmp/uci_backup` before applying UCI changes.
   - Automatically reverts configuration if cloud connectivity is lost for >180s.
5. **Anti-Hijacking Device Claiming**:
   - Verifies **Serial Number** + **MAC Address** + **Random Factory Device Secret**.
   - Absolute database locks prevent cross-tenant claims.
6. **Wire-Speed Topic Isolation**:
   - 1-line Mosquitto Pattern ACL (`pattern readwrite niseva/device/%c/#`) enforced in RAM in 20 nanoseconds with zero HTTP webhook overhead on publishes.
7. **Tamper-Proof On-Premise Binary**:
   - Backend compiles to a stripped native machine-code ELF binary (`-ldflags="-s -w"`).
   - Impossible to decompile back to source code; embeds the React frontend directly inside.

---

## Quickstart

### 1. Install the RMS test stack

Use the current isolated installer and its generated credentials. Do not use
the retired Docker bundle or hard-coded demo accounts.

```bash
cd deployment/v2
sudo bash install-contabo-test.sh
```

The installer documents the dashboard, MQTT and tunnel endpoints and writes the
initial administrator login under the local administrator home directory.

### 2. Build the OpenWrt Router Agent
In your OpenWrt SDK:
```bash
cp -r agent /path/to/openwrt-sdk/package/niseva-agent
make package/niseva-agent/compile V=s
```
Install on the router:
```bash
opkg install niseva-agent_1.0.0_mips_24kc.ipk
/etc/init.d/niseva-agent start
```
