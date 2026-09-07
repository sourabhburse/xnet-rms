# Phase 1 onboarding release

This release adds customer onboarding across the RMS backend, dashboard, router agent and OpenWrt LuCI.

Artifacts are built under `artifacts/agent-2.1.0/` and `backend/artifacts/xnet-rms-server-onboarding`:

- `niseva-agent_2.1.0-1_mips_24kc.ipk`
- `luci-app-niseva-rms_2.1.0-1_mips_24kc.ipk`
- `xnet-rms-server-onboarding`

The agent package is for the current XE33 2S ABI. The LuCI package is separate and uses OpenWrt 19.07-compatible Lua/CBI APIs.

## Onboarding behavior

The agent uses a local P-256 key and a verified HTTPS bootstrap challenge. It sends serial number, normalized LAN MAC, model, firmware, agent version and optional organization token. A token-bound router becomes available only to that organization and must be claimed by an administrator. A tokenless router is matched to an administrator-created serial/MAC registration. Existing enrolled devices keep their identity and use the existing certificate renewal path.

The dashboard adds Add devices with Manual, From file, Available to claim and Registration requests views. CSV uses:

```text
name,serial_number,lan_mac,tags
```

Tags are customer-scoped. Operators and viewers cannot register or claim devices.

LuCI is under Services → RMS. It exposes Enabled, Standby and Disabled modes, hosted/custom server selection, optional masked organization token, Connect now, status and configurable retry settings. Existing `enabled=0/1` configuration is migrated without enabling a previously disabled installation. The agent status command is `/usr/sbin/niseva-agent --status`; reconnect is `/usr/sbin/niseva-agent --connect`.

Retry defaults are 120 seconds for the first hour, 300 seconds afterward, six hours in Standby and automatic Standby after 14 days. They are stored in UCI and bounded by the agent. The hosted server is the configured test hostname; production firmware must provision its own hosted preset and trust bundle.

## Test before deployment

```sh
rtk proxy env GOPATH=/home/sourabh/go_workspace GOCACHE=/tmp/rms-go-cache \
  /home/sourabh/go/bin/go test ./...
rtk proxy npm run build                 # from frontend/
rtk proxy lua -e 'assert(loadfile("luci-app-niseva-rms/root/usr/lib/lua/luci/controller/niseva_rms.lua")); assert(loadfile("luci-app-niseva-rms/root/usr/lib/lua/luci/model/cbi/niseva_rms/settings.lua"))'
rtk proxy env OPENWRT_ROOT=/home/sourabh/openwrt-19.07 \
  sh agent/scripts/build-mips.sh artifacts/agent-2.1.0
```

Deploy the new backend before the agent package. The server migration `004_onboarding.sql` is embedded and runs through the existing explicit migration mechanism. Do not rerun the initial installer or replace the installation CA/database. Back up the database and current server binary first. Restart only the RMS core after the migration in a test window; verify existing devices, telemetry and SSH before installing the router IPKs.

On the router, preserve `/etc/xnet-rms/client.key`, `client.crt`, `ca.crt`, `collector.pub` and `/etc/config/niseva`. Install the agent package and LuCI package with `opkg`, inspect conffile handling, then use LuCI to select the mode and token. Do not overwrite an enrolled device with a new token or delete its identity.

## Qualification gates

- Token-bound pending router appears only in its organization and cannot send telemetry or open sessions before claim.
- Manual registration works offline and matches a tokenless router only on serial plus normalized LAN MAC.
- CSV preview rejects malformed, duplicate and conflicting rows and reports per-row results.
- Existing enrolled devices continue to renew, publish telemetry and open SSH sessions.
- LuCI status has no token/private-key output; Disabled makes no RMS connection attempts; Connect now is authenticated locally.
- Claim, registration, tag and cancellation actions are tenant-scoped and audited.
- Test the physical 2S after installation: flash/RAM, registration state, MQTT, monitoring, LuCI and SSH.

This is a test release. Production cleanup, high-scale qualification, off-VPS backups and full rollback evidence remain required.
