# NCMS / XNET RMS — complete product roadmap

Planning baseline: 2026-09-07. Read alongside [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md) for access, build, deployment and operational commands.

## 1. Plan status and intended outcome

Build a customer-isolated management platform for our routers, covering device lifecycle, monitoring, configuration, firmware/files, remote access, tasks, alerts, reports and integrations. Include LAN access and centrally managed VPN as later product stages if confirmed by the product owner.

The previously agreed Release 1 is the committed baseline. This document proposes the complete expansion requested for planning; it does not silently authorize every later feature, establish delivery dates, or declare unfinished implementation complete. Decisions below remain open until answered. Stage order reflects technical dependencies and can be adjusted to customer priorities.

Use NCMS / XNET RMS provisionally; final product naming is undecided. The separate legacy NCMS services already on the VPS are not automatically part of this codebase and must not be modified as a side effect.

### Accepted direction: Teltonika-style platform and real SSH

**Confirmed customer-workflow priority:** (1) complete monitoring, (2) bulk configuration, (3) access devices behind the router. This order supersedes the optional sequencing suggestions below. The existing numbered stages remain reference IDs, not a strict delivery sequence.

| Delivery priority | Scope and dependencies | Completion evidence |
|---|---|---|
| 1. Complete monitoring | Reconcile current implementation; finish monitoring reliability from Stage 1 and collector/fleet workflows from Stage 2. Cover system, WAN/interfaces, cellular/SIM, usage, IPsec and supported Wi-Fi/location sources, with custom profiles, history and freshness. | Each advertised field has a validated source and semantics; physical telemetry, history/filter consistency, failure handling and replay tests pass. Hardware-dependent fields are explicitly unsupported where unavailable. |
| 2. Bulk configuration | Build the minimum durable job foundation from Stage 3, then Stage 4: backups, supported GET/SET, diffs, validation, templates, canary/batch apply, per-device results and connectivity-safe rollback. | Interrupted and partially failed jobs reconcile correctly; incompatible changes are rejected; loss of connectivity triggers tested device-local recovery. |
| 3. LAN-device access | Deliver Stage 7 using the existing tunnel, with customer/router/destination authorization and protocol-specific credentials. Confirm initial protocols and endpoint examples before implementation. | Authorized real LAN endpoints are reachable without public router IPs; wrong destinations/tenants are rejected and expiry/revocation stops access. |

Do not make the full task-manager UI, firmware rollout, reports or VPN prerequisites for monitoring. Keep security, deployment recovery and relevant qualification work alongside each priority. Later module order remains open.

The user reports SSH through the RMS tunnel is working. Preserve that capability and reconcile its implementation/tests with the current checkout; this report does not independently qualify temporary-key expiry, both client modes or failure cleanup.

The user confirmed the full device-management platform as the product goal, with the original Release 1 as its first milestone. Browser terminal and native SSH-client access are both required. Router terminal access will use the router's SSH server through an RMS-authorized outbound tunnel, replacing direct shell/PTY creation by the agent. Interactive SSH may still request a PTY from the SSH server.

The user accepted temporary session-key authorization: after customer/role checks, authorize a session-specific public key on the router, establish the SSH session, then remove authorization and terminate the active session on closure, expiry or revocation. No shared fleet root password or repeated router-password prompt is intended. This is an accepted design, not a claim that it is implemented.

Implementation must determine browser-side key custody and native-client key registration/bootstrap without exporting server private keys to users. Verify supported Dropbear algorithms/restrictions, authenticate the router's SSH host key through trusted device identity, preserve existing authorized keys, and restrict access to the intended router endpoint. Enforce expiry on the router even if RMS becomes unreachable. Removing a public key alone does not terminate existing SSH sessions; cleanup must explicitly cover those sessions and startup recovery. Preserve the current one-session-per-router policy unless separately changed.

### Why this expands the original release

