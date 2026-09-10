# Run XNET RMS locally

This guide is for developing and testing the XNET RMS repository on a Linux
workstation. The repository has four parts:

- `backend/`: Go core and tunnel services, database migrations, MQTT bridge,
  enrollment, monitoring and remote sessions.
- `frontend/`: React/Vite dashboard. The production dashboard is embedded into
  the Go server at build time.
- `agent/`: C/OpenWrt router agent and the LuCI package sources.
- `deployment/v2/`: hosted VPS installation and service files. It is not a
  one-command local development environment.

## Prerequisites

Install:

- Git
- Go 1.22 or newer
- Node.js and npm
- PostgreSQL for backend integration and runtime tests
- Mosquitto with TLS support for a complete device connection test
- An OpenWrt 19.07 source tree or SDK with the `mips_24kc` toolchain if you
  are building the XE33 2S agent package

The exact runtime also needs an RMS installation CA, server certificates and a
Mosquitto broker certificate. Never copy the VPS private keys into a checkout.

## Clone the repository

```sh
git clone https://github.com/sourabhburse/xnet-rms.git
cd xnet-rms
git switch dev
```

Use `main` when you need the release branch instead:

```sh
git switch main
```

Keep local secrets, certificates and database dumps outside Git. Check your
working tree before switching branches:

```sh
git status --short
```

## Frontend development

Install dependencies and run the type check plus production build:

```sh
cd frontend
npm ci
npm run build
```

For UI-only work, run Vite:

```sh
npm run dev
```

The current Vite configuration does not provide a development API proxy. The
Vite page is therefore suitable for UI work, while API and tunnel behavior
should be verified through the Go server. The integrated dashboard is served by
the backend after the frontend build is copied into its embedded `dist`
directory.

## Backend tests and build

Run the Go unit and package tests:

```sh
cd backend
go test ./...
```

The database integration test is skipped unless `RMS_TEST_DATABASE_URL` is set.
Use a disposable local PostgreSQL database when enabling it; do not point tests
at the hosted VPS database.

Build the dashboard into the server and produce a local server binary:

```sh
cd frontend
npm ci
npm run build
rm -rf ../backend/cmd/server/dist
cp -a dist ../backend/cmd/server/dist

cd ../backend
go build -trimpath -ldflags='-s -w' -o ../artifacts/xnet-rms-server-local ./cmd/server
```

The server supports these modes:

| Mode | Purpose |
| --- | --- |
| `core` | Dashboard API, enrollment, telemetry, MQTT and database-backed services |
| `tunnel` | Browser LuCI and terminal gateway |
| `migrate` | Apply embedded PostgreSQL migrations |
| `init-ca` | Create a local RMS CA and service certificates |
| `admin` | Create the initial administrator account |

## Create a local PKI

Create a development-only CA and certificates. Include every hostname that you
will use to reach the services; the names must match the URL used by the client.

```sh
cd backend
mkdir -p ../.local/pki
RMS_PKI_DIR="$PWD/../.local/pki" \
  go run ./cmd/server -mode init-ca \
  -hosts 'localhost,127.0.0.1,*.localhost'
```

The command creates the CA and service certificates under `.local/pki`. Keep
that directory out of commits and do not reuse it for production.

## Prepare PostgreSQL

Create a disposable database and set a connection string. For a local default
PostgreSQL installation:

```sh
createdb xnet_rms_local
export DATABASE_URL='postgres://localhost/xnet_rms_local?sslmode=disable'
```

Apply migrations before starting the core:

```sh
cd backend
DATABASE_URL="$DATABASE_URL" go run ./cmd/server -mode migrate
```

Create the first local administrator once:

```sh
RMS_ADMIN_EMAIL='admin@localhost' \
RMS_ADMIN_PASSWORD='use-a-local-password-only' \
DATABASE_URL="$DATABASE_URL" \
go run ./cmd/server -mode admin
```

Use a password manager or a shell-local secret for real testing. Do not put
administrator passwords in the repository.

## Start the integrated services

The core and tunnel require a complete local MQTT/TLS setup. Export the values
in both terminals before starting them. The following is a shape for a local
installation; adjust certificate paths, broker URLs and the tunnel hostname to
match your Mosquitto configuration.

Core terminal:

