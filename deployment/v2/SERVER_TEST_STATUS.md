# Contabo test deployment — 2026-09-07

Test dashboard: https://xnet-rms-test.duckdns.org:8445

Dedicated RMS core, tunnel and MQTT services are installed. PostgreSQL uses a separate RMS database and restricted role. Existing nginx, MQTT, NCMS and AIO services were checked active after installation and broker hardening.

Public core and tunnel health endpoints responded over verified HTTPS. Device MQTT uses port 8883 and client certificates. MQTT usernames and client IDs are bound to the authenticated certificate identity. Session subdomains use a separate wildcard HTTPS certificate. Certificate renewal is scheduled; an actual future renewal has not yet occurred.

The bounded live smoke run used two simulated routers and passed enrollment, MQTT client authentication, client-ID takeover prevention, snapshot acknowledgment/replay, deduplicated history, cross-device topic denial, wrong-router session rejection, wildcard HTTPS proxying, competing-session rejection and browser access denial after session closure. Simulator identities and their enrollment token are revoked on exit. Test organization and audit records remain intentionally. These checks do not establish actual LuCI or PTY behavior on a router.

The private router kit is in `artifacts/2s-test-kit/`, excluded from Git. It contains the mips_24kc IPK, public trust, preflight script and disabled configuration with a one-use lab enrollment token. Dashboard credentials remain in `/home/ubuntu/.config/xnet-rms/initial-login.txt` on the VPS. Do not publish either credentials file or the private kit.

Next hardware steps are dependency/ABI and writable-flash checks, clock/network verification, installation and enrollment, profile assignment, telemetry/replay checks, actual LuCI and terminal sessions, expiry/cleanup and resource measurement with IPsec active.

This is a functional test deployment, not a production qualification. Remaining launch gates include actual 2S resource measurements, capped off-hours capacity tests against a measured VPS baseline, seven-versus-thirty-day retention measurement, provider network limits, an encrypted off-VPS backup destination and a restore drill meeting the 24-hour recovery/data-loss objectives. The current seven-day raw retention is a test setting. The shared VPS remains a single point of failure.
