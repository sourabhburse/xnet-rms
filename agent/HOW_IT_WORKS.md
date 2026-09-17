# XNET RMS router agent: full workflow

This document describes the current implementation of the native agent in this
repository. It is intended to explain the runtime workflow, ownership of each
step, local files and sockets, failure behavior, and the limits of what has
actually been qualified.

The service binary is installed as /usr/sbin/niseva-agent. OpenWrt starts it
through /etc/init.d/niseva-agent. The router makes outbound HTTPS, MQTT, and
WebSocket connections; RMS does not require an inbound port forwarded to the
router.

The current package contains several version identifiers that should be
reconciled before a release:

- The runtime, OpenWrt Makefile, and MIPS build helper now use version 2.2.0.

Treat the source and package metadata as the release source of truth only after
those values have been made consistent.

## 1. System boundary

The agent owns router-side identity, enrollment, certificate renewal, profile
activation, local data collection, bounded buffering, MQTT transport, and the
outbound remote-session tunnel.

The backend owns customer and device state, claim/approval decisions, profile
definitions, collector bundle signatures, telemetry application
acknowledgments, operator authorization, session expiration, and the tunnel
gateway.

The MQTT broker transports heartbeat, telemetry, commands, and telemetry
acknowledgments. It is not the enrollment API and it is not the remote-session
WebSocket gateway.

~~~mermaid
flowchart LR
    Init[procd service] --> Agent[Router agent]
    Agent -->|HTTPS + CA verification| API[RMS API]
    Agent -->|MQTT over TLS + mTLS| Broker[RMS broker]
    Agent -->|TLS + WebSocket + mTLS| Gateway[RMS tunnel gateway]
    API -->|profiles and signed bundles| Agent
    Broker -->|commands and application ACKs| Agent
    Operator[Operator browser] -->|HTTPS/WebSocket| Gateway
    Agent -->|ubus calls or signed scripts| Local[Router data sources]
    Agent -->|HTTP proxy or SSH stream| Local
    Local --> Agent
~~~


## 2. Processes and lifecycle

The agent is one long-running process with short-lived children and workers.

| Context | Responsibility |
| --- | --- |
| Main process | UCI configuration, status, event loop, MQTT callbacks, heartbeat, retry scheduling, telemetry queue, collection scheduling, and child supervision |
| Enrollment worker | Bootstrap check-in, certificate renewal, or certificate recovery |
| Profile worker | Downloading profiles and activating signed collector bundles |
| Collector child | One scheduled script or ubus collector execution at a time |
| Tunnel worker | One remote session, including gateway TLS/WebSocket and local LuCI/SSH forwarding |

There is at most one enrollment/profile worker at a time and at most one
scheduled collector child at a time. Bundle activation is performed by the
profile worker, so activation and a scheduled collector can overlap.

The main event loop is driven at approximately 50 ms intervals after its initial
startup delay. Slow HTTPS work and collector execution do not block the main
loop. The enrollment worker has a 60-second supervision deadline. The profile
worker has a 600-second deadline. A timed-out worker is killed as a process
group.

Individual RMS HTTPS requests use a 5-second connect timeout and a 15-second
total timeout. Monotonic time is used for retry and scheduling decisions.
Wall-clock time is used for certificate validity and observation timestamps.

On SIGINT or SIGTERM, the process exits its event loop, kills any worker,
stops collection, closes the tunnel, disconnects MQTT, removes its control
socket and status file, and exits. procd can then respawn it according to the
init script policy.

## 3. Files, sockets, and trust material

### Configuration

The UCI package is niseva and the normal configuration file is
/etc/config/niseva. The installed default is in agent/files/niseva.config.

The general section contains:

- mode: enabled, standby, or disabled
- server: hosted or custom
- hosted_hostname and hosted_port, or hostname and port for a custom server
- enrollment_token
- retry_initial, retry_initial_period, retry_regular, retry_standby
- standby_after

Provisioning adds or updates:

- device_id
- mqtt_host
- mqtt_port
- organization_name

A successful claimed bootstrap atomically updates the relevant UCI options in
one commit and clears enrollment_token. The token is therefore a bootstrap
credential, not a permanent runtime credential.

### Identity and certificates

The persistent trust directory is /etc/xnet-rms:

- /etc/xnet-rms/client.key: generated EC P-256 private key
- /etc/xnet-rms/client.crt: device client certificate
- /etc/xnet-rms/ca.crt: RMS CA certificate
- /etc/xnet-rms/collectors: collector cache and active versions
- /etc/xnet-rms/collector.pub: collector bundle verification key
- /etc/xnet-rms/retry-state.json: retry and automatic-standby state
- /etc/xnet-rms/installation-url: server binding lock

The server binding lock prevents a provisioned device from silently switching
to a different RMS server URL. Changing the server after enrollment requires
explicit reprovisioning.

### Runtime files and sockets

The agent uses:

- /var/run/niseva-rms.sock: Unix datagram control socket
- /var/run/niseva-rms-status.json: main status snapshot
- /var/run/niseva-rms-worker.json: last worker result while a worker runs
- /tmp/xnet-rms-profiles.json: atomically replaced active profile document
- /tmp/xnet-rms-collectors: temporary collector execution material
- /tmp/rms-ssh: temporary authorized-key overlay for a remote SSH session

The status file and runtime status JSON are mode 0600. The agent sets umask
0077 before creating sensitive files.

## 4. Startup sequence

At startup the agent:

1. Installs signal handlers and initializes OpenSSL randomness.
2. Initializes uloop, libmosquitto, and the in-memory telemetry queue.
3. Detects board identity and platform metadata.
4. Loads UCI configuration and validates the configured server and retry values.
5. Restores retry state if it belongs to the current configured mode.
6. Creates and binds the Unix datagram control socket.
7. Starts MQTT only when the device is fully provisioned and the mode is not
   disabled.
8. Starts the periodic main tick and independent heartbeat timer.

The package default mode is enabled. That does not mean the agent can connect
immediately: it still needs a valid clock, a valid server configuration, a
device identity, a provisioned MQTT endpoint, client certificate, and CA trust.

The agent generates a new boot_id for each process start. A service restart
therefore creates a new telemetry run identity even when the Linux system has
not rebooted.

### Board identity detection

Identity detection uses the following sources and fallbacks:

- Serial and board data from /var/xnet_board_info.json
- The configured UCI LAN bridge/device and
  /sys/class/net/DEVICE/address for the MAC address
- /tmp/sysinfo/model for the model
- DISTRIB_ARCH from /etc/openwrt_release for architecture
- /etc/openwrt_version for firmware version
- A serial fallback of MAC-MAC_ADDRESS when no real serial is available
- A random boot_id for the current process run

An explicitly configured serial number takes precedence over detected data.
There is no shared demo serial fallback.

## 5. Configuration validation and operating modes

The agent recognizes three configured modes:

- enabled: enrollment, certificate maintenance, MQTT, profiles, collection, and
  tunnels are allowed
- standby: the agent remains installed but uses the standby retry schedule
- disabled: no enrollment, MQTT, profile synchronization, collection, or tunnel
  processing is performed

Invalid UCI values make the configuration invalid. Hostnames are restricted to
the accepted hostname character set, ports must be within the valid TCP range,
and the server URL must use HTTPS.

A device is considered provisioned only when all of the following are true:

- configuration is valid
- device_id has the accepted RMS identifier format
- mqtt_host is present
- mqtt_port is valid
- client.crt exists
- the certificate is not missing, expired, or otherwise due for recovery

The CA and client key/certificate are still required for the MQTT TLS setup.
A provisioned-looking UCI record alone is not sufficient.

### Retry behavior

Failures are persisted in retry-state.json. The first failure period uses
retry_initial for retry_initial_period. Later failures use retry_regular.
Configured standby mode uses retry_standby.

Random jitter is added to retry delays. If enabled mode has failed continuously
for standby_after, the agent enters automatic standby and persists that state.
A successful MQTT connection clears the failure state and automatic standby
state.

The control command /usr/sbin/niseva-agent --connect sends a datagram to the
control socket and causes an immediate connection/enrollment scheduling
attempt when the mode and configuration permit it.

## 6. First enrollment workflow

The first enrollment is a challenge-response flow. The private key is generated
locally and is not sent to RMS.

### Preconditions

The enrollment worker requires:

- router wall clock at or after 2020
- a usable serial number
- a MAC address with the expected format
- an EC P-256 key at /etc/xnet-rms/client.key, generated or reused locally
- a valid HTTPS server URL and CA trust