Original Release 1: enrollment, customer roles, monitoring/custom telemetry, LuCI, terminal access and audit records. Notifications, general firmware rollouts, file transfer and LAN forwarding were explicitly later features.

| Original capability | Additional product capability | Additional engineering required |
|---|---|---|
| Enroll a device | Zero-touch customer deployment | Desired configuration, compatibility checks, application, verification and rollback |
| Open one router terminal | Execute a fleet task | Durable jobs, target selection, delivery, execution records, cancellation, retries and outcomes |
| Read device state | Change network configuration | Validation, secret handling, connectivity-safe commit and recovery |
| Store collector scripts | Distribute firmware/files | Larger artifacts, resume/integrity, compatibility, storage limits, rollout and recovery |
| Proxy router LuCI | Access arbitrary LAN endpoints | Destination authorization, endpoint credentials, protocol adapters, session quotas and network isolation |
| Monitor IPsec | Operate VPN hubs | VPN identity, address allocation, routing, overlapping subnets, lifecycle and bandwidth management |
| Display history | Generate scheduled reports | Report definitions, jobs, aggregation, export, storage and delivery |
| Mark device offline | Alert and react automatically | Event transitions, suppression, notification delivery, action rules and loop prevention |

We can reuse identity, authorization, messaging and persistence. These additional workflows still need explicit implementation and verification. No feature-count percentage or calendar estimate is asserted without a scoped backlog and staffing information.

## 2. Architecture to preserve and extend

Preserve the C agent, Go core, Go tunnel, dedicated Mosquitto, PostgreSQL and React dashboard. Keep one server codebase/release with separately limited processes. Do not add infrastructure solely to resemble another product.

Proposed shared additions:

- Durable jobs and per-device attempts, initially backed by PostgreSQL. MQTT delivers references/notifications; database state remains authoritative.
- Versioned artifacts for configuration, collectors, firmware and files, each with its own validation, permissions and retention policy. Decide local storage versus external object storage from measured requirements.
- Device capability inventory keyed by hardware, firmware and agent versions, so incompatible operations are rejected before delivery.
- Event records for connectivity, source health and operation outcomes, feeding alerts, reports and audit views.
- Scoped integration identities and a documented API, using the same authorization and jobs as the dashboard.

Scale workers or separate storage only when measurements justify it. Long operations must not block the core API, telemetry ingestion, heartbeat or remote sessions.

### Shared rules across all stages

1. Every device, job, artifact, session, event and query has explicit customer ownership. A resource ID is never sufficient authorization.
2. Private router keys stay on the router. Preserve certificate recovery, rotation and revocation; never replace these with shared fleet passwords.
3. Collector profiles remain team-managed under the accepted model. End-user executable-script upload is not implied by custom monitoring or task features.
4. A device accepting a command is different from successfully completing it. Report verified outcomes and unknown/interrupted outcomes explicitly.
5. Mutating operations carry an idempotency key and operation-specific retry rules. Do not claim exactly-once execution across power loss; reconcile uncertain outcomes before repeating a destructive action.
6. Logs and audit records omit credentials, private keys and session tokens. Configuration/task output needs explicit redaction and access controls.
7. Monitoring connectivity, source freshness and measurement validity are separate states. Unsupported fields are not zero values.
8. Capacity, offline installation and hardware support claims require measured evidence for the actual supported configuration.

## 3. Release map and dependencies

| Stage | Deliverable | Depends on | Proposed milestone |
|---|---|---|---|
| 0 | Reconciled code/build/deployment baseline | Existing implementation | Reproducible development baseline |
| 1 | Qualified secure monitoring and router access | 0 | Original Release 1 |
| 2 | Standard monitoring and usable fleet administration | 1 | Daily fleet operations |
| 3 | Durable operations and controlled tasks | 1; fleet targeting from 2 | Shared operations platform |
| 4 | Configuration lifecycle and zero-touch deployment | 3 | Configuration management |
| 5 | Events, alerts, automation and reports | 2; actions require 3 | Proactive operations |
| 6 | General files and firmware rollouts | 3; recovery work from 4 | Device lifecycle management |
| 7 | LAN access and additional remote protocols | Qualified tunnel from 1 | Expanded remote support |
| 8 | VPN hubs and remote networks | 7 plus separate VPN decisions | Managed VPN, if approved |
| 9 | Enterprise administration and integration productization | Starts in 1; builds on 2–8 | Broader organization/integration support |
| 10 | Scale/offline qualification for expanded scope | Each enabled stage | Supported deployment profiles |

