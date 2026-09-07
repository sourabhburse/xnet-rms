#!/bin/sh
set -eu
changed=0
base=/home/ubuntu/.local/share/xnet-rms-acme/config/live
for role in core tunnel broker; do
  owner=xnet-rms-$role
  [ "$role" != broker ] || owner=xnet-rms-mqtt
  dir=/etc/xnet-rms/$role-pki
  cmp -s "$base/xnet-rms-host/fullchain.pem" "$dir/server.crt" || changed=1
  install -m 0600 -o "$owner" -g "$owner" "$base/xnet-rms-host/fullchain.pem" "$dir/server.crt"
  install -m 0600 -o "$owner" -g "$owner" "$base/xnet-rms-host/privkey.pem" "$dir/server.key"
done
for suffix in crt key; do
  src=fullchain.pem; [ "$suffix" != key ] || src=privkey.pem
  cmp -s "$base/xnet-rms-sessions/$src" "/etc/xnet-rms/tunnel-pki/wildcard.$suffix" || changed=1
  install -m 0600 -o xnet-rms-tunnel -g xnet-rms-tunnel "$base/xnet-rms-sessions/$src" "/etc/xnet-rms/tunnel-pki/wildcard.$suffix"
done

if [ "$changed" = 1 ] && [ "${1:-}" = --restart-if-changed ]; then
  systemctl try-restart xnet-rms-mqtt.service xnet-rms-core.service xnet-rms-tunnel.service
fi
