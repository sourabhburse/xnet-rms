#!/bin/sh
# Read-only diagnostics; does not print credentials, UCI secrets, or private keys.
set -u
echo '=== Firmware ==='
cat /etc/openwrt_release
uname -m
echo '=== Clock ==='
date -u
echo '=== Memory ==='
head -n 5 /proc/meminfo
echo '=== Writable flash ==='
df -k /overlay /etc 2>/dev/null || true
echo '=== Required runtime packages ==='
opkg list-installed | sed -n '/^libc /p;/^libgcc/p;/^libubox/p;/^libuci/p;/^libmosquitto/p;/^libcurl/p;/^libopenssl/p;/^ubus /p;/^rpcd /p;/^uhttpd /p;/^lua /p;/^luci-lib-jsonc /p;/^strongswan/p'
echo '=== Existing RMS identity (presence only) ==='
for file in ca.crt collector.pub client.crt client.key; do
  if [ -s "/etc/xnet-rms/$file" ]; then echo "$file: present"; else echo "$file: absent"; fi
done
echo '=== IPsec tooling ==='
command -v swanctl || true
command -v ipsec || true
echo '=== Local LuCI listener ==='
netstat -lnt 2>/dev/null | sed -n '/:80 /p;/:443 /p'