Stage 10 is recurring qualification, not permission to defer Release 1 backups or load testing. Follow the confirmed monitoring → bulk configuration → LAN access order above; Stage 3 supplies the job foundation for configuration, and Stage 7 precedes the remaining optional expansions. Parallel implementation requires agreed file ownership and independent deliverables, not concurrent changes to the same agent runtime.

## 4. Stage 0 — reconcile the active implementation

**Outcome:** everyone can identify exactly what source and binaries are running.

Work:

- Review changes from other agents; preserve unrelated modifications and record ownership of active work.
- Capture Git state, source/build timestamp, package version and SHA256 for agent, server, broker plugin and embedded UI. Compare with the physical router and VPS.
- Refresh router reachability and status; the handoff's latest SSH timeout is historical evidence, not a current diagnosis.
- Review child-process changes in main.c, collectors.c and tunnel.c. Establish one child-reaping owner, preserve real exit status and verify collector/worker cleanup through uloop.
- Replace stale status claims in documentation with dated evidence. Track every defect with reproduction, expected behavior and a test.
- Build into distinct output directories; version releases consistently instead of repeatedly publishing different binaries under an indistinguishable version.

Acceptance: a reproducible release manifest, identified deployed binaries, a cleanly described outstanding-defect list and a tested update/rollback procedure. ECHILD must not be treated as proof of child success.

## 5. Stage 1 — complete and qualify the agreed Release 1

### 1A. Identity, access and customer isolation

- Qualify generated/imported enrollment tokens, maximum uses/expiry, duplicate device identities and ownership preservation.
- Test certificate renewal, expired-certificate challenge recovery, challenge replay rejection, revoked devices and clock problems.
- Verify MQTT certificate-to-topic and certificate-to-client-ID binding, including reconnect and core-client takeover attempts.
- Enforce roles on every API and session operation; test cross-customer list/detail/history/filter access, profile administration and user disablement.
- Record enrollment, authorization changes and session opening/closure without secrets.

### 1B. Reliable monitoring

- Qualify scheduled ubus and signed-script profiles, intervals of 60–300 seconds, timeouts, output bounds and explicit collection errors.
- Verify snapshot envelope identity/profile/version/time/boot/sequence, post-commit ACK, exact ACK matching, deduplication and paced replay.
- Confirm the 2 MiB queue's total accounting, oldest-first discard and visible drop counts under load.
- Resolve backlog durability explicitly: current RAM queue loses data on reboot. Preserve and document that policy unless reboot-surviving storage is selected after flash-wear and resource measurements.
- Verify heartbeats mark silence offline within three minutes, while collector failures/staleness remain independently visible.
- Validate current/history separation, late arrivals, partition expiry, counter resets and typed summaries.
- Qualify bundle signature checks, failed activation, previous-version retention and a defined rollback mechanism; distinguish atomic installation from automatic rollback after runtime failure.

### 1C. Router remote access

- Test real 2S LuCI without a second login, session-scoped cookies/assets/forms and absence of a global proxy fallback.
- Replace the agent-spawned shell with forwarding to the router SSH server. Implement both browser terminal and native SSH-client access with temporary session-key authorization as described above.
- Test SSH input/output and terminal resize, host-key verification, key installation/removal, expiry, revocation, crashes and router/server restart cleanup. Verify a lost RMS connection cannot leave session authorization active indefinitely. Preserve unrelated local SSH access and authorized keys.
- Verify wrong-router/browser rejection, revoked authorization and one active session per router with a busy response.
- Test 25 simultaneous sessions in the agreed environment; define what happens at capacity without disrupting existing sessions.

