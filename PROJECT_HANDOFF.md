# XNET RMS: project handoff and operating runbook

For the full staged product plan, dependencies, acceptance gates and open decisions, see [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md). This handoff describes operational procedures and dated evidence.

**Latest user-confirmed direction:** complete monitoring first, bulk configuration second, access to devices behind the router third. Build the necessary durable job foundation before bulk configuration; other modules do not take precedence over this order. The user reports SSH through RMS is working. Treat that as user-reported progress, preserve it, and verify current code/deployed versions before changing the tunnel. Historical runtime observations below have not been refreshed by this planning update.

**Subsequent accepted design decision:** build toward the full Teltonika-style platform. Support both browser terminals and native SSH clients through the RMS outbound tunnel, using the router's actual SSH server and temporary session-key authorization. Replace direct agent shell/PTY creation for terminal access. Expiry/revocation must remove the temporary key and terminate active sessions, including local cleanup when RMS is unreachable; preserve existing SSH keys/access. No shared fleet root password. This decision updates the target design only: the PTY implementation and historical test evidence below remain descriptions of the earlier code. See the roadmap for unresolved key-custody, native-client bootstrap and Dropbear qualification details.

Updated: 2026-09-07, approximately 09:50 UTC. This is a point-in-time handoff. Other agents are changing this checkout; refresh runtime status and hashes before acting.

## 1. Purpose and agreed scope

Build one hosted RMS installation supporting a target fleet of 10,000 routers, with an offline/on-premises deployment option. The reference physical router is the **Niseva XE33 2S**, running custom XNET firmware based on OpenWrt. Do not infer its hardware from similarly named firmware profiles: this actual router reported QCA9533, ath79/generic and mips_24kc.

Release 1 covers customer enrollment and roles, certificate identity, monitoring, custom JSON telemetry, LuCI access without a second router login, terminal access, and audit records. Notifications, general firmware rollout, file transfer and LAN forwarding are later work.

The agreed architecture is:

| Component | Responsibility |
|---|---|
| C router agent | Local private key, enrollment/renewal/recovery, scheduled bounded collection, telemetry queue, one remote session |
| Go core | Customer authorization, enrollment/PKI, profiles/bundles, MQTT ingestion, current/history queries, session authorization |
| Go tunnel | Router and browser authentication, session-isolated LuCI proxy and terminal streams, expiry/cleanup |
| Dedicated Mosquitto | Device-certificate authentication and identity-specific topic permissions |
| Existing PostgreSQL | Separate RMS database/role, migrations, current snapshots, partitioned history and summaries |
| React dashboard | Customers, fleet/devices, profile-driven telemetry, enrollment and remote access |

Core and tunnel are separate processes from one codebase/release. Keep the shared VPS's existing applications and MQTT configuration intact.

## 2. Evidence and current state

### Verified earlier in this deployment

- Dedicated RMS core, tunnel and MQTT services were installed on Contabo. Existing nginx, Mosquitto, NCMS, PostgreSQL and AIO services were checked active afterward.
- Public core and tunnel health endpoints passed verified HTTPS checks. Public ports 8445, 8883 and 9443 were opened by the user.
- Two-router simulated smoke tests passed enrollment, certificate MQTT, client-ID takeover prevention, cross-device publication rejection, snapshot ACK/replay and history deduplication, wrong-router rejection, wildcard browser proxying, busy-session rejection and closure.
- The actual 2S was upgraded from agent 1.0.0-1 to 2.0.0-1, enrolled with a locally generated private key, and appeared ONLINE in RMS. Its system profile was assigned.
- Initial physical measurements: 124224 kB total RAM, about 66 MB available before upgrade; 6760 KiB writable flash free before, 6704 KiB after. One early idle agent measurement was VmRSS 3796 kB / VmSize 4880 kB. These are snapshots, not resource qualification under load.

### Latest refresh for this document

At approximately 09:50 UTC:

