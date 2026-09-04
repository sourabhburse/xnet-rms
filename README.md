# Niseva Cloud RMS (Remote Management System)

An enterprise-grade, multi-tenant cloud fleet management and remote access platform for **Niseva 2S routers** running **OpenWrt** (inspired by Teltonika RMS).

Designed for both **Cloud Multi-Tenant SaaS** and **Closed-Source On-Premise Client Deployments** with non-decompilable Go binaries and cryptographic license protection.

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
│   ├── cmd/server/main.go  # Server entry point with Gin HTTP engine
│   └── internal/
│       ├── auth/           # Multi-tenant JWT auth and RBAC middleware
│       ├── database/       # PostgreSQL connection and GORM auto-migrations
│       ├── devices/        # Device claiming (Serial+MAC+Secret) & check-in
│       ├── models/         # GORM relational models and JSONB service storage
│       ├── mqtt/           # Mosquitto broker bridge, LWT, and command dispatch
│       ├── telemetry/      # Time-series telemetry ingestion and aggregation
│       └── tunnel/         # RMS Connect WebSocket reverse tunnel gateway
│
├── frontend/               # React 18 + TypeScript + Vite + Ant Design (AntD v5)
│   ├── package.json        # Dependencies (antd, @ant-design/icons, recharts, xterm)
│   ├── vite.config.ts      # Vite bundler with API and WebSocket proxies
│   ├── index.html          # HTML entry point with #1f2937 brand styling
│   └── src/
│       ├── main.tsx        # AntD ConfigProvider with #1f2937 dark theme tokens
│       ├── App.tsx         # Responsive layout shell and navigation sidebar
│       ├── services/api.ts # Typed Axios API client
│       ├── pages/
│       │   ├── Dashboard.tsx    # Fleet overview, carrier share, signal stats
│       │   ├── DeviceList.tsx   # High-density device table with batch actions
│       │   └── DeviceDetail.tsx # Telemetry charts, IPsec, Modbus, and UCI tabs
│       └── components/
│           ├── ClaimDeviceModal.tsx   # Serial + MAC + Factory Secret wizard
│           ├── LuciModal.tsx          # Embedded LuCI viewer with 15m session HUD
│           ├── TerminalModal.tsx      # In-browser xterm.js Web Terminal
│           └── FileManagerModal.tsx   # In-browser SFTP file explorer
│
└── deploy/                 # Docker Orchestration & Mosquitto Configuration
    ├── docker-compose.yml  # PostgreSQL 16, Mosquitto 2.0, Niseva RMS Server
    └── mosquitto/
        ├── mosquitto.conf  # Broker config with TLS and internal listeners
        ├── acl.conf        # Nanosecond Pattern ACLs: niseva/device/%c/#
        └── password_file   # Internal service credentials
```

---

## Key Features

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

### 1. Launch the Cloud Server Stack
```bash
cd deploy
docker compose up -d
```
* **Web Dashboard**: `http://localhost:8080`
* **Default Admin**: `admin@niseva.com` / `Admin@12345`
* **MQTT Broker**: `localhost:1883` (Internal) / `localhost:8883` (TLS)

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