### 1D. Deploy and qualify

- Preserve existing VPS applications; baseline CPU/RAM/disk/network and their response times.
- Run local tests first; obtain an off-hours VPS window and numeric stop conditions before shared-host load tests.
- Exercise 10,000 simulated devices, one-minute worst-case collection, reconnect bursts and backlog replay. Payload/source counts must be stated; device count alone is not a workload specification.
- Measure actual 2S flash, memory and CPU with IPsec, TLS, collection, full queue and remote access together.
- Compare seven/30-day retention and select production raw/summary retention only after review.
- Provision encrypted off-VPS backups and perform a restore drill with a 24-hour recovery-time target and at most 24 hours of lost data. Include database, profiles, artifacts and CA recovery material.
- Test a clean offline installation with local trust, local time, migrations and trusted dependencies. Confirm device renewal/recovery works without public internet.

Acceptance: all original functional/isolation gates have recorded results; unsupported behavior and operational limits are explicit; deployment and restore evidence exists. A pilot with stated limits may precede capacity qualification, but it must not be sold as qualified for 10,000 routers.

## 6. Stage 2 — standard monitoring and fleet administration

### Device and fleet model

- Add customer-scoped tags, groups, sites and descriptive inventory fields only after agreeing which are needed. Keep ownership separate from labels/group membership.
- Add capability inventory and firmware/agent version refresh, last contact, enrollment and certificate status.
- Implement saved fleet views, source-aware filters, bulk selection and server-side pagination. Device-detail and fleet values use the same normalized definitions.
- Replace routine raw-JSON administration with validated forms and previews; retain an advanced editor for team profile authors.
- Design a clear customer context and predictable admin/operator/viewer actions. Unauthorized controls must also be rejected by the API.

### Collector packs

| Pack | Fields and behavior | Qualification focus |
|---|---|---|
| System | CPU utilization, load, RAM, filesystem/flash, uptime, temperature where available | CPU sampling deltas, mount choice, units, unavailable sensors |
| WAN/network | WAN state/IP, interfaces, addresses, RX/TX counters and rates | Stable interface IDs, failover, counter wrap/reset, multiple WANs |
| Cellular | SIM state/slot, registration, carrier, radio technology, signal and modem temperature | Actual service schema, dual-SIM changes, RAT-specific signal units, missing values |
| Usage | RX/TX accumulation over agreed periods | Reboots, counter resets, billing-period boundaries and accuracy claims |
| Ethernet/Wi-Fi | Link state/speed, radio/SSID state and approved client statistics | Hardware support, configuration variants and client-data privacy |
| Location | GPS or manually supplied site location | Explicit origin/accuracy, stale fixes, hardware support and access policy |
| IPsec | Per-tunnel IKE/CHILD state and available diagnostics | Available strongSwan interface, stable IDs, unsupported configurations; no PID inference |

Store connection transition events and derive downtime/availability using an explicitly documented heartbeat uncertainty window. Add source-health summaries and metadata-driven charts. Review gauge/counter/state chart semantics rather than plotting every number identically.

Acceptance: each advertised field has a source, unit, applicability, failure semantics and real-device fixture/qualification result. Filters, charts and fleet views agree. A clean device receives the intended standard profile through an explicit assignment policy.

## 7. Stage 3 — durable operations and task management

**Outcome:** a common reliable execution path for tasks, configuration, firmware and automated actions.

Backend:

- Persist job, immutable request revision, resolved target set, per-device operation, attempts, result and audit link.
- Define states such as queued, delivered, accepted, running, succeeded, failed, expired, canceled and outcome-unknown. State transitions must be validated, timestamped and recoverable.
- Resolve group/tag membership at dispatch and retain that target snapshot; do not silently add new devices to an approved job.
- Define deadlines, concurrency/rate limits, offline-device behavior, retry classification and cancellation semantics. Cancellation cannot promise to reverse an already completed change.
- Use a transactional dispatch/outbox pattern and worker leases so server restart does not lose jobs or produce uncontrolled duplicates.