- RMS reported device `cdd1495337a9dc4d5078873432591ff0` OFFLINE.
- Its last heartbeat was `2026-09-07T09:00:17.997773Z`.
- RMS contained a successful `system` snapshot, sequence 44, observed at `2026-09-07T09:01:43Z`, with uptime 7899 seconds, free RAM 76410880 bytes and total RAM 127205376 bytes. Thus real collection/ingestion has succeeded since the earlier missing-snapshot investigation.
- Laptop SSH to `192.168.1.1` timed out. The reason is not established; do not assume an agent crash or restart/reset the router blindly.
- Local agent binary SHA256 was `d354f1126f921ebd1a3322e73f613bed62544a3eff4e35040eb6792bf84aa33c`. The router hash could not be refreshed because SSH timed out. Do not claim the current local binary is installed.

Actual LuCI single sign-on, physical terminal behavior, restart/revocation cleanup, full backlog behavior, IPsec collection and production capacity are not qualified by the evidence in this handoff. Ask the other agent for any additional results and verify their artifacts before incorporating claims.

## 3. Workspace and collaboration rules

Repository root:

```text
/home/sourabh/Documents/antigravity/goofy-faraday
```

Read user-provided AGENTS instructions and `/home/sourabh/.codex/RTK.md`. Prefix laptop shell commands with `rtk`; `rtk proxy` runs an ordinary command without output filtering. When fetching library/CLI documentation, follow the workspace Context7 requirement. Commands below reproduce project procedures; inspect scripts before using them after another agent changes code.

The checkout has extensive modified, deleted and untracked files. Do not reset, clean, restore broad paths, or overwrite another agent's changes. No commit was requested for this handoff. Coordinate ownership before editing agent/runtime code, rebuilding into shared output paths, or restarting deployed services. Use separate artifact directories for concurrent work; never overlap builds in a shared OpenWrt build tree.

Start with:

```sh
rtk git status --short
rtk git log -5 --oneline
rtk git diff --check
```

The working tree, generated frontend assets, local binaries, uploaded release, installed VPS binary and installed router binary are distinct states. Record hashes and build timestamps; Git HEAD alone does not identify this uncommitted implementation.

## 4. Code and artifact map

| Path relative to repository | Contents |
|---|---|
| agent/src/main.c | Event loop, worker scheduling, config, MQTT lifecycle |
| agent/src/bootstrap.c | Hardware identity, HTTPS, local keys and certificate lifecycle |
| agent/src/collectors.c | Profile synchronization, bundle activation, bounded collectors |
| agent/src/telemetry.c | 2 MiB queue, replay and exact application ACK removal |
| agent/src/runtime.c | Bounded process capture and supporting runtime helpers |
| agent/src/tunnel.c, tunnel_worker.c | Session worker, TLS/WebSocket transport, rpcd SSO, PTY |
| agent/files/ | UCI defaults, procd init, keep rules and IPsec collector |
| agent/scripts/build-mips.sh | Cross-compile and construct IPK without modifying SDK |
| agent/tests/runtime_test.c | Queue/process runtime tests |
| backend/internal/rms/ | Active backend implementation and tests |
| backend/cmd/server/ | Server entry point and embedded frontend dist |
| backend/cmd/smoke/ | Bounded live simulator qualification command |
| frontend/ | React UI and separate browser terminal entry point |
| broker/rms_acl.c | Mosquitto identity/topic authorization plugin |
| collectors/ipsec/ | IPsec profile template and fixture tests |
| deployment/v2/ | Current installer, service definitions, trust/certificate and backup tooling |
| tests/server/ | Lab provisioning and real-device status scripts |
| artifacts/agent-2.0.0/ | Agent outputs; verify freshness before using |
| artifacts/2s-test-kit/ | Private, Git-ignored trust/enrollment kit; do not publish |

The former Docker-era `deploy/` tree has been removed. Use only the v2 tooling; do not revive the demo paths. More details: [agent internals](agent/HOW_IT_WORKS.md), [agent build notes](agent/BUILD.md), [deployment notes](deployment/v2/README.md), [server test report](deployment/v2/SERVER_TEST_STATUS.md). Their earlier statements about untested enrollment are historical; use the dated evidence above and recheck live status.

## 5. SSH to the physical 2S

The user's working laptop SSH configuration supplies authentication and legacy algorithm compatibility:

```sh
rtk proxy ssh 192.168.1.1
rtk proxy ssh -o BatchMode=yes -o ConnectTimeout=10 192.168.1.1 'cat /etc/openwrt_release; cat /tmp/sysinfo/model; date -u'
```

