#!/bin/bash
# Installs only the isolated XNET RMS test services. Run after reviewing this file.
set -euo pipefail
umask 077
cd "$(dirname "$0")"
[[ $(id -u) == 0 ]] || { echo 'Run this installer with sudo.' >&2; exit 1; }
for tool in openssl psql runuser systemctl mosquitto python3; do command -v "$tool" >/dev/null; done
certbase=/home/ubuntu/.local/share/xnet-rms-acme/config/live
for cert in xnet-rms-host xnet-rms-sessions; do
  openssl x509 -in "$certbase/$cert/fullchain.pem" -noout -checkend 604800 >/dev/null
done
[[ -x ./xnet-rms && -f ./rms_acl.so ]] || { echo 'Release files missing'; exit 1; }
[[ ! -e /etc/xnet-rms/core.env ]] || { echo 'RMS already configured; refusing to overwrite. Use a reviewed upgrade.'; exit 1; }
for port in 8445 8883 9443; do
  if ss -H -lnt "sport = :$port" | read -r _; then echo "Port $port is occupied"; exit 1; fi
done
existing=$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname='xnet_rms_v2'")
[[ "$existing" == 0 ]] || { echo 'RMS database role already exists; refusing to overwrite.'; exit 1; }
existing=$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -d postgres -c "SELECT count(*) FROM pg_database WHERE datname='xnet_rms_v2'")
[[ "$existing" == 0 ]] || { echo 'RMS database already exists; refusing to overwrite.'; exit 1; }
password=$(openssl rand -hex 32)
jwt=$(openssl rand -hex 32)
adminpass=$(openssl rand -hex 16)
# Passwords are generated on this host and are not printed.
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d postgres >/dev/null <<SQL
CREATE ROLE xnet_rms_v2 LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$password';
CREATE DATABASE xnet_rms_v2 OWNER xnet_rms_v2;
REVOKE ALL ON DATABASE xnet_rms_v2 FROM PUBLIC;
SQL
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d xnet_rms_v2 >/dev/null <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE,CREATE ON SCHEMA public TO xnet_rms_v2;
SQL
bash ./install-files.sh
install -m 600 contabo-core.env.example /etc/xnet-rms/core.env
install -m 600 contabo-tunnel.env.example /etc/xnet-rms/tunnel.env
# Seven-day retention is for this isolated test installation only.
printf '\nDATABASE_URL=postgres://xnet_rms_v2:%s@127.0.0.1:5432/xnet_rms_v2?sslmode=disable\nJWT_SECRET=%s\nRMS_RAW_DAYS=7\nRMS_SUMMARY_DAYS=30\n' "$password" "$jwt" >> /etc/xnet-rms/core.env
RMS_PKI_DIR=/etc/xnet-rms/authority /opt/xnet-rms/xnet-rms -mode init-ca -hosts 'xnet-rms-test.duckdns.org,*.xnet-rms-test.duckdns.org'
RMS_AUTHORITY_DIR=/etc/xnet-rms/authority bash ./provision-trust.sh
install -m 0755 refresh-public-certificates.sh /opt/xnet-rms/refresh-public-certificates
/opt/xnet-rms/refresh-public-certificates
set -a
source /etc/xnet-rms/core.env
set +a
/opt/xnet-rms/xnet-rms -mode migrate
RMS_ADMIN_EMAIL=admin@xnet-rms.test RMS_ADMIN_PASSWORD="$adminpass" /opt/xnet-rms/xnet-rms -mode admin
install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.config/xnet-rms
printf 'URL: https://xnet-rms-test.duckdns.org:8445\nEmail: admin@xnet-rms.test\nPassword: %s\n' "$adminpass" > /home/ubuntu/.config/xnet-rms/initial-login.txt
chown ubuntu:ubuntu /home/ubuntu/.config/xnet-rms/initial-login.txt
install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/xnet-rms-router-trust
cat /etc/xnet-rms/authority/ca.crt /usr/share/ca-certificates/mozilla/ISRG_Root_X1.crt > /home/ubuntu/xnet-rms-router-trust/ca.crt
install -m 0644 /etc/xnet-rms/authority/collector.pub /home/ubuntu/xnet-rms-router-trust/collector.pub
chown -R ubuntu:ubuntu /home/ubuntu/xnet-rms-router-trust
install -m 0644 xnet-rms-certificates.service xnet-rms-certificates.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now xnet-rms-mqtt.service xnet-rms-core.service xnet-rms-tunnel.service xnet-rms-certificates.timer
echo 'RMS test services installed. Initial login is in ~/.config/xnet-rms/initial-login.txt for ubuntu.'
echo 'Ports: core 8445, MQTT 8883, tunnel 9443. Existing web/MQTT services were not reconfigured.'
echo 'Firewall reachability, enrollment, router operation and backup destination still require verification.'
