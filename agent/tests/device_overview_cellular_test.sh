#!/bin/sh

set -eu

tool=${0##*/}
case "$tool" in
	ubus)
		request=$*
		[ -z "${CALL_LOG:-}" ] || printf '%s %s\n' "$tool" "$request" >> "$CALL_LOG"
		case "$request" in
			call\ network.interface.wwan\ status)
				if [ "${NETWORK_FIXTURE_UP:-0}" = "1" ]; then
					printf '%s\n' '{"up":true,"l3_device":"lo","uptime":42,"ipv4-address":[{"address":"192.0.2.2"}],"route":[{"nexthop":"192.0.2.1"}],"dns-server":["192.0.2.1"]}'
				else
					printf '%s\n' '{"up":false}'
				fi
				exit 0
				;;
			call\ network.interface.*\ status) printf '%s\n' '{"up":false}'; exit 0 ;;
			call\ network.wireless\ status|call\ dhcp\ ipv4leases) exit 1 ;;
			call\ mwan3\ status)
				printf '%s\n' '{"interfaces":{"LTE2":{"up":true,"status":"online","uptime":84,"lost":2,"score":9}}}'
				exit 0
				;;
		esac
		case "${CELLULAR_FIXTURE_MODE:-}:$request" in
			v2:call\ cellulard\ list\ \{\}) printf '%s\n' '{"modems":[{"id":"123456789012345"}]}' ;;
			v2:call\ cellulard.modem.123456789012345\ get_info\ \{\}) printf '%s\n' '{"sim_state":"READY"}' ;;
			v2:call\ cellulard.modem.123456789012345\ get_signal\ \{\}) printf '%s\n' '{"service":"LTE","rssi_dbm":-75,"rsrp_dbm":-101,"sinr_db":12}' ;;
			v2:call\ cellulard.modem.123456789012345\ get_network_status\ \{\}) printf '%s\n' '{"registration_state":"registered home","access_technology":"LTE","operator_name":"Example Mobile","mcc":"404","mnc":"45","band":"LTE BAND 3","roaming":false}' ;;
			v2:call\ cellulard.modem.123456789012345.bearer\ get_stats\ \{\}) printf '%s\n' '{"ipv4":"10.23.4.5","state":"up","connected":true}' ;;
			legacy:call\ cellulard\ list\ \{\}) exit 1 ;;
			legacy:call\ cellular\ status) printf '%s\n' '{"message":"[{\"rssi\":-81,\"net_type\":\"LTE\",\"registration\":\"registered roaming\",\"plmn_description\":\"Legacy Mobile\",\"band\":\"BAND 8\",\"sim_status\":\"READY\",\"data_connectivity\":\"connected\",\"plmn\":\"40499\",\"roaming\":\"true\",\"ip\":\"10.9.8.7\",\"connection_uptime\":321}]"}' ;;
			*) exit 1 ;;
		esac
		exit 0
		;;
	jsonfilter)
		exec /usr/bin/python3 -c '
import json, re, sys

args = sys.argv[1:]
source = args[args.index("-s") + 1]
expression = args[args.index("-e") + 1]
value = json.loads(source)
for key, index, dotted in re.findall(r"\[\"([^\"]+)\"\]|\[([0-9]+)\]|\.([A-Za-z0-9_-]+)", expression[1:]):
    value = value[int(index)] if index else value[key or dotted]
if isinstance(value, bool):
    print("true" if value else "false")
elif isinstance(value, (dict, list)):
    print(json.dumps(value, separators=(",", ":")))
else:
    print(value)
' "$@"
		;;
	pidof)
		exit 1
		;;
	ping)
		[ -z "${CALL_LOG:-}" ] || printf '%s %s\n' "$tool" "$*" >> "$CALL_LOG"
		printf '%s\n' '1 packets transmitted, 1 packets received, 0% packet loss'
		printf '%s\n' 'round-trip min/avg/max = 1.000/1.000/1.000 ms'
		;;
	uci)
		[ -z "${CALL_LOG:-}" ] || printf '%s %s\n' "$tool" "$*" >> "$CALL_LOG"
		[ "$*" = '-q get mwan3.LTE2.enabled' ] || exit 1
		printf '%s\n' "${MWAN_FIXTURE_ENABLED:-0}"
		;;
esac

root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT INT TERM
fixture_bin="$root/bin"
mkdir -p "$fixture_bin"
self=$(cd "$(dirname "$0")" && pwd)/${0##*/}
ln -s "$self" "$fixture_bin/ubus"
ln -s "$self" "$fixture_bin/jsonfilter"
ln -s "$self" "$fixture_bin/pidof"
ln -s "$self" "$fixture_bin/ping"
ln -s "$self" "$fixture_bin/uci"
cp "$(dirname "$self")/../files/device-overview.sh" "$root/device-overview.sh"
sed -i "s#^PATH=.*#PATH=$fixture_bin:/usr/sbin:/usr/bin:/sbin:/bin#; s#^STATE=.*#STATE=$root/state#" "$root/device-overview.sh"

assert_fixture() {
	mode=$1
	expected=$2
	output=$(CELLULAR_FIXTURE_MODE=$mode /bin/sh "$root/device-overview.sh")
	printf '%s\n' "$output" | /usr/bin/jq -e "$expected" >/dev/null
}

assert_fixture v2 '.rssi_dbm == -75 and .rsrp_dbm == -101 and .sinr_db == 12 and .network_type == "LTE" and .registration == "registered home" and .operator_name == "Example Mobile" and .band == "LTE BAND 3" and .sim_status == "READY" and .data_connectivity == "connected" and .plmn == "40445" and .roaming == "false" and .cellular_ip == "10.23.4.5" and .cellular_service_state == "running"'
assert_fixture legacy '.rssi_dbm == -81 and .network_type == "LTE" and .registration == "registered roaming" and .operator_name == "Legacy Mobile" and .band == "BAND 8" and .sim_status == "READY" and .data_connectivity == "connected" and .plmn == "40499" and .roaming == "true" and .cellular_ip == "10.9.8.7" and .cellular_uptime_seconds == 321 and .cellular_service_state == "running" and (has("rsrp_dbm") | not) and (has("sinr_db") | not)'

call_log="$root/calls"
: > "$call_log"
output=$(CALL_LOG="$call_log" CELLULAR_FIXTURE_MODE=v2 NETWORK_FIXTURE_UP=1 MWAN_FIXTURE_ENABLED=0 /bin/sh "$root/device-overview.sh")
printf '%s\n' "$output" | /usr/bin/jq -e '.packet_loss_percent == 0 and .latency_ms == 1.000 and (has("mwan_lte2_state") | not)' >/dev/null
grep -qx 'ping -c 1 -W 1 192.0.2.1' "$call_log"
if grep -qx 'ubus call mwan3 status' "$call_log"; then
	printf '%s\n' 'mwan3 status was called while LTE2 monitoring was disabled' >&2
	exit 1
fi

: > "$call_log"
output=$(CALL_LOG="$call_log" CELLULAR_FIXTURE_MODE=v2 NETWORK_FIXTURE_UP=1 MWAN_FIXTURE_ENABLED=1 /bin/sh "$root/device-overview.sh")
printf '%s\n' "$output" | /usr/bin/jq -e '.mwan_lte2_state == "up" and .mwan_lte2_uptime_seconds == 84 and .mwan_lte2_lost == 2 and .mwan_lte2_score == 9' >/dev/null
grep -qx 'ubus call mwan3 status' "$call_log"

printf '%s\n' 'device overview cellular fixtures: PASS'
