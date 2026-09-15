#!/bin/sh

# Optional, read-only health collector for the Modbus acquisition gateway.
# Routers without a known Modbus service report the source as unsupported.

set -u
PATH=/usr/sbin:/usr/bin:/sbin:/bin

service=''
for candidate in modbus-master-v2 modbus_master_v2 modbus-to-any modbus_to_any; do
	if [ -x "/etc/init.d/$candidate" ]; then
		service=$candidate
		break
	fi
done

if [ -z "$service" ]; then
	printf '%s\n' '{}'
	exit 2
fi

state=stopped
if "/etc/init.d/$service" running >/dev/null 2>&1; then
	state=running
fi

# This is a boot-local counter derived from the bounded system log. Reporting
# already records counter resets, including a reset caused by log rotation.
errors=$(logread 2>/dev/null | awk '
	BEGIN { n=0 }
	{
		line=tolower($0)
		if (line ~ /modbus/ && line ~ /(error|failed|timeout|crc|exception)/) n++
	}
	END { print n }
')
case "$errors" in ''|*[!0-9]*) errors=0 ;; esac

printf '{"gateway_state":"%s","communication_errors":%s}\n' "$state" "$errors"
