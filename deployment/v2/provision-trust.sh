#!/bin/sh
set -eu
: "${RMS_AUTHORITY_DIR:?Path to installation authority created with -mode init-ca}"
[ "$(id -u)" = 0 ] || exit 1
for role in core tunnel broker; do
  owner="xnet-rms-$role"; [ "$role" != broker ] || owner=xnet-rms-mqtt
  dst="/etc/xnet-rms/$role-pki"
  install -d -m 0700 -o "$owner" -g "$owner" "$dst"
  for file in ca.crt server.crt server.key; do install -m 0600 -o "$owner" -g "$owner" "$RMS_AUTHORITY_DIR/$file" "$dst/$file"; done
  case "$role" in
    core) files="ca.key rms-core.crt rms-core.key collector.key collector.pub" ;;
    tunnel) files="rms-tunnel.crt rms-tunnel.key" ;;
    broker) files="" ;;
  esac
  for file in $files; do install -m 0600 -o "$owner" -g "$owner" "$RMS_AUTHORITY_DIR/$file" "$dst/$file"; done
done
echo "Provision ca.crt and collector.pub on routers over a trusted channel; never copy CA or collector private keys to routers."
