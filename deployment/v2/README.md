# Contabo RMS test installation

Prepared for `xnet-rms-test.duckdns.org` on `82.180.146.203`.
This is an isolated test installation, not a production capacity qualification.

## Install

From the uploaded release directory on the VPS, review and run:

```sh
sudo bash install-contabo-test.sh
```

The script requires the already-issued hostname and wildcard certificates under
`/home/ubuntu/.local/share/xnet-rms-acme/config/live`. It refuses existing RMS
configuration, database/role collisions and occupied RMS ports.

It creates only:

- PostgreSQL database and restricted owner role `xnet_rms_v2`.
- Linux service accounts `xnet-rms-core`, `xnet-rms-tunnel`, `xnet-rms-mqtt`.
- `/opt/xnet-rms`, `/etc/xnet-rms`, `/var/lib/xnet-rms`.
- Three named RMS systemd services and an RMS certificate renewal timer.
- Private installation CA and collector signing material generated on the VPS.
- Initial administrator credentials in `~ubuntu/.config/xnet-rms/initial-login.txt`.
- Router public trust files in `~ubuntu/xnet-rms-router-trust`.

| Service | Endpoint |
|---|---|
| Core/dashboard | `https://xnet-rms-test.duckdns.org:8445` |
| Dedicated MQTT with client certificates | `xnet-rms-test.duckdns.org:8883` |
| Tunnel ingress | `https://xnet-rms-test.duckdns.org:9443` |
| Browser session | `https://<session-id>.xnet-rms-test.duckdns.org:9443` |

Port 8443 is already occupied on this VPS. The installer does not modify Nginx,
existing Mosquitto configuration, PostgreSQL cluster settings, or firewall rules.
Inbound reachability of the new ports must be checked after installation.

Test raw retention is **30 days**, summaries **365 days**. Production retention
should be revisited after capacity measurements. Each service has separate CPU/memory limits. These are initial
test limits, not evidence of 10,000-router capacity.

## Verify

```sh
systemctl status xnet-rms-core xnet-rms-tunnel xnet-rms-mqtt --no-pager
curl --fail https://xnet-rms-test.duckdns.org:8445/health
curl --fail https://xnet-rms-test.duckdns.org:9443/health
```

View the generated administrator login locally on the VPS. Do not post its
password or installation private keys in logs or chat. The next functional step
is enrollment of one XE33 2S, followed by profile/telemetry and remote-session tests.

Certificate renewal uses a dedicated configuration directory. The timer checks
daily and restarts only RMS services when copied certificate contents change.
Such a restart closes active RMS remote sessions. Hostname and wildcard lineages
are separate because DuckDNS exposes one TXT value. The hook waits for DNS
propagation, including secondary-validator caches.

## Remaining launch gates

Router dependency/flash verification, live agent enrollment, collector/bundle
activation, LuCI/terminal compatibility and cleanup, outage/replay tests, VPS
network/firewall checks, measured retention/capacity, external encrypted backup
provisioning and a restore drill remain outstanding. Backup scripts are provided
but no off-VPS destination has been configured. The installer does not claim
production readiness.

If installation fails partway, inspect the error before rerunning. It deliberately
refuses to replace an existing database or identity authority; do not delete those
to force a retry. Continue from the failed stage using the generated configuration.
