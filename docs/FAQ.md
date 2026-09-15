# XNET RMS client FAQ

**Status:** client-facing FAQ for the active implementation
**Date:** 2026-09-11

For a technical component map and detailed flows, see the
[XNET RMS architecture overview](ARCHITECTURE.md).

## Product and connectivity

### What is XNET RMS?

XNET RMS is a remote management platform for OpenWrt routers. It provides
centralized device onboarding, fleet telemetry, monitoring, alerts, reports,
and controlled remote access to LuCI and the router terminal.

### Does the router need a public IP address?

No. The router initiates outbound HTTPS, MQTT, and WebSocket connections to the
RMS installation. This is designed to work behind NAT and carrier-grade NAT
(CGNAT), provided the router can make outbound connections to the required RMS
endpoints.

### Do I need to open an inbound port on the router?

No. Remote sessions use an outbound connection from the router to the RMS
tunnel gateway. No inbound port-forwarding rule is required on the router.

### Which outbound services must be allowed?

The router needs outbound access to:

- the RMS HTTPS API for onboarding, certificates, and profile synchronization;
- the RMS MQTT endpoint, normally TCP port `8883`, for telemetry and commands;
- the RMS tunnel HTTPS/WebSocket endpoint, normally TCP port `9443`, for remote
  sessions.

The exact hostnames and ports are provided with the installation configuration.

### What is present in the database immediately after installation?

A fresh installation contains the database schema and migration metadata, plus
exactly one customer organization and one `ORG_ADMIN` account. It contains no
sample routers, telemetry, alerts, enrollment tokens, groups, tags, templates,
bundles, or demo users. The organization is necessary to scope the admin
account. The built-in router overview profile is created only when the first
router is enrolled.

The initial bootstrap command refuses to add an account to a database that
already contains application data, which prevents duplicate or mixed demo
installations.

### What happens if the router temporarily loses internet access?

The router keeps retrying with its configured backoff and jitter. Telemetry is
buffered in a bounded 2 MiB RAM queue while the agent is running. If the queue
fills, the oldest records are discarded. The queue is not persistent across an
agent restart, so telemetry that was never delivered before a restart cannot be
replayed.

The router's normal local functions are not replaced by RMS. Only cloud
features such as telemetry delivery and remote sessions are affected while the
RMS connection is unavailable.

## Onboarding and certificates

### What information is needed to onboard a router?

The onboarding process uses the router's serial number, LAN MAC address, model,
firmware and agent version. Depending on the workflow, the router also uses an
organization enrollment token or a pre-created registration request.

### Does the router's private key leave the router?

No. The agent generates and retains its P-256 private key locally under
`/etc/xnet-rms/client.key`. RMS receives a certificate signing request and a
proof that the router owns the key, not the private key itself.

### How long is the router certificate valid?

The device certificate is issued for **one calendar year**. The certificate
contains the RMS device identity and is used for device authentication.

### What happens when 90 days remain on the certificate?

Nothing is disabled at that point. Ninety days remaining marks the automatic
renewal window. The agent renews the certificate over authenticated HTTPS,
validates it, and atomically replaces the old certificate while keeping the
same device identity and private key.

### What happens if certificate renewal fails?

The current certificate remains in use until it actually expires. The agent
continues retrying renewal. If the certificate becomes unusable, the agent uses
the recovery challenge flow and the existing private key to request a
replacement certificate.

Until recovery succeeds, RMS features that require device authentication—such
as MQTT telemetry, profile synchronization and remote sessions—will be
unavailable. The router is not automatically factory-reset.

### What can cause certificate renewal or recovery to fail?

Common causes include an incorrect router clock, missing CA trust, DNS or
firewall problems, an unreachable RMS endpoint, or a revoked device. The router
status page reports the connection state and last error; the router clock and
outbound connectivity should be checked first.

### Can an administrator revoke a router?

Yes. A revoked router is rejected by the RMS API, MQTT authorization and tunnel
gateway. Revocation blocks RMS access; it does not erase the router's local
configuration or files.

## Telemetry, monitoring and reports

### What telemetry does RMS collect?

The default device overview can include cellular signal, network registration,
operator and band, SIM/data connectivity, CPU and memory, uptime, throughput,
temperature and network counters. Additional approved sources can expose
IPsec or Modbus health when those capabilities exist on the router.

The exact fields depend on the assigned monitoring profile and the capabilities
reported by the router.

### How often is telemetry collected?

The default device overview runs approximately every 60 seconds. Monitoring
profiles are bounded to an interval between 60 and 300 seconds. A missing
hardware capability is reported as unsupported rather than as a zero value.

### How does RMS decide whether a router is online?

The fleet view considers a non-revoked device online when its last accepted
heartbeat is within approximately 180 seconds. A longer gap makes the device
appear offline. Monitoring templates can also enable their own stale-data
alerting rule.

### Can customers choose their own metrics?

Yes, through the server-owned monitoring catalog. Customers can select typed
metrics and apply versioned templates to a device, group or tag. The platform
converts those selections into router profiles.

The dashboard does not provide unrestricted shell execution. Collectors are
limited to approved built-in collectors, allowlisted read-only `ubus` methods,
or cryptographically signed collector bundles.

### How do monitoring alerts behave?

