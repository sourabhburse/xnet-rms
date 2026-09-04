#!/bin/bash
set -e

VPS_HOST="${1:-82.180.146.203}"
VPS_USER="${2:-root}"

echo "========================================================="
echo " Creating VPS Deployment Bundle for $VPS_HOST..."
echo "========================================================="

BUNDLE_DIR="/tmp/xnet-rms-bundle"
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

# Copy binary, service, acl, and setup script
cp backend/xnet-rms-server "$BUNDLE_DIR/"
cp deploy/niseva-rms.service "$BUNDLE_DIR/"
cp deploy/setup-vps.sh "$BUNDLE_DIR/"
cp deploy/mosquitto/acl.conf "$BUNDLE_DIR/"

# Package into tarball
tar -czf deploy/xnet-rms-vps-bundle.tar.gz -C /tmp xnet-rms-bundle

echo "Bundle created at deploy/xnet-rms-vps-bundle.tar.gz ($(ls -lh deploy/xnet-rms-vps-bundle.tar.gz | awk '{print $5}'))"
echo ""
echo "To deploy directly to your VPS, run:"
echo "---------------------------------------------------------"
echo "scp deploy/xnet-rms-vps-bundle.tar.gz $VPS_USER@$VPS_HOST:/root/"
echo "ssh $VPS_USER@$VPS_HOST \"tar -zxvf xnet-rms-vps-bundle.tar.gz && cd xnet-rms-bundle && bash setup-vps.sh\""
echo "---------------------------------------------------------"