If a known identity key exists, the agent does not replace it silently. This
prevents a restart or repeated check-in from changing the device identity.

### Bootstrap sequence

1. The agent creates a CSR from the local private key.
2. It sends the device metadata, CSR, enrollment token, and agent version to
   POST /api/v1/provision/bootstrap/challenge.
3. RMS returns a challenge_id and a challenge message.
4. The agent requires the exact message prefix
   xnet-rms/bootstrap/v1:CHALLENGE_ID:
5. The agent signs the complete challenge message with the local private key.
6. It sends the challenge response to
   POST /api/v1/provision/bootstrap/check-in.
7. RMS returns the registration state and, after claim approval, the device ID,
   client certificate, MQTT endpoint, MQTT port, and organization.
8. The agent validates the returned certificate before installing it.
9. The agent atomically installs the certificate and atomically commits the
   provisioned UCI options, clearing the enrollment token.
10. The agent reloads configuration, initializes MQTT, and schedules profile
    synchronization.

The registration response may indicate not_registered, awaiting_claim, or
revoked. Those are recorded as registration states and retried according to
the normal worker schedule; they are not treated as successful provisioning.

### Certificate checks

Before installation the agent checks that the certificate:

- has the expected device ID in its identity
- is valid for client authentication
- chains to the configured CA
- matches the locally held private key
- has acceptable validity dates

The certificate is written atomically so a power loss cannot leave a partial
certificate file.

## 7. Certificate renewal and recovery

Certificate maintenance runs when the device is provisioned and the certificate
is due.

The current policy is:

- more than 90 days remaining: no certificate operation
- 90 days or less remaining: authenticated renewal
- expired, missing, not-yet-valid, or invalid certificate: recovery flow

### Renewal

Renewal uses the current client certificate and mTLS:

POST /api/v1/provision/renew

The returned certificate undergoes the same identity, purpose, CA, and key-match
checks before atomic replacement.

### Recovery

Recovery is used when the current certificate cannot authenticate:

1. The agent requests a recovery challenge from
   POST /api/v1/provision/challenge.
2. It requires the message prefix
   xnet-rms/recovery/v1:DEVICE_ID:
3. It signs the challenge with the persistent local private key.
4. It submits the signed response to POST /api/v1/provision/recover.
5. It validates and atomically installs the replacement certificate.
6. It reloads configuration and resumes MQTT connection attempts.

Recovery preserves the device key. It does not generate a replacement identity
key unless the original key is absent.

## 8. MQTT connection and heartbeat

Once provisioned, the agent creates a Mosquitto client whose client ID is the
device_id. MQTT uses:

- TLS with /etc/xnet-rms/ca.crt
- the client certificate and private key
- hostname verification
- TLS 1.2
- a 30-second keepalive
- a maximum of four in-flight MQTT messages

It subscribes to:

- rms/v1/devices/DEVICE_ID/commands
- rms/v1/devices/DEVICE_ID/acks

The last-will message publishes {"status":"offline"} on the device heartbeat
topic. On a successful connection the agent publishes an online heartbeat and
clears the failure state. Disconnects record mqtt_disconnected and schedule a
jittered reconnect.

Heartbeat is independent of telemetry queue delivery. A healthy heartbeat does
not prove that every telemetry record has been applied by RMS.

## 9. Profile synchronization and collector bundles

Profile synchronization is performed over authenticated HTTPS after the device
is provisioned and periodically thereafter.

### Profiles

The agent requests:

GET /api/v1/agent/profiles

The response is validated and stored atomically at
/tmp/xnet-rms-profiles.json. The implementation limits the number of profiles
and validates each profile's interval, timeout, and maximum output size:

- interval: 60 to 300 seconds
- timeout: 1 to 15 seconds
- maximum output: 256 to 32,768 bytes

The implementation enforces the documented minimum and maximum bounds.

A profile can describe a ubus collector, a signed script collector, or one of
the explicitly allowlisted built-in collectors shipped with the agent.

### Built-in device overview collector