Alerts are evaluated from incoming telemetry and stored in PostgreSQL. By
default, two matching violating samples are required to open an alert. Two
healthy samples are required to resolve it. Warning conditions can escalate to
critical, and operators can acknowledge open alerts.

Stale-data rules are evaluated separately by the RMS maintenance process.

### Can monitoring be applied to groups or tags?

Yes. A binding can target one device, a device group, or a customer tag. When
membership changes, RMS recalculates the effective profile assignments and
resolves alerts that no longer have a valid assignment.

### How long is telemetry retained?

Retention is configured per RMS installation. The active server requires at
least 30 days of raw telemetry retention. The current test deployment uses 30
days of raw data and 365 days of hourly summaries; production values should be
confirmed for the customer installation.

Reports use hourly or daily summaries and can be exported as CSV. Detailed
device views use current snapshots and recent raw history.

## Remote access

### Which remote services are available in the current release?

The active dashboard supports:

- browser-based LuCI access through `SSH_LUCI`;
- an interactive browser terminal through `TERMINAL_SSH`.

The current active routes do not provide the older roadmap features sometimes
mentioned in historical material, such as desktop SFTP/high-port forwarding or
LAN-device forwarding.

### Does RMS know or replace the router's LuCI password?

The RMS session authorizes the temporary tunnel only. For LuCI, the operator
must sign in using the router's own LuCI credentials. The gateway does not
generate or inject a router `sysauth` cookie.

### How long does a remote session last?

Sessions start with a 15-minute lifetime. An authorized operator can extend a
session in 15-minute increments, up to a maximum of one hour from its creation.
Only one active session is allowed per router, and the current system caps
active sessions at 25.

### What happens when a remote session expires or is closed?

The RMS database session is closed, the gateway tears down its WebSocket pair,
and the router stops its tunnel worker. For SSH-based sessions, the temporary
authorized-key overlay is unmounted and removed. A later session must go
through the authorization and onboarding checks again.

### Is the remote session permanent?

No. Sessions are short-lived, ticket-based and tied to an operator, router and
protocol. The browser receives a one-time launch URL, which is exchanged for a
host-only session cookie.

## Security and access control

### How is communication protected?

RMS uses TLS 1.2. Routers authenticate with device client certificates for
post-enrollment API, MQTT and tunnel connections. The MQTT broker applies
device-scoped topic ACLs, and the tunnel service authenticates to the core with
its own service certificate.

### Can one customer see another customer's routers?

Customer users are restricted to their organization. The core applies role and
organization checks to protected API requests, and database ownership and
constraint checks reinforce those boundaries. Platform `SUPER_ADMIN` users can
operate across customer organizations.

### Which user roles are available?

| Role | Typical access |
| --- | --- |
| `VIEWER` | View devices, telemetry, reports, monitoring and alerts |
| `OPERATOR` | Viewer access plus remote sessions and alert acknowledgement |
| `ORG_ADMIN` | Operator access plus customer users, onboarding, groups and tags |
| `SUPER_ADMIN` | Platform-wide organization, profile, bundle and device administration |

The exact action is still checked by the API; the table is a practical summary,
not a replacement for the authorization policy.

### What information is stored in RMS?

RMS stores customer and user records, device identity metadata, public keys,
enrollment state, current telemetry, raw history, summaries, monitoring
definitions, alerts, sessions and audit events. The router's private key is
retained on the router and is not stored in PostgreSQL.

### Is data encrypted at rest?

Data is encrypted in transit by TLS. Database and filesystem encryption at rest
depends on the infrastructure and storage controls selected for the hosted or
on-premise installation; it should be covered by the customer deployment
security requirements.

## Router operation and support

### How can I check the agent status on the router?

Use the router's LuCI page under **Services → RMS**, or run:

```sh
/usr/sbin/niseva-agent --status
```

The status includes connection state, registration state, device identity,
agent version, next connection attempt and the last error. The LuCI page also
provides **Connect now**.

### What does “standby” mean?

`enabled` permits enrollment, MQTT, profile synchronization, collection and
remote sessions. `standby` keeps the agent installed but uses its slower retry
schedule. `disabled` stops RMS connection, collection and tunnel processing.

The agent can also enter automatic standby after a configured period of
continuous connection failure. A successful MQTT connection clears that
automatic standby state.

### Does RMS automatically change router configuration?

The agent contains a 180-second rollback watchdog for supported UCI
configuration commands. It snapshots the relevant configuration before an
apply and can revert if cloud connectivity is lost. Whether a particular
configuration workflow is exposed depends on the installed product release;
the current active cloud routes should be confirmed before promising a rollout.

### Does the current release provide firmware updates?

Firmware rollout is not part of the current active dashboard/API surface
described here. Firmware and OpenWrt package updates should be handled through
the approved router release process unless a separate product release enables
that capability.

### Can the system be deployed on-premise?

The product is designed for both hosted multi-tenant and closed-source
on-premise deployments. The exact installation, certificate authority,
capacity, backup and licensing arrangement depends on the customer deployment.

### Where can I find the technical architecture?

See the [XNET RMS architecture overview](ARCHITECTURE.md), which includes
system diagrams, data flows, session flows, database responsibilities and
current implementation boundaries.