```sh
cd backend
export DATABASE_URL='postgres://localhost/xnet_rms_local?sslmode=disable'
export JWT_SECRET='at-least-32-random-local-development-bytes'
export RMS_PKI_DIR="$PWD/../.local/pki"
export RMS_LISTEN=':8445'
export RMS_PUBLIC_URL='https://localhost:8445'
export RMS_CORE_URL='https://localhost:8445'
export RMS_MQTT_URL='tls://localhost:8883'
export RMS_MQTT_HOST='localhost'
export RMS_TUNNEL_DOMAIN='localhost'
export RMS_REVOKED_DIR="$PWD/../.local/revoked"
export RMS_RAW_DAYS=30
export RMS_SUMMARY_DAYS=365
mkdir -p "$RMS_REVOKED_DIR"
go run ./cmd/server -mode core
```

Tunnel terminal:

```sh
cd backend
export RMS_PKI_DIR="$PWD/../.local/pki"
export RMS_LISTEN=':9443'
export RMS_PUBLIC_URL='https://localhost:9443'
export RMS_CORE_URL='https://localhost:8445'
export RMS_TUNNEL_DOMAIN='localhost'
export RMS_TUNNEL_PORT=9443
go run ./cmd/server -mode tunnel
```

Open `https://localhost:8445/` in a browser that trusts the local CA. If the
browser does not trust it, import `.local/pki/ca.crt` into the development
profile or use a browser exception only on the local machine. The tunnel
service is reached through the core-created session hostname and must use a
certificate whose SAN matches that hostname.

If you only need to work on API or database code, use `go test ./...` and the
migration command instead of starting MQTT and the tunnel. The server rejects
missing retention values and missing HTTPS URLs deliberately.

## Build and install the XE33 2S agent

The agent build uses an existing OpenWrt 19.07 tree or SDK; it does not fetch or
create one. Build it on the development machine:

```sh
OPENWRT_ROOT=/path/to/openwrt-19.07 \
  sh agent/scripts/build-mips.sh
```

The resulting IPK is written under `artifacts/agent-2.1.1/`. Do not upload IPK
files to the VPS. For a directly connected test router, copy the package to the
router over SSH:

```sh
scp artifacts/agent-2.1.1/niseva-agent_2.1.1-2_mips_24kc.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1
opkg install --force-reinstall /tmp/niseva-agent_2.1.1-2_mips_24kc.ipk
/etc/init.d/niseva-agent restart
/usr/sbin/niseva-agent --status
```

The router must be able to reach the local RMS HTTPS and MQTT endpoints. When
testing through the hosted installation, use the published router trust files
and enrollment settings; do not replace the router's private key or delete its
identity merely to retry a connection.

## Useful checks

```sh
git status --short
git diff --check
cd backend && go test ./...
cd ../frontend && npm run build
```

For runtime failures, inspect the terminal that launched `core` or `tunnel`.
On a systemd installation, use `journalctl -u xnet-rms-core -u xnet-rms-tunnel`.
The hosted service files and VPS-only steps are documented in
[`deployment/v2/README.md`](deployment/v2/README.md); do not run the Contabo
installer on a development laptop.

## Open LuCI through a local TCP forward

The dashboard’s **LuCI TCP tunnel** action creates a short-lived, authenticated
SSH session and displays a one-time private key and launch URL. Build the local
WebSocket stdin/stdout bridge once:

```sh
cd backend
go build -o ../rms-proxy ./cmd/proxy
cd ..
```

Save the displayed key as `/tmp/xnet-rms-<device-id>.key` with mode `0600`, then
run the displayed SSH command. It forwards the router’s LuCI HTTP port to the
local workstation:

```sh
ssh -o ProxyCommand="./rms-proxy '<launch-url>'" \
  -o StrictHostKeyChecking=accept-new \
  -i /tmp/xnet-rms-<device-id>.key \
  -N -L 18080:127.0.0.1:80 root@xnet-rms-router
```

Open `http://127.0.0.1:18080`. The SSH tunnel carries LuCI traffic as raw TCP,
so form submissions, redirects, cookies, JavaScript and Save & Apply use the
router’s original HTTP behavior. The launch URL is single-use and the session
expires automatically. For a self-signed RMS installation, pass its CA to the
bridge with `-ca /path/to/ca.crt`.