The `device_overview` built-in collector runs
`/usr/libexec/xnet-rms/device-overview.sh`. It reads `/proc`, the active
network interface counters, and the installed cellular ubus API. The collector
prefers a discovered `cellulard-v2` modem and normalizes its information,
signal, network, and bearer responses; when that API is unavailable, it falls
back to the legacy `cellulard2` `cellular.status` response. It is fixed by
collector ID and cannot execute a profile-supplied command. CPU and throughput
are calculated from the previous sample stored under `/tmp`; the first sample
therefore omits those rates. RSRP, SINR, and temperature are omitted when the
router's modem or thermal subsystem does not expose them.

### Built-in IPsec collector

The `ipsec` built-in collector uses `/usr/libexec/xnet-rms/ipsec-vici` when the
optional `niseva-agent-ipsec` package is installed. That executable loads
strongSwan's VICI client library at runtime and issues only the read-only
`list-conns` and `list-sas` requests. It emits one stable entity per configured
connection/CHILD_SA, marks a tunnel `UP` only when the IKE state is
`ESTABLISHED` and the CHILD_SA state is `INSTALLED`, and includes endpoints,
selectors, algorithms, timers, byte counters, and packet counters. If the
optional executable is absent, the agent retains the existing `ipsec.lua`
fallback, which parses the allowlisted `swanctl` text output.

### ubus collector

A ubus profile invokes:

/bin/ubus call OBJECT METHOD JSON_ARGUMENTS

The command runs with bounded capture. Its stdout must be a complete JSON
object or array within the configured output limit.

### Signed script collector

For a script bundle, the agent requests:

GET /api/v1/agent/bundles/BUNDLE_ID?version=VERSION

The agent validates:

- returned bundle ID and version
- script size, no more than 65,536 bytes
- a shebang beginning with #!
- SHA-256 digest
- signature over the exact message:

xnet-rms/collector/v1
BUNDLE_ID
VERSION
SHA256

The signature is checked using /etc/xnet-rms/collector.pub.

The script is activated only after verification and a bounded activation run
succeeds. Activation must exit 0 or 2 and emit complete JSON. The versioned
file, current/previous/next links, and version metadata are updated atomically.
The profile document is replaced only after all required profile and bundle
operations succeed.

An existing exact versioned file may be reused without downloading it again.
The current code does not garbage-collect old bundle versions.

## 10. Collector scheduling and result envelope

Each profile gets a randomized initial delay between 0 and 29 seconds. The
scheduler starts no more than one scheduled collector child at a time.

The collector child:

- receives the profile-defined timeout and output limit
- has stdout captured through a nonblocking pipe
- has stdin and stderr connected to /dev/null
- runs in its own process group
- is killed on timeout or output overflow
- must produce one complete JSON object or array

Exit and parse results map to:

- exit 0 and valid JSON: status ok
- exit 2: status unsupported
- any other exit, malformed JSON, timeout, or overflow: status error

The current execution boundary does not provide an OS sandbox or CPU/RAM
quota. Collectors execute with the privileges of the agent service. Collector
profiles and signed bundles must therefore be treated as privileged code.

Every result is wrapped in an envelope containing:

- schema_version
- device_id
- source_id
- profile_id and profile_version
- boot_id
- sequence
- observed_at
- status
- error
- dropped
- data

The sequence starts at 1 for each agent process. observed_at is the collection
start time. A service restart resets the in-memory sequence.

## 11. Telemetry queue, publish, and application acknowledgment

Telemetry is buffered in a FIFO linked queue in RAM.

Queue rules:

- total accounted queue memory is limited to 2 MiB
- an individual payload cannot exceed 64 KiB
- when the queue is full, the oldest records are dropped
- the dropped count is included in later envelopes
- one queue head is attempted at least every two seconds
- MQTT QoS 1 is used for transport

A record is removed only after the agent receives the matching RMS application
acknowledgment. The ACK must match:

- boot_id
- source_id
- exact sequence

An MQTT PUBACK only confirms broker receipt. It is not the application ACK
that confirms RMS has accepted the telemetry record.

The queue, dropped count, and sequence are in memory. They are lost on agent
restart. The heartbeat and current connection status do not reconstruct lost
telemetry.

## 12. MQTT remote commands

The agent accepts commands only on:

rms/v1/devices/DEVICE_ID/commands

The implemented actions are:

- open_session
- close_session

For open_session the agent validates:

- session ID is present and valid
- protocol is HTTP_LUCI, SSH_LUCI, or TERMINAL_SSH
- the gateway URL uses HTTPS
- expiration is in the future and no more than 900 seconds ahead
- SSH_LUCI and TERMINAL_SSH include a public key

Only one tunnel session is active at a time. A new session is rejected or
replaces work according to the current tunnel state; it does not create
multiple concurrent tunnels.

close_session requests the current session to stop. Expiration, tunnel-worker
exit, process errors, and agent shutdown also trigger cleanup.

## 13. Tunnel establishment and cleanup

The tunnel worker parses the gateway HTTPS host and port, waits for TCP
connectivity, and creates a TLS 1.2 connection. It validates the gateway
certificate against the RMS CA and expected gateway host or address, then
performs a WebSocket upgrade at:

/router/SESSION_ID

The agent presents its client certificate and key for gateway authentication.

A tunnel session creates temporary access state and removes it on every exit
path:

1. The agent creates a temporary SSH authorized-key overlay under
   /tmp/rms-ssh/authorized_keys.
2. It preserves the permanent
   /etc/dropbear/authorized_keys content.
3. If the Dropbear authorized-key path is absent, it creates an empty temporary
   target so the bind mount is valid; an existing file is never replaced.
4. It bind-mounts the temporary file over the Dropbear authorized-key path.
5. If the bind mount fails, the session fails instead of continuing with an
   uncertain access policy.
6. On close, expiration, worker failure, or shutdown, it unmounts the overlay
   and removes temporary files.

### HTTP_LUCI

The agent creates a local rpcd session through ubus, grants the required
permissions, and proxies HTTP requests to local LuCI/rpcd services. Cookies
and request/response data are carried in JSON WebSocket frames with base64
bodies.

Paths, headers, request body, and response body are bounded. The current body
and response limits are approximately 1 MiB, and the local request timeout is
10 seconds.

The rpcd session is destroyed during tunnel cleanup.

### SSH_LUCI

The agent connects to local Dropbear at 127.0.0.1:22 and establishes an rpcd
session for LuCI context. It sends a WebSocket text frame containing the LuCI
session cookie, then proxies the raw SSH byte stream.

### TERMINAL_SSH

The agent connects to local Dropbear at 127.0.0.1:22 and proxies the raw SSH
stream. The agent does not create the terminal PTY itself. The gateway/backend
creates the operator shell and PTY side of the terminal session.

The tunnel worker uses parent-death signaling and closes all local and remote
sockets during cleanup.

## 14. Status and operational inspection

The following command prints the current status file:

/usr/sbin/niseva-agent --status

If the service is not running, it returns a compact agent_not_running result.
When running, status includes fields such as:

- mode and effective_mode
- automatic_standby
- registration_state
- connection_state
- last_error
- serial_number, LAN MAC, model, firmware, and agent version
- device_id and organization
- last_success
- next_connection_after
- token_configured

Useful local checks on a router include:

~~~sh
/etc/init.d/niseva-agent status
logread -e niseva
/usr/sbin/niseva-agent --status
ls -l /etc/xnet-rms /var/run/niseva-rms-*.json
ubus call system board
uci show niseva
~~~

The Unix control socket is a datagram socket. A datagram received by the agent
is a scheduling nudge; it is not a general command protocol and does not
authenticate arbitrary payloads.

## 15. Security and trust boundaries

The design relies on the following boundaries:

- The device private key stays on the router.
- Bootstrap and recovery challenges must be signed by that key.
- Enrollment and recovery use HTTPS with CA and hostname verification.
- MQTT and tunnel connections use mTLS.
- Collector bundles require a trusted public-key signature.
- Provisioned server URL is locked to prevent silent server switching.
- Temporary SSH authorization is overlaid only for the lifetime of a session.
- WebSocket session expiry is bounded to 15 minutes at command validation.
- Local collector and tunnel processes are bounded for output and time, but
  collector code still runs with the agent's privileges.

The outer gateway TLS path validates the RMS gateway. The local Dropbear SSH
connection is to 127.0.0.1 and is used as the router-side transport endpoint;
the agent does not use it as a second independent RMS identity channel.

## 16. Failure and recovery matrix