Agent:

- Advertise supported operations; reject unsupported versions and parameters.
- Execute approved actions with duration/output bounds and heartbeat independence.
- Persist only the minimum operation reconciliation state required; decide flash budget and wear limits before implementation.
- Deduplicate operation delivery and distinguish receipt, start and verified completion. Define power-loss reconciliation for each action.

UI/API: preview targets and parameters, submit a job, view per-device progress/results, cancel pending work and retry eligible failures. Treat arbitrary shell execution as a separate permission/product decision from approved typed operations.

Acceptance: disconnect, duplicate delivery, worker crashes, restart, expired jobs, partial fleet failure and oversized output have deterministic documented outcomes. Cross-customer targets are rejected, and retries cannot blindly repeat destructive commands.

## 8. Stage 4 — configuration lifecycle and zero-touch deployment

Deliver incrementally:

1. Read-only configuration inventory and encrypted, versioned per-device backups, with secret redaction in normal UI/API responses.
2. Supported typed GET/SET operations with capability/schema validation and before/after diff. Do not expose unrestricted UCI writes as a finished configuration API.
3. Device-local staged apply and confirmation timer for connectivity-affecting changes. Preserve last-known-good configuration and automatically revert if verification/confirmation fails, including server loss.
4. Templates with variables, per-device overrides, compatibility constraints, revision history and dry-run validation.
5. Bulk jobs with a canary group, pause/stop criteria and explicit per-device outcomes; retries use the same operation engine.
6. Enrollment-to-template assignment for zero-touch deployment, including dependencies, secret delivery, validation and verified completion.
7. Scheduled configuration backups, retention, download/upload and restore through the same compatibility and rollback controls.

Wi-Fi/router hotspot configuration can use this system once schemas are supported. A full hotspot product with portals, users/vouchers or accounting is a separate scope decision.

Acceptance: wrong firmware/model/schema is rejected; secrets remain protected; a configuration that cuts RMS connectivity reverts locally; power loss, server interruption and partial fleet failures are tested. Restore must preserve or intentionally reestablish RMS identity rather than clone another router's private key.

## 9. Stage 5 — alerts, automation and reports

### Alerts/events

- Define customer-owned rules over connectivity, source freshness, measurements, counters and operation results.
- Support threshold duration, hysteresis, deduplication, maintenance windows, acknowledge/resolve and clear notification state.
- Begin with the notification channels selected by the product owner; implement retries, delivery status, destination validation and per-customer limits.
- Preserve event time versus receipt time: replayed old telemetry must not unexpectedly trigger a present-time emergency action.

### Automation

- Combine event/schedule triggers, conditions and approved job actions.
- Add cooldowns, rate limits, cycle/loop prevention, dry-run preview, action audit and an immediate disable control.
- Keep rules/actions constrained by the creator's and current customer's permissions. Reevaluate authorization at execution, including disabled users/credentials.
- Define timezone and daylight-saving behavior for schedules.

### Reports

- Define saved report templates by customer, device/group selection, parameters, period, timezone and aggregation.
- Generate one-time reports first, then scheduled reports via background jobs.
- Select initial formats explicitly (for example CSV before PDF); store generated artifacts with access controls and retention.
- Include missing/stale data, counter reset and sampling limitations in calculations. Historical charts alone do not satisfy this deliverable.

Acceptance: rule transitions do not flood recipients; stale/replayed data behaves as specified; delivery failures are visible; automation cannot loop or cross tenants; exported values match queries and permissions. Reports remain reproducible for the stated data/retention window.

## 10. Stage 6 — general files and firmware management

### Artifact service

