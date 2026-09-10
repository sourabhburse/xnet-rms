#!/bin/sh

# Built-in, read-only collector for the fields used by the device overview.
# It deliberately emits only values that are available on this router. The
# agent supervisor bounds the process lifetime and output size.

set -u
umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin
STATE=/tmp/xnet-rms-device-overview.state
STATE_TMP="$STATE.$$"

json='{' first=1

valid_number() {
	case "$1" in
		''|*[!0-9.-]*) return 1 ;;
		*) return 0 ;;
	esac
}

add_number() {
	valid_number "$2" || return 0
	[ "$first" -eq 1 ] || json="$json,"
	json="$json\"$1\":$2"
	first=0
}

add_string() {
	[ -n "$2" ] || return 0
	value=$(printf '%s' "$2" | tr '\r\n' '  ' | sed -E 's/[[:space:]]+/ /g; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^"//; s/"$//')
	[ -n "$value" ] || return 0
	escaped=$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g')
	[ "$first" -eq 1 ] || json="$json,"
	json="$json\"$1\":\"$escaped\""
	first=0
}

# CPU busy percentage is derived from two /proc/stat samples. The first
# snapshot has no valid rate yet, so cpu_usage_percent is intentionally absent.
set -- $(awk '$1 == "cpu" {print $2, $3, $4, $5, $6, $7, $8, $9; exit}' /proc/stat 2>/dev/null)
cpu_total=''
cpu_idle=''
cpu_percent=''
sample_time=$(date +%s 2>/dev/null || echo 0)
if [ "$#" -ge 5 ]; then
	cpu_total=$(( $1 + $2 + $3 + $4 + $5 + $6 + $7 + $8 ))
	cpu_idle=$(( $4 + $5 ))
	if [ -r "$STATE" ]; then
		read old_total old_idle old_time old_rx old_tx < "$STATE" || true
		if [ "${old_total:-}" -ge 0 ] 2>/dev/null && [ "${old_idle:-}" -ge 0 ] 2>/dev/null && [ "${old_time:-}" -ge 0 ] 2>/dev/null && [ "$cpu_total" -gt "$old_total" ] && [ "$sample_time" -gt "$old_time" ]; then
			cpu_percent=$(awk -v total="$cpu_total" -v idle="$cpu_idle" -v old_total="$old_total" -v old_idle="$old_idle" 'BEGIN { d=total-old_total; b=d-(idle-old_idle); if (d>0 && b>=0) printf "%.1f", (100*b)/d }')
		fi
	fi
fi
add_number "cpu_usage_percent" "$cpu_percent"

# Memory values are exported both as a percentage for the overview and as
# bounded byte gauges for the detailed telemetry table.
mem_total_kb=$(awk '/^MemTotal:/ {print $2; exit}' /proc/meminfo 2>/dev/null || true)
mem_available_kb=$(awk '/^MemAvailable:/ {print $2; exit}' /proc/meminfo 2>/dev/null || true)
if valid_number "${mem_total_kb:-}" && valid_number "${mem_available_kb:-}" && [ "$mem_total_kb" -gt 0 ] 2>/dev/null; then
	add_number "memory_total_bytes" "$((mem_total_kb * 1024))"
	add_number "memory_available_bytes" "$((mem_available_kb * 1024))"
	add_number "memory_used_percent" "$(awk -v total="$mem_total_kb" -v available="$mem_available_kb" 'BEGIN { printf "%.1f", 100*(total-available)/total }')"
fi

add_number "uptime_seconds" "$(awk '{printf "%.0f", $1; exit}' /proc/uptime 2>/dev/null || true)"
set -- $(awk '{print $1, $2, $3; exit}' /proc/loadavg 2>/dev/null)
add_number "load_1m" "${1:-}"
add_number "load_5m" "${2:-}"
add_number "load_15m" "${3:-}"

# Prefer the active cellular data interface and fall back to common OpenWrt
# names. Interface names come from ubus and are accepted only after a strict
# shell-safe character check.
iface=''
for logical in LTE2 LTE1 wwan wan; do
	status=$(ubus call "network.interface.$logical" status 2>/dev/null || true)
	up=$(jsonfilter -s "$status" -e '@.up' 2>/dev/null || true)
	candidate=$(jsonfilter -s "$status" -e '@.l3_device' 2>/dev/null || true)
	case "$candidate" in
		''|*[!A-Za-z0-9_.-]*) candidate='' ;;
	esac
	if [ "$up" = "true" ] && [ -n "$candidate" ] && [ -r "/sys/class/net/$candidate/statistics/rx_bytes" ]; then
		iface=$candidate
		break
	fi