**Do not use `-F /dev/null` for this router.** That bypasses the user's working credentials; our earlier explicit root/default-key attempt failed. No router password is needed with the user's normal configuration.

If it times out, inspect laptop interfaces/routes/neighbors first:

```sh
rtk proxy ip -brief address
rtk proxy ip route
rtk proxy ip neigh
```

Previously the wired USB NIC was `enx1c61b472a5f2`, laptop address `192.168.1.12/24`, router `192.168.1.1`; Wi-Fi was `192.168.20.6/24`. These may change. Sandbox network commands can require tool escalation; that is separate from router authentication.

Read-only preflight from repository root:

```sh
rtk proxy sh -c 'ssh -o BatchMode=yes 192.168.1.1 sh < agent/scripts/preflight-2s.sh'
rtk proxy ssh 192.168.1.1 'opkg status niseva-agent; sha256sum /usr/sbin/niseva-agent; uci -q get niseva.general.device_id; df -k /overlay'
```

The router has libcurl4 but **no curl executable**. Do not mistake that for a missing agent dependency. HTTPS enrollment itself passed through libcurl. Required installed ABI dependencies included libc 1.1.24, libgcc1 7.5.0, libubox20191228, libuci20130104, libmosquitto-ssl 1.6.13, libcurl4 7.66.0 and libopenssl1.1 1.1.1i. Do not force-install an incompatible package or replace system libraries.

Router paths:

| Path | Purpose |
|---|---|
| /usr/sbin/niseva-agent | Installed executable |
| /etc/init.d/niseva-agent | procd service; note the full service name |
| /etc/config/niseva | Private UCI config; do not dump it into chat |
| /etc/xnet-rms/client.key, client.crt | Existing enrolled identity: preserve |
| /etc/xnet-rms/ca.crt, collector.pub | Public installation/server and bundle trust |
| /tmp/xnet-rms-profiles.json | Downloaded profiles; volatile |
| /root/rms-before-v2-20260907/ | Privately saved old config, executable and init script |

Service operations, only when the current task calls for them:

```sh
rtk proxy ssh 192.168.1.1 '/etc/init.d/niseva-agent restart'
rtk proxy ssh 192.168.1.1 'logread -e niseva-agent | tail -30'
```

Restart clears the current RAM telemetry queue and closes sessions. Never reprovision the existing device with the original enrollment kit: the one-use token has been consumed, and its disabled config would overwrite established identity settings.

## 6. SSH and operate the Contabo VPS

Host `82.180.146.203`, port `8022`, user `ubuntu`.

Original user-authorized PuTTY key: `/home/sourabh/Niseva/Aashish_Sir/contabo-in-ubuntu.ppk`. Converted key used in this task: `/tmp/xnet-rms-ssh/id_rsa`; pinned hosts file: `/tmp/xnet-rms-ssh/known_hosts`. These temporary files may disappear between sessions.

```sh
rtk proxy ssh -F /dev/null -i /tmp/xnet-rms-ssh/id_rsa -p 8022 \
  -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=15 \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/tmp/xnet-rms-ssh/known_hosts \
  ubuntu@82.180.146.203
```

Use `-F /dev/null` for this explicit VPS connection. If the converted key is missing, recreate it privately:

```sh
rtk proxy mkdir -p -m 700 /tmp/xnet-rms-ssh
rtk proxy puttygen /home/sourabh/Niseva/Aashish_Sir/contabo-in-ubuntu.ppk -O private-openssh -o /tmp/xnet-rms-ssh/id_rsa
rtk proxy chmod 600 /tmp/xnet-rms-ssh/id_rsa
```

If known_hosts is also gone, verify the VPS host fingerprint through a trusted source before adding it. Do not use `StrictHostKeyChecking=no` or treat ssh-keyscan alone as identity verification. Never print/copy private key contents into tool output.

`ubuntu` cannot run sudo unattended. The user ran the initial installer, firewall additions and broker configuration fix manually. Prepare a concrete reviewed command/script if administrative work is needed; do not rerun the installer as an updater. Reading service journals may also require sudo or journal-group membership; an empty inaccessible journal is not proof of no errors.

