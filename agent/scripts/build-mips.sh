#!/bin/sh
# Reads an existing OpenWrt staging tree; all build output stays outside it.
set -eu
: "${OPENWRT_ROOT:?Set the existing OpenWrt source or SDK root}"
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
out=${1:-"$root/artifacts/agent-2.1.1"}
mkdir -p "$out"
out=$(CDPATH= cd -- "$out" && pwd)
stage="$OPENWRT_ROOT/staging_dir/target-mips_24kc_musl"
tool="$OPENWRT_ROOT/staging_dir/toolchain-mips_24kc_gcc-7.5.0_musl/bin/mips-openwrt-linux-musl"
export STAGING_DIR="$stage"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
cmake -S "$root/agent/src" -B "$work/build" \
 -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR=mips \
 -DCMAKE_C_COMPILER="$tool-gcc" -DCMAKE_C_FLAGS=-mips32r2 \
 -DRMS_HOST_INCLUDE="$stage/usr/include" -DRMS_HOST_LIB="$stage/usr/lib" \
 -DCMAKE_EXE_LINKER_FLAGS="-Wl,-rpath-link,$stage/usr/lib"
cmake --build "$work/build" -j1
cp "$work/build/niseva-agent" "$out/niseva-agent.debug"
"$tool-strip" -o "$out/niseva-agent" "$out/niseva-agent.debug"
"$tool-readelf" -h -l -d "$out/niseva-agent" > "$out/ELF.txt"
if "$tool-readelf" -d "$out/niseva-agent" | grep -Eq 'RPATH|RUNPATH'; then
 echo "Refusing package with development library paths" >&2; exit 1
fi
pkg="$work/package"
mkdir -p "$pkg/CONTROL" "$pkg/usr/sbin" "$pkg/etc/config" "$pkg/etc/init.d" "$pkg/etc/xnet-rms" "$pkg/lib/upgrade/keep.d" "$pkg/usr/libexec/xnet-rms"
install -m 0755 "$out/niseva-agent" "$pkg/usr/sbin/niseva-agent"
install -m 0755 "$root/agent/files/niseva.init" "$pkg/etc/init.d/niseva-agent"
install -m 0600 "$root/agent/files/niseva.config" "$pkg/etc/config/niseva"
install -m 0755 "$root/agent/files/ipsec.lua" "$pkg/usr/libexec/xnet-rms/ipsec.lua"
printf '/etc/xnet-rms/\n/etc/config/niseva\n' > "$pkg/lib/upgrade/keep.d/niseva-agent"
printf '/etc/config/niseva\n' > "$pkg/CONTROL/conffiles"
cat > "$pkg/CONTROL/control" <<'CONTROL'
Package: niseva-agent
Version: 2.1.1-2
Architecture: mips_24kc
Maintainer: Niseva Engineering <support@niseva.com>
Section: net
Priority: optional
Depends: libc, libgcc1, libubox20191228, libuci20130104, libmosquitto-ssl, libcurl4, libopenssl1.1, ubus
Description: XNET RMS certificate identity, bounded collection and remote sessions
CONTROL
sh "$OPENWRT_ROOT/scripts/ipkg-build" -o 0 -g 0 "$pkg" "$out"
(cd "$out" && sha256sum niseva-agent niseva-agent_2.1.1-2_mips_24kc.ipk > SHA256SUMS)
echo "Built $out/niseva-agent_2.1.1-2_mips_24kc.ipk"
