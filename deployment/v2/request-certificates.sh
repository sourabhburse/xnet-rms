#!/bin/sh
set -eu
umask 077
base="$HOME/.local/share/xnet-rms-acme"
hook="$HOME/.local/lib/xnet-rms/duckdns-hook.py"
mkdir -p "$base/config" "$base/work" "$base/logs"
# DuckDNS has one TXT value: request host and wildcard certificates sequentially.
# Separate lineages also keep renewals from needing simultaneous TXT values.
certbot certonly --manual --preferred-challenges dns \
 --manual-auth-hook "$hook" --manual-cleanup-hook "$hook cleanup" \
 --config-dir "$base/config" --work-dir "$base/work" --logs-dir "$base/logs" \
 --non-interactive --agree-tos --register-unsafely-without-email \
 --key-type ecdsa --elliptic-curve secp256r1 \
 --cert-name xnet-rms-host -d xnet-rms-test.duckdns.org
certbot certonly --manual --preferred-challenges dns \
 --manual-auth-hook "$hook" --manual-cleanup-hook "$hook cleanup" \
 --config-dir "$base/config" --work-dir "$base/work" --logs-dir "$base/logs" \
 --non-interactive --agree-tos --register-unsafely-without-email \
 --key-type ecdsa --elliptic-curve secp256r1 \
 --cert-name xnet-rms-sessions -d '*.xnet-rms-test.duckdns.org'