| Item | Location/value |
|---|---|
| Dashboard/core | https://xnet-rms-test.duckdns.org:8445 |
| Device MQTT | xnet-rms-test.duckdns.org:8883 |
| Tunnel health | https://xnet-rms-test.duckdns.org:9443/health |
| Session browser origin | https://SESSION_ID.xnet-rms-test.duckdns.org:9443 |
| Uploaded release | /home/ubuntu/xnet-rms-v2-release-20260907 |
| Installed binary/plugin | /opt/xnet-rms/xnet-rms; /opt/xnet-rms/rms_acl.so |
| RMS configuration/trust | /etc/xnet-rms |
| RMS state | /var/lib/xnet-rms |
| Database/restricted role | xnet_rms_v2 |
| Private initial dashboard login | /home/ubuntu/.config/xnet-rms/initial-login.txt |
| Private lab state | /home/ubuntu/.config/xnet-rms/lab-enrollment.json |
| Router public trust export | /home/ubuntu/xnet-rms-router-trust |

Run these inside the VPS shell:

```sh
systemctl is-active xnet-rms-core xnet-rms-tunnel xnet-rms-mqtt
systemctl is-active nginx mosquitto mosquitto-ncms postgresql@18-main aio-web ncms-api
systemctl list-timers xnet-rms-certificates.timer
```

The three dedicated RMS services have separate resource limits. Existing MQTT/nginx ports and configs must remain unchanged. The user opened only RMS ports 8445/8883/9443 for this work.

## 7. Certificates and secrets

- Router private keys are generated on-device. The installation issues one-year certificates; renewal starts with 90 days remaining. Expired-certificate recovery uses proof of the existing key plus a fresh challenge and authorization checks.
- MQTT uses certificate identity as both username and client ID. Keep both `use_identity_as_username true` and `use_username_as_clientid true` in the dedicated broker configuration.
- Each installation owns its issuing CA. On this VPS, private authority material is under `/etc/xnet-rms/authority`; service-specific subsets are in core-pki, tunnel-pki and broker-pki. Do not copy authority keys into a router kit.
- Public HTTPS certificates are separate Let's Encrypt lineages `xnet-rms-host` and `xnet-rms-sessions`, under `/home/ubuntu/.local/share/xnet-rms-acme/config/live/`. Issued certificates expire 2026-12-05; verify actual files before relying on this date.
- DuckDNS token is private at `/home/ubuntu/.config/xnet-rms/duckdns.token`. The hook is `/home/ubuntu/.local/lib/xnet-rms/duckdns-hook.py`. Separate lineages avoid competing TXT values; preserve the propagation waiting logic.
- A dedicated timer checks renewal and restarts RMS services only when certificate contents change. Such restarts close active sessions. Future renewal is not yet demonstrated by this deployment's initial issuance.
- The router trust file combines the installation CA and ISRG Root X1. Do not disable HTTPS verification to resolve trust or clock errors.

## 8. Build and package

### Agent for this 2S

From repository root:

```sh
rtk proxy env OPENWRT_ROOT=/home/sourabh/openwrt-19.07 \
  sh agent/scripts/build-mips.sh artifacts/agent-next
rtk proxy sh -c 'cd artifacts/agent-next && sha256sum -c SHA256SUMS'
```

This reads the existing GCC 7.5.0 MIPS musl staging tree and writes outside it. It builds an IPK, not firmware. Outputs include stripped/debug executable, ELF metadata and checksums. Review architecture, loader, dependencies and absence of development RPATH. Bump package/release metadata consistently in `agent/Makefile` and the control block/output naming in `agent/scripts/build-mips.sh` when issuing a new release; current code hardcodes 2.0.0-1 in both places.

For an existing enrolled router, upload only the new IPK (scp may require legacy mode; an SSH stream avoids SFTP dependence):

```sh
rtk proxy sh -c 'ssh 192.168.1.1 "umask 077; cat > /tmp/niseva-agent-next.ipk" < artifacts/agent-next/niseva-agent_2.0.0-1_mips_24kc.ipk'
```