- Separate firmware, configuration, collector and arbitrary file types. Store immutable version, digest, size, owner, uploader/signature and compatibility metadata.
- Add upload limits, integrity validation, retention and access rules. Choose storage/transfer design from expected artifact volume and router memory/flash limits.
- Support bounded or resumable transfers with verified completion and cleanup; never buffer a complete firmware image in agent RAM without a measured budget.

### Firmware workflow

- Inventory actual board/flash layout, supported image format, current firmware and upgrade mechanism before enabling an upgrade action.
- Validate trusted image origin/signature, checksum, model compatibility, free space and required power/network conditions.
- Separate download, verification, scheduled activation/reboot and post-boot health confirmation.
- Roll out to canaries, then bounded batches with automatic pause thresholds and operator visibility.
- Track expected versus reported version, timeout and recovery-required devices. A download ACK is not successful firmware installation.
- Define recovery per hardware. Do not promise automatic firmware rollback on a single-image device without a proven boot/recovery mechanism.

Acceptance: wrong-board/corrupt/untrusted images cannot activate; interrupted downloads recover; interrupted upgrades and boot failures have a tested recovery procedure on supported hardware; each fleet target has a durable result. File operations enforce destination restrictions and cannot overwrite agent trust/identity arbitrarily.

## 11. Stage 7 — access LAN devices and additional protocols

Start with explicitly configured LAN HTTP/HTTPS targets and SSH endpoints. Add RDP, VNC and SFTP only after protocol priorities and resource requirements are confirmed.

- Represent each target by customer, router, destination address/port, protocol, permitted users and optional credential reference.
- Authorize both router and destination. Restrict destinations to approved targets; prevent access to server metadata, tunnel infrastructure or unintended networks.
- Define endpoint credential entry/storage, browser isolation, certificate verification and session recording policy before implementation.
- Reuse short-lived session authorization, expiry, access history and limits; define how multiple LAN sessions interact with the current one-session-per-router rule.
- Isolate heavier protocol translation into appropriately limited server workers if required; do not force it into the constrained C agent.
- Validate devices behind NAT/carrier NAT through outbound router connections, including reconnect, throughput and cleanup.

Acceptance: access is restricted to the selected endpoint/customer; unsupported protocols fail clearly; expired/revoked sessions stop forwarding; endpoint traffic cannot escape authorization; realistic PLC/HMI/camera/PC examples are tested for the protocols actually advertised.

## 12. Stage 8 — centrally managed VPN, if selected

This is a separate network service, not an extension of IPsec status collection.

Decide VPN protocol, supported router/client software, hub placement, user identity, routing mode, address pools, overlapping customer subnets and bandwidth/resource model first. Do not choose these from product-name similarity.

Deliver hub lifecycle, router/user membership, credential rotation/revocation, route/ACL management, subnet access, connection status, usage and audit history. Begin with one supported topology and client platform; expand only after testing. A dedicated desktop/mobile VPN application is not assumed and needs a separate decision.

Acceptance: tenant and subnet isolation, overlapping-address strategy, route changes, MTU/DNS behavior, key revocation, reconnect and hub restart are verified. Document exposure to hub/VPS failure and prove the selected bandwidth/connection limits. Automatic failover remains out of scope unless explicitly added.

## 13. Stage 9 — enterprise administration and API integration

Foundational user/tenant security stays in Release 1; these are expansions:

- User invitations, password reset, MFA, session/account lifecycle, then SSO if selected.
- Decide flat customers versus parent/child companies; define who may administer or view child organizations before adding hierarchy.
- Add resource-level permissions/custom roles and scoped service accounts where required. Preserve explicit customer ownership through transfers and deletion policies.
- Publish versioned API schemas/examples and an error model. Provide scoped credential creation/rotation/revocation, rate limits, pagination and usage visibility.
- Support authorized programmatic session creation, jobs and report generation using the same core paths as the dashboard.
- Add authenticated webhooks with signatures, retries, idempotency and delivery history if required.
- Decide whether resource pools, licensing, quotas or billing belong in this product. A competitor's commercial quota is not automatically our requirement.