| Failure | Agent behavior |
| --- | --- |
| Invalid UCI or server URL | Marks configuration invalid and does not start connection work |
| Clock before 2020 | Enrollment/PKI operation fails until time is corrected |
| No serial or MAC | Enrollment worker fails and retries |
| Awaiting claim or not registered | Records registration state and retries; does not install runtime identity |
| Reprovisioning to a different server | Refuses due to installation-url lock |
| MQTT disconnect | Records error, publishes no false healthy state, and reconnects with jitter |
| Certificate near expiry | Runs renewal |
| Missing/expired certificate | Runs challenge-based recovery |
| Profile or bundle validation failure | Keeps the previously active profile document |
| Collector timeout/overflow/malformed JSON | Emits an error or unsupported result; scheduler continues |
| Telemetry queue full | Drops oldest records and reports the dropped count in later data |
| Missing application ACK | Keeps the queue head and retries delivery |
| Tunnel expiry or close command | Stops tunnel and removes temporary SSH overlay |
| SSH bind mount failure | Refuses to start the session |
| Worker deadline exceeded | Kills the worker process group and schedules retry |
| Agent process exit | Cleans up local state; procd may respawn the service |

## 17. Build, package, and qualification workflow

### Host checks

The CMake host build and runtime tests exercise bounded runtime behavior,
telemetry queue rules, HTTPS URL restrictions, output capture, and SSH overlay
cleanup. They do not prove operation on a specific OpenWrt router.

Run the repository's host build and tests from the repository root using the
project's normal CMake configuration. Also run:

~~~sh
git diff --check
~~~

### MIPS package build

agent/scripts/build-mips.sh expects OPENWRT_ROOT to point at an OpenWrt
checkout with the target-mips_24kc_musl staging/toolchain already available.
It cross-compiles, strips, checks the resulting binary, and builds an IPK.

The ImageBuilder or feed installation step must be target-specific. A successful
host build or IPK creation does not prove that the package installs, that procd
starts it, that the router's CA and UCI values are correct, or that live
MQTT/HTTPS/WebSocket traffic succeeds.

### Live qualification

A meaningful router qualification should verify, on the target hardware:

1. package installation and service startup
2. board identity and clock detection
3. bootstrap challenge and claim transition
4. certificate installation and renewal/recovery
5. MQTT online heartbeat and reconnect behavior
6. profile download and signed bundle activation
7. ubus and script collector envelopes
8. queue behavior with application ACK and reconnect
9. HTTP_LUCI, SSH_LUCI, and TERMINAL_SSH session cleanup
10. reboot, certificate expiry/recovery, and power-loss file integrity

A source review, host test, or dry validation must not be reported as hardware
qualification.

## 18. Current implementation boundaries

The following are intentional or current limits visible in the code:

- There is one active tunnel session per agent.
- Telemetry is RAM-buffered and is lost on process restart.
- Collector output, runtime, and count are bounded, but there is no complete
  OS-level sandbox or resource quota for collector code.
- Old collector bundle versions are not garbage-collected.
- Terminal SSH forwarding does not create a local PTY; the gateway does.
- Agent status is a local JSON snapshot, not a durable event log.
- MQTT PUBACK is not application acceptance.
- The UCI package version, runtime agent version, and MIPS packaging version are
  currently inconsistent and should be unified before release.
- agent/src/rollback.c contains a UCI watchdog helper, but the current MQTT
  command path does not dispatch that rollback action; it should not be
  described as an active remote command.

## 19. Source-of-truth map

| Concern | Main implementation |
| --- | --- |
| Main loop, modes, retries, status, MQTT | agent/src/main.c |
| Board identity, bootstrap, renewal, recovery | agent/src/bootstrap.c |
| HTTPS helpers and atomic files | agent/src/runtime.c |
| Profiles and signed collectors | agent/src/collectors.c |
| Telemetry queue and application ACKs | agent/src/telemetry.c |
| MQTT command validation | agent/src/commands.c |
| Session lifecycle and SSH overlay | agent/src/tunnel.c |
| Gateway TLS/WebSocket and local proxies | agent/src/tunnel_worker.c |
| Service packaging | agent/Makefile and agent/files/niseva.init |
| Default UCI configuration | agent/files/niseva.config |
| MIPS packaging helper | agent/scripts/build-mips.sh |
| Host runtime tests | agent/tests/runtime_test.c |
