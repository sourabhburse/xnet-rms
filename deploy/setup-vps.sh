#!/bin/bash
set -e

echo "========================================================="
echo "   Setting up XNET Cloud RMS on VPS (82.180.146.203)"
echo "========================================================="

# 1. Install PostgreSQL if not installed
if ! command -v psql &> /dev/null; then
    echo "[1/4] Installing PostgreSQL 16..."
    apt-get update -q
    apt-get install -y -q postgresql postgresql-contrib
    systemctl enable postgresql
    systemctl start postgresql
fi

# 2. Configure Database & User
echo "[2/4] Initializing PostgreSQL database 'niseva_rms'..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'niseva_rms'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE DATABASE niseva_rms;"

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname = 'rms_admin'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE USER rms_admin WITH ENCRYPTED PASSWORD 'niseva_rms_secret_2026';"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE niseva_rms TO rms_admin;"
sudo -u postgres psql -d niseva_rms -c "GRANT ALL ON SCHEMA public TO rms_admin;"

# 3. Configure Mosquitto ACL Rules
echo "[3/4] Configuring Mosquitto broker ACL rules..."
mkdir -p /etc/mosquitto/conf.d
cp acl.conf /etc/mosquitto/conf.d/niseva_acl.conf || true

# Add backend user to mosquitto password file
if command -v mosquitto_passwd &> /dev/null; then
    if [ -f /etc/mosquitto/passwd ]; then
        mosquitto_passwd -b /etc/mosquitto/passwd niseva_backend backend_secret_2026 || true
    fi
fi
systemctl restart mosquitto || true

# 4. Install Service and Binary
echo "[4/4] Installing XNET RMS Server binary..."
mkdir -p /var/lib/niseva-rms
cp xnet-rms-server /usr/local/bin/xnet-rms-server
chmod +x /usr/local/bin/xnet-rms-server

cp niseva-rms.service /etc/systemd/system/niseva-rms.service
systemctl daemon-reload
systemctl enable niseva-rms.service
systemctl restart niseva-rms.service

echo ""
echo "========================================================="
echo "   ✅ XNET Cloud RMS is now running on your VPS!"
echo "   Web Console: http://82.180.146.203:8080"
echo "   Default Admin: admin@niseva.com / Admin@12345"
echo "   Service Status: systemctl status niseva-rms"
echo "========================================================="