Acceptance: permission matrices have automated negative tests; disabled/revoked identities lose access; API credentials cannot exceed their scopes; browser and API actions have equivalent audit/isolation behavior. Public API compatibility and deprecation rules are documented.

## 14. Stage 10 — deployment qualification throughout the roadmap

Maintain supported deployment profiles for hosted and fully offline customers. Every release includes versioned migrations, trusted artifacts, compatibility requirements, installation/update/rollback instructions and backup/restore changes.

Measure separately:

- Router memory/CPU/flash and write rate per supported hardware/firmware/feature combination.
- Server ingestion and query performance with stated sources, payload sizes, intervals and replay load.
- Jobs/config/firmware concurrency and artifact transfer impact on telemetry and existing VPS services.
- Remote/VPN session throughput and CPU/RAM limits; remote access workload is distinct from telemetry device count.
- Raw/history/summary/artifact/audit storage growth and retention effectiveness.

Agree numeric service objectives and stop conditions before each capacity test. Capture baseline, scenario, versions, duration, measurements, failures and remaining uncertainty. Verify encrypted external backups and restore after schema/artifact/authority changes, not just at initial installation.

Offline tests must include loss of external DNS/internet, local time/trust provisioning, renewal/recovery, artifact delivery and restore. Deployment tooling must not disturb unrelated customer services. Single-VPS operation retains its documented single point of failure.

## 15. Decisions required before dependent stages

| Decision | Needed by | Why it matters |
|---|---|---|
| Final product name and relation to legacy NCMS | Product/UI release | Avoid conflating installations and codebases |
| Priority customers and first use cases | Stage 2 ordering | Determines collector, workflow and protocol priorities |
| Supported hardware/firmware matrix beyond this 2S | Stage 2/6 | Determines ABI, sensors, storage and recovery support |
| Accept RAM-only backlog or require reboot persistence | Stage 1 gate | Flash endurance, retained data and recovery semantics |
| Standard profile assignment policy | Stage 2 | Explicit customer/model defaults versus manual assignment |
| Arbitrary CLI tasks or approved operations only; who may run them | Stage 3 | Execution permissions and operational exposure |
| Configuration domains and safety/confirmation policy | Stage 4 | Network/Wi-Fi/cellular changes have different recovery requirements |
| Alert channels and escalation expectations | Stage 5 | Integrations, offline delivery and cost |
| Initial report formats and schedules | Stage 5 | Export/rendering and storage requirements |
| Firmware ownership/signing and hardware recovery method | Stage 6 | Trusted updates and bricked-device recovery |
| LAN protocol priorities and session concurrency | Stage 7 | Tunnel architecture and resource limits |
| VPN required, topology/protocol/client platforms | Stage 8 | Separate network/control-plane design |
| Company hierarchy, MFA/SSO and delegated support policy | Stage 9 | Identity and authorization model |
| Hosted/on-premises feature parity and commercial quotas | Stage 9/10 | Packaging, integrations and support commitments |
| Production retention, offsite backup destination, network limits | Stage 1 deployment gate | Cost, capacity and recoverability |
| Team availability, delivery dates and budget | Scheduling | No credible calendar estimate exists without these inputs |

## 16. Backlog and completion discipline

Turn each stage into bounded work items containing: user workflow, dependencies, owning component, data/API changes, device compatibility, authorization rules, failure behavior, tests, deployment steps and observable acceptance criteria.

Use statuses: proposed → decision-ready → ready to implement → implemented → locally tested → target/integration tested → deployment-qualified. Do not collapse these into one “done” label.

For each release retain a source/artifact manifest, migration record, qualification report, known limitations and recovery runbook. Update [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md) with verified deployment facts; this roadmap remains the product plan, not a live status dashboard.

The immediate next implementation work remains Stage 0 and the unfinished Stage 1 qualification. Later scope should be selected through the decisions above rather than starting all modules simultaneously.
