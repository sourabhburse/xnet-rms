#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || { echo "Run as root on the intended RMS host" >&2; exit 1; }
cd "$(dirname "$0")"
[ -f xnet-rms ] && [ -f rms_acl.so ] || { echo "Build the release bundle first" >&2; exit 1; }
for role in core tunnel mqtt; do
  id "xnet-rms-$role" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "xnet-rms-$role"
done
install -d -m 0755 /opt/xnet-rms /etc/xnet-rms /var/lib/xnet-rms
install -d -m 0755 -o xnet-rms-core -g xnet-rms-core /var/lib/xnet-rms/revoked
install -m 0755 xnet-rms /opt/xnet-rms/xnet-rms
install -m 0644 rms_acl.so /opt/xnet-rms/rms_acl.so
for unit in xnet-rms-core xnet-rms-tunnel xnet-rms-mqtt; do install -m 0644 "$unit.service" /etc/systemd/system/; done
[ -f /etc/xnet-rms/mosquitto.conf ] || install -m 0644 mosquitto.conf /etc/xnet-rms/mosquitto.conf
for role in core tunnel; do [ -f "/etc/xnet-rms/$role.env" ] || install -m 0600 "$role.env.example" "/etc/xnet-rms/$role.env"; done
systemctl daemon-reload
echo "Files installed. Provision database, PKI, configuration and migrations before explicitly starting RMS services."