Adjust the filename after version bumps. Compare local/remote checksums, preserve the installed package/config/identity, then stop the service, install via opkg and restart in an agreed test window. Preserve UCI identity and `/etc/xnet-rms`; inspect conffile handling instead of replacing config with defaults. Do not use dependency-forcing flags. Re-read the installed version and binary hash after installation.

### Backend and frontend

Go is available at `/home/sourabh/go/bin/go`; module root is `backend`. Existing cache settings used by this task:

```sh
cd /home/sourabh/Documents/antigravity/goofy-faraday/backend
rtk proxy env GOPATH=/home/sourabh/go_workspace GOCACHE=/tmp/rms-go-cache \
  /home/sourabh/go/bin/go test ./...
rtk proxy env GOPATH=/home/sourabh/go_workspace GOCACHE=/tmp/rms-go-cache \
  /home/sourabh/go/bin/go vet ./...
rtk proxy env GOPATH=/home/sourabh/go_workspace GOCACHE=/tmp/rms-go-cache \
  /home/sourabh/go/bin/go build -o ../artifacts/xnet-rms-next ./cmd/server
```

If UI code changed, first run `rtk proxy npm run build` in `frontend`, inspect its output and synchronize the complete generated `frontend/dist` into `backend/cmd/server/dist` before compiling Go. Remove obsolete generated assets only within that destination, after checking no agent is writing there. Preserve both index.html and terminal.html. Building Go alone embeds whatever dist currently exists; it does not rebuild React.

Deploy updates as a new reviewed release with checksums and rollback artifacts. Coordinate sudo installation/restarts with the user. Do not replace authority material, recreate the database, run the initial installer again, or imply a local build updates the VPS automatically. Update release manifests when packaged files change.

## 9. Testing procedures and their limits

### Local checks

- Run Go tests/vet and relevant race tests after backend changes.
- PostgreSQL integration tests require `RMS_TEST_DATABASE_URL`; otherwise they skip. Use an isolated disposable test database: inspect `backend/internal/rms/integration_test.go` before supplying a DSN. Never point this test harness at deployed RMS data.
- Agent runtime tests live in `agent/tests/runtime_test.c`; use the matching host libubox/UCI headers/libraries. Prior ASan/UBSan passes do not cover later concurrent edits or actual target event-loop behavior. LeakSanitizer was disabled because the execution environment prevented it from operating.
- IPsec fixtures: `rtk proxy lua collectors/ipsec/test.lua` from repository root, with the required Lua JSON module available.
- Finish with `rtk git diff --check`. Passing host checks does not establish target installation or session behavior.

### Bounded server smoke

The uploaded executable is `/home/ubuntu/xnet-rms-v2-release-20260907/rms-server-smoke`. Inside VPS SSH:

```sh
/home/ubuntu/xnet-rms-v2-release-20260907/rms-server-smoke -run \
  -login-file /home/ubuntu/.config/xnet-rms/initial-login.txt
```

This deliberately creates one test customer, token, profile and two simulator devices; it is not read-only. It revokes simulator identities/token on normal unwinding and retains test/audit records. Confirm cleanup if interrupted or errors occur. It does not exercise real router SSO/PTY. Rebuild/upload it when its source changes. Do not run a 10,000-device workload on the shared VPS as a casual smoke test.

### Actual lab device status/profile

`tests/server/check-2s.py` reads private login credentials on the VPS and prints selected non-secret device/snapshot fields. It currently hardcodes the physical device ID above. Execute it by piping it to `python3 -` using the VPS SSH command from section 6, or upload the script and run it there. Do not run it locally expecting VPS credentials to exist on the laptop.

The system profile is `3e9d2b173ecd44b37f60eeb7a210f939`, version 1, source `system`, ubus `system.info`, every 60 seconds. The prepared assignment command on the VPS is:

```sh
python3 /home/ubuntu/xnet-rms-v2-release-20260907/prepare-lab.py \
  --assign-device cdd1495337a9dc4d5078873432591ff0
```

It is already assigned. Do not repeat enrollment. The helper is intended for the existing lab state, not general customer provisioning.

### Physical qualification sequence