done

rx_bytes=''
tx_bytes=''
if [ -n "$iface" ]; then
	rx_bytes=$(cat "/sys/class/net/$iface/statistics/rx_bytes" 2>/dev/null || true)
	tx_bytes=$(cat "/sys/class/net/$iface/statistics/tx_bytes" 2>/dev/null || true)
fi
add_number "rx_bytes" "$rx_bytes"
add_number "tx_bytes" "$tx_bytes"

throughput_bps=''
if valid_number "${rx_bytes:-}" && valid_number "${tx_bytes:-}" && [ "${old_time:-}" -ge 0 ] 2>/dev/null && [ "$sample_time" -gt "${old_time:-0}" ] 2>/dev/null && [ "${old_rx:-}" -ge 0 ] 2>/dev/null && [ "${old_tx:-}" -ge 0 ] 2>/dev/null; then
	rx_delta=$((rx_bytes - old_rx))
	tx_delta=$((tx_bytes - old_tx))
	[ "$rx_delta" -lt 0 ] && rx_delta=0
	[ "$tx_delta" -lt 0 ] && tx_delta=0
	throughput_bps=$(awk -v bytes="$((rx_delta + tx_delta))" -v seconds="$((sample_time - old_time))" 'BEGIN { if (seconds>0) printf "%.1f", bytes/seconds }')
fi
add_number "throughput_bps" "$throughput_bps"

# Legacy 2S images expose modem data through cellular.status. Newer
# cellulard-v2 images additionally expose RSRP/SINR through get_signal; use
# those fields when present and never turn an unsupported value into zero.
cellular=$(ubus call cellular status 2>/dev/null || true)
message=$(jsonfilter -s "$cellular" -e '@.message' 2>/dev/null || true)
add_number "rssi_dbm" "$(jsonfilter -s "$message" -e '@[0].rssi' 2>/dev/null || true)"
add_string "network_type" "$(jsonfilter -s "$message" -e '@[0].net_type' 2>/dev/null || true)"
add_string "registration" "$(jsonfilter -s "$message" -e '@[0].registration' 2>/dev/null || true)"
add_string "operator_name" "$(jsonfilter -s "$message" -e '@[0].plmn_description' 2>/dev/null || true)"
add_string "band" "$(jsonfilter -s "$message" -e '@[0].band' 2>/dev/null || true)"
add_string "sim_status" "$(jsonfilter -s "$message" -e '@[0].sim_status' 2>/dev/null || true)"
add_string "data_connectivity" "$(jsonfilter -s "$message" -e '@[0].data_connectivity' 2>/dev/null || true)"

modem=$(ubus list 2>/dev/null | sed -n 's/^cellulard\.modem\.\([A-Za-z0-9_-]*\)$/\1/p' | head -n 1)
case "$modem" in
	''|*[!A-Za-z0-9_-]*) modem='' ;;
esac
if [ -n "$modem" ]; then
	signal=$(ubus call "cellulard.modem.$modem" get_signal '{}' 2>/dev/null || true)
	rsrp=$(jsonfilter -s "$signal" -e '@.rsrp_dbm' 2>/dev/null || true)
	sinr=$(jsonfilter -s "$signal" -e '@.sinr_db' 2>/dev/null || true)
	case "$rsrp" in -[3-9][0-9]|-1[0-3][0-9]|-140) add_number "rsrp_dbm" "$rsrp" ;; esac
	case "$sinr" in -[0-9]|-1[0-9]|[0-9]|[1-3][0-9]|40) add_number "sinr_db" "$sinr" ;; esac
fi

for temp_file in /sys/class/thermal/thermal_zone*/temp; do
	[ -r "$temp_file" ] || continue
	temp=$(cat "$temp_file" 2>/dev/null || true)
	if valid_number "$temp"; then
		if [ "$temp" -ge 1000 ] 2>/dev/null; then
			add_number "temperature_c" "$(awk -v value="$temp" 'BEGIN { printf "%.1f", value/1000 }')"
		else
			add_number "temperature_c" "$temp"
		fi
		break
	fi
done

if [ -n "${cpu_total:-}" ] && [ -n "${cpu_idle:-}" ] && [ -n "${sample_time:-}" ]; then
	printf '%s %s %s %s %s\n' "$cpu_total" "$cpu_idle" "$sample_time" "${rx_bytes:-0}" "${tx_bytes:-0}" > "$STATE_TMP" && mv -f "$STATE_TMP" "$STATE"
fi

json="$json}"
printf '%s\n' "$json"
