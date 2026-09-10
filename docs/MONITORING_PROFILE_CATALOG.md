# RMS monitoring catalog and customer templates

The public monitoring catalog is versioned and owned by the RMS platform.
Organization administrators compose immutable customer template versions from
catalog metric IDs, optional display labels, and gauge/state health thresholds.
They never submit `ubus` objects, arguments, or scripts. Raw profiles and signed
collector bundles remain `SUPER_ADMIN` interfaces, and the agent independently
allowlists read-only `ubus` methods.

Templates bind persistently to devices, groups, or tags. Effective assignments
are reconciled when membership, tags, enrollment, bindings, or template versions
change. Overlapping templates are compiled into the existing agent profile
contract by collector source: fields are unioned and the shortest requested
60–300 second interval wins.

## Baseline device overview profile

Every non-revoked device receives the `device_overview` profile during the
database migration and when it is enrolled or claimed. It uses the
`device_overview` built-in collector shipped with the agent, so it does not
depend on a user-published shell bundle. The collector emits flat fields for
CPU busy percentage, memory used percentage, RX/TX byte counters, aggregate
throughput in bytes per second, uptime, load averages, RSSI, registration,
operator, band, SIM state, and data connectivity. CPU and throughput are
unavailable in the first sample because they require a previous counter
sample. RSRP, SINR, and temperature are emitted only when the router exposes
those values; unsupported values remain absent rather than being reported as
zero.

## Cellular profile for `ubus call cellular status`

The current cellular service returns an object whose `message` field is a JSON
string containing an array. The agent unwraps a valid JSON `message` from an
`ubus` result while preserving it under that key. A profile can therefore use
the repeated entities below:

```json
{
  "id": "cellular-status",
  "version": 1,
  "name": "Cellular status",
  "source_id": "cellular",
  "type": "ubus",
  "object": "cellular",
  "method": "status",
  "interval_seconds": 60,
  "timeout_seconds": 5,
  "max_output_bytes": 32768,
  "entities": "/message",
  "entity_key": "/device",
  "fields": [
    {"id":"imei","path":"/imei","label":"IMEI","kind":"text"},
    {"id":"rssi","path":"/rssi","label":"Signal strength","unit":"dBm","kind":"gauge","chart":true,"fleet":true},
    {"id":"registration","path":"/registration","label":"Registration","kind":"state","fleet":true},
    {"id":"registration_code","path":"/registration_code","label":"Registration code","kind":"state"},
    {"id":"data_connectivity","path":"/data_connectivity","label":"Data connectivity","kind":"state","fleet":true},
    {"id":"roaming","path":"/roaming","label":"Roaming","kind":"state"},
    {"id":"plmn_description","path":"/plmn_description","label":"Operator","kind":"text","fleet":true},
    {"id":"plmn_code","path":"/plmn_code","label":"PLMN","kind":"text"},
    {"id":"band","path":"/band","label":"Radio band","kind":"text","fleet":true},
    {"id":"sim_status","path":"/sim_status","label":"SIM status","kind":"state","fleet":true},
    {"id":"port","path":"/port","label":"Modem port","kind":"text"}
  ]
}
```

The modem source should eventually be normalized before presentation: trim
strings, remove terminal `OK`/CRLF artifacts, strip wrapping quotes from fields
such as `net_type` and `plmn_description`, and convert `roaming` to a boolean.
An empty temperature must be reported as unavailable, never as zero.

## Profiles that produce useful reports

| Profile | Useful fields | Reporting use |
| --- | --- | --- |
| System health | uptime, load averages, CPU busy, RAM used/free, flash used/free, temperature | fleet health and reboot correlation |
| WAN and internet | interface state, IPv4/IPv6, gateway, DNS reachability, latency, packet loss | outage and connectivity reports |
| Cellular | signal, registration, operator, band, SIM, roaming, data connectivity, RX/TX counters | coverage, carrier, roaming, and data usage |
| Ethernet and Wi-Fi | link state, speed, errors, radio state, channel, associated clients | LAN and access-point health |
| VPN/IPsec | tunnel identity, state, peer, uptime, rekey time, bytes in/out, last error | per-tunnel availability and SLA reports |
| Storage and services | writable space, log pressure, service state, collector freshness | upgrade readiness and incident diagnosis |
| Industrial optional | Modbus acquisition service state and boot-local communication-error count | gateway health and communication incident correlation |
| Location | GPS fix, latitude, longitude, accuracy, fix age | fleet map where supported |

Use `gauge` for instantaneous values such as RSSI, temperature, CPU usage, and
latency. Use `counter` for monotonically increasing byte or packet totals. Use
`state` for registration, SIM, link, tunnel, and service states. Never average
states or cumulative counters; calculate deltas and availability windows in the
reporting layer.

The first useful reports are device availability, cellular registration
failures, WAN outage duration, data usage by device and month, VPN tunnel
uptime, temperature excursions, storage exhaustion risk, and stale-source
freshness. Keep raw snapshots for diagnosis and extract only declared fields
for filtering and charts.

## Reporting and retention

The RMS core keeps raw snapshots for the configured `RMS_RAW_DAYS` window and
rolls completed hours into `hourly_summaries`. The supported baseline is at
least 30 raw days; the test deployment keeps hourly summaries for 365 days.
Use `POST /api/v1/reports/telemetry/query` for paginated JSON and
`POST /api/v1/reports/telemetry/export.csv` for a streamed CSV. Requests select
a device, group, or tag; optional template and metric IDs; an RFC3339 range up
to 366 days; and hourly or daily resolution. Gauges expose count/minimum/
average/maximum/last, counters expose delta and reset count, states expose
time-in-state, and text fields expose last/distinct values. Report metadata also
includes warning/critical alert counts, durations, breaches, and current health.

Heartbeat-minute bitmaps are stored separately from telemetry so offline gaps
remain reportable when the router publishes no snapshots. Raw snapshots default
to 30 days; hourly summaries, heartbeat presence, and alert events default to
365 days.

## Threshold and alert lifecycle

Gauge thresholds support `gt`, `gte`, `lt`, `lte`, and outside-range rules;
state metrics map normalized values to healthy, warning, or critical. Critical
is evaluated before warning. Counter and text thresholds are rejected in v1.
An optional stale rule alerts after at least two expected intervals.

Two consecutive violations open or escalate an alert, and two consecutive
healthy evaluations resolve it. Acknowledgement records the operator but does
not change health. Alerts are isolated by organization, device, template
version, metric, and repeated-entity key. Version changes, unassignment, and
revocation resolve affected alerts with an explicit reason while preserving
append-only lifecycle events.

The device detail history remains a diagnostic view. Reports should be used
for longer windows and exports so the browser never loads the full raw
snapshot table.

## Organization and group model

Organizations own users, enrollment tokens, tags, groups, and devices. A user
query is always scoped to their organization; platform administrators may select
one organization or all organizations. Device groups are organization-owned,
and a device may belong to multiple groups. Adding or removing membership never
changes device ownership. An enrollment token may carry default group IDs; those
memberships are applied once when the router is first claimed. Repeated check-ins
do not reassign groups, and group IDs must belong to the token's organization.