1. Restore/confirm laptop SSH connectivity and router internet/DNS/time. Verify binary hashes and ask the other agent what it deployed.
2. Observe at least two advancing system snapshots and heartbeats. Confirm ACK removal and source freshness, not just device ONLINE status.
3. Exercise one LuCI session: no second login, correct assets/cookies/forms, no cross-session leakage. Use a harmless read-only page first.
4. Close LuCI and exercise terminal with a harmless command such as `uname -a`; verify output and process cleanup. Reject competing requests as busy.
5. Verify expiry, explicit closure, agent/service restart and revocation cleanup. Revocation changes device authorization; use a disposable identity or an explicitly planned recovery path rather than casually revoking the sole lab router.
6. Test MQTT-only disconnect/reconnect and bounded replay while keeping laptop SSH available. Confirm duplicate ACK behavior, discard counters and freshness. Do not alter the router's network configuration or cut its sole management route without a recovery plan.
7. Test full backlog, hung/oversized/malformed collectors, counter resets and failed/tampered bundle activation. Record real RAM/CPU/flash before/during/after. Reboot loses the current RAM backlog; distinguish this implementation limit from durable replay.

## 10. Concurrent child-process changes: review first

Earlier, enrollment/heartbeats worked but system snapshots did not appear. Inspection found manual `waitpid()` handling alongside libubox uloop SIGCHLD processing. The target libubox implementation calls `waitpid(-1, ..., WNOHANG)` and can reap children before application polling sees them.

Current source now differs from that earlier build: `main.c` resets SIGCHLD after uloop initialization and handles ECHILD; `collectors.c` handles ECHILD; `tunnel.c` checks worker termination. A new local executable exists and successful real telemetry now exists. We have not established which binary is currently installed or validated all failure paths after those changes.

Review these edits before further modification. In particular, treating ECHILD as exit status zero loses the actual exit status and can turn valid JSON from a failed collector into apparent success. Choose one explicit owner for child reaping and preserve actual exit status, timeout/overflow classification and cleanup. Test this through the actual event loop and target libubox, not just a standalone capture helper. Do not undo another agent's solution without comparing code and evidence with them.

## 11. IPsec and custom telemetry

The physical router has strongSwan 5.8.0, `ipsec`, the VICI module and Lua/luci.jsonc, but no `swanctl` executable was found. The shipped collector requires swanctl. Decide whether to provide a compatible swanctl package or implement an approved collector for the available interface after checking the real configuration. Do not infer an established tunnel from a PID file or running daemon.

The team's versioned profiles define approved script/ubus sources, 60–300 second intervals, time/output bounds, declared fields/types/units/status mapping and repeated-entity identifiers. Customers do not upload arbitrary executable collectors in release 1. Scripts run as bounded children, not a security sandbox. Signed bundles must use the existing installation signing authority, be verified before activation, and preserve the previous working version.

Track current snapshots separately from history and distinguish collector freshness/failure from connectivity. Counters, gauges and states require different aggregation behavior. Frontend fields/views should follow profile metadata rather than creating a bespoke page per integration.

## 12. Remaining launch gates and next owner checklist

Immediate priority: reconcile concurrent changes and deployed hashes, restore the currently unavailable router connection, repeat real telemetry checks, then finish physical LuCI/terminal and child-process failure testing.

Before production:

- Qualify actual 2S CPU/RAM/flash with IPsec, collectors, TLS, full backlog and remote access together.
- Measure a VPS baseline, agree an off-hours test window and explicit CPU/memory/disk/latency stop conditions, then test capped workloads toward 10,000 devices at one-minute collection and 25 sessions, including reconnect and replay bursts. Measure impact on existing applications.
- Compare seven- and thirty-day retention using disk growth, ingestion lag and query latency. Test raw retention is seven days and summary retention thirty days; production retention remains undecided.
- Verify provider network limits. Provision encrypted backups outside this VPS, including database, profiles, bundles and CA recovery material, and perform a restore drill targeting service restoration within 24 hours and at most 24 hours of lost RMS data.
- Complete offline installation qualification with locally provisioned trust/time, trusted artifacts, migrations and backup/restore procedures. Script existence alone does not prove an offline installation works.

The shared VPS remains a single point of failure. Do not claim production readiness or 10,000-router capacity from server specifications, a successful build, or simulator smoke tests.
