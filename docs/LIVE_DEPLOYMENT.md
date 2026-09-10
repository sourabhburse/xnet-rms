# Making XNET RMS changes live

This is the deployment procedure for the hosted test RMS installation. It assumes development happens on the `dev` branch and the VPS checkout is kept at `/home/ubuntu/xnet-rms-repo`.

The hosted test endpoints are:

- Dashboard/API: `https://xnet-rms-test.duckdns.org:8445`
- MQTT: `xnet-rms-test.duckdns.org:8883`
- Tunnel ingress: `https://xnet-rms-test.duckdns.org:9443`
- VPS SSH: `ubuntu@82.180.146.203`, port `8022`
- Workstation key (PuTTY format): `/home/sourabh/Niseva/Aashish_Sir/contabo-in-ubuntu.ppk`
- VPS build root: `/home/ubuntu/xnet-rms-builds`

Do not put passwords, private keys, enrollment tokens, database URLs, or certificate authority material in this repository or in command output.

### SSH key setup

The Contabo key is kept outside the repository at `/home/sourabh/Niseva/Aashish_Sir/contabo-in-ubuntu.ppk`. OpenSSH cannot use the PuTTY file directly, so convert it once per workstation session to a temporary OpenSSH key:

```bash
PPK_KEY=/home/sourabh/Niseva/Aashish_Sir/contabo-in-ubuntu.ppk
OPENSSH_KEY=/tmp/xnet-contabo-openssh
puttygen "$PPK_KEY" -O private-openssh-new -o "$OPENSSH_KEY"
chmod 600 "$OPENSSH_KEY"
```

Never commit either key. The temporary `/tmp` copy may be removed after the deployment session.

## 1. Prepare and push the change

From the workstation:

```bash
git switch dev
git pull --ff-only origin dev
git status --short
```

Run the checks appropriate to the change. For dashboard changes, build the frontend before pushing:

```bash
cd frontend
npm ci
npm run build
cd ..
```

The Go server embeds `backend/cmd/server/dist`, so a frontend-only change is not live until a new server binary is compiled and installed. Keep generated frontend output synchronized with the embedded copy:

```bash
rm -rf backend/cmd/server/dist
cp -a frontend/dist backend/cmd/server/dist
```

Run backend tests from the Go module directory:

```bash
cd backend
go test ./...
cd ..
```

Commit only the intended source and generated embedded assets, then push:

```bash
git add frontend backend/cmd/server/dist
git commit -m "Describe the change"
git push origin dev
```

Do not add `.playwright-mcp/`, local proxies, credentials, private keys, router IPK files, or temporary release directories to the repository.

## 2. Pull and build on the VPS

The VPS SSH key must be prepared as shown above. Set the connection variables once:

```bash
VPS_KEY=/tmp/xnet-contabo-openssh
VPS=ubuntu@82.180.146.203
VPS_PORT=8022
ssh -i "$VPS_KEY" -p "$VPS_PORT" "$VPS" \
  'cd /home/ubuntu/xnet-rms-repo && git pull --ff-only origin dev'
```

When using the Codex terminal, prefix the same command with `rtk`:

```bash
rtk ssh -F /dev/null -oBatchMode=yes -oStrictHostKeyChecking=no \
  -i "$VPS_KEY" -p "$VPS_PORT" "$VPS" \
  'cd /home/ubuntu/xnet-rms-repo && git pull --ff-only origin dev'
```

On the VPS, build the UI and embed it into the server:

```bash
cd /home/ubuntu/xnet-rms-repo
npm --prefix frontend ci
npm --prefix frontend run build
rm -rf backend/cmd/server/dist
cp -a frontend/dist backend/cmd/server/dist

mkdir -p /home/ubuntu/xnet-rms-builds/rms-build-<commit>
cd backend
/home/ubuntu/go/bin/go test ./...
/home/ubuntu/go/bin/go build \
  -o /home/ubuntu/xnet-rms-builds/rms-build-<commit>/xnet-rms-server-<commit> \
  ./cmd/server
sha256sum /home/ubuntu/xnet-rms-builds/rms-build-<commit>/xnet-rms-server-<commit>
```

Replace `<commit>` with the full or short commit identifier. All new build directories belong under `/home/ubuntu/xnet-rms-builds`; do not create new `rms-build-*` directories directly in `/home/ubuntu`. Record the checksum before installation so the operator can verify the exact artifact. If the Go toolchain is not at `/home/ubuntu/go/bin/go`, stop and provision the approved toolchain before continuing.

## 3. Install the binary and restart services

The SSH account normally cannot run `sudo` without the operator's password. Run this final step interactively on the VPS, using the checksum printed in the previous step:

```bash
cd /home/ubuntu/xnet-rms-builds/rms-build-<commit>
sha256sum xnet-rms-server-<commit>

# Compare the checksum with the build output before continuing.
sudo install -o root -g root -m 0755 \
  xnet-rms-server-<commit> \
  /opt/xnet-rms/xnet-rms

# Run this only when the release adds database migrations.
sudo bash -c 'set -a; . /etc/xnet-rms/core.env; set +a; /opt/xnet-rms/xnet-rms -mode migrate'

sudo systemctl restart xnet-rms-core xnet-rms-tunnel
sudo systemctl is-active xnet-rms-core xnet-rms-tunnel
```

The MQTT service is Mosquitto and is not restarted for dashboard or Go server changes. Restart `xnet-rms-mqtt` only when its configuration, ACL plugin, or certificates changed:

```bash
sudo systemctl restart xnet-rms-mqtt
```

Before replacing a production or shared test binary, preserve a rollback copy:

```bash
sudo cp -a /opt/xnet-rms/xnet-rms \
  /opt/xnet-rms/xnet-rms.backup-$(date +%Y%m%d-%H%M%S)
```

## 4. Verify the live release

Check service state and recent errors:

```bash
sudo systemctl --no-pager --full status xnet-rms-core xnet-rms-tunnel
sudo journalctl -u xnet-rms-core -u xnet-rms-tunnel \
  --since '5 minutes ago' --no-pager
```

Check the public health endpoints:

```bash
curl --fail https://xnet-rms-test.duckdns.org:8445/health
curl --fail https://xnet-rms-test.duckdns.org:9443/health
```

Open the dashboard in a private window or perform a hard refresh (`Ctrl+Shift+R`). Vite asset filenames are content-hashed, but an existing browser or reverse-proxy cache can still display the previous page until the new HTML is fetched.

For UI changes, verify login/logout, organization selection and tenant-scoped data, the changed page at desktop and narrow widths, one device or remote-session flow if navigation changed, and browser console/network errors. For backend changes, also verify migrations, enrollment, telemetry, and remote sessions relevant to the change. A local build or healthy systemd process is not proof that the browser loaded the new assets.

## 5. Roll back

If the new release fails health checks or breaks a critical workflow, restore the last known-good binary and restart the Go services:

```bash
sudo install -o root -g root -m 0755 \
  /opt/xnet-rms/xnet-rms.backup-<timestamp> \
  /opt/xnet-rms/xnet-rms
sudo systemctl restart xnet-rms-core xnet-rms-tunnel
sudo systemctl is-active xnet-rms-core xnet-rms-tunnel
```

Do not roll back a database migration by deleting tables or editing the live database manually. Revert with a compatible application release or follow a reviewed down-migration/restore procedure.

## 6. Deployment record

For each live release, record the Git commit, binary SHA-256 checksum, whether a migration ran, services restarted, health-check and browser results, and rollback artifact path.
