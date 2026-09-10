# Agent 2.3.0-1

Build from the repository root using the existing OpenWrt staging libraries and
GCC 7.5.0 MIPS musl toolchain. The script reads that tree and writes only to a
temporary build directory and the requested artifact directory:

```sh
OPENWRT_ROOT=/home/sourabh/openwrt-19.07 sh agent/scripts/build-mips.sh
```

Outputs are in `artifacts/agent-2.3.0/`: IPK, stripped binary, unstripped binary,
ELF metadata and SHA256 checksums. The IPK is assembled with OpenWrt's
`ipkg-build` after cross-compilation; this is not a complete firmware build.
For feed builds, use `agent/Makefile` and the target firmware's dependency resolver.

## Changes

- Local P-256 identity, verified HTTPS enrollment, certificate renewal and
  challenge recovery; certificate-authenticated MQTT.
- Versioned profiles, bounded child-process collectors, signed script bundles,
  atomic activation and retention of the prior version.
- A 2 MiB RAM telemetry queue with oldest-first discards, exact application ACKs
  and paced replay. A reboot clears this RAM backlog; it does not survive reboot.
- Separate tunnel worker, one remote session, bounded WebSocket messages,
  short-lived rpcd LuCI sessions and a terminal PTY.
- Fixed architecture parsing and removed shared demo identity/firmware defaults.
- Disabled-by-default service; installation-specific trust is never packaged.
- Approved built-in overview, StrongSwan, and optional Modbus health
  collectors at `/usr/libexec/xnet-rms/device-overview.sh`,
  `/usr/libexec/xnet-rms/ipsec.lua`, and
  `/usr/libexec/xnet-rms/modbus-health.sh`. Capability-specific collectors
  return the bounded `unsupported` state when their subsystem is absent.

## Verification

Cross-compilation succeeded for big-endian MIPS32r2, musl soft-float. The stripped
binary is 82,688 bytes; the IPK is 41,994 bytes. Neither size includes dependencies.
ELF inspection found no development RPATH. IPK control metadata and contents were
extracted and inspected.

Host compilation and AddressSanitizer/UndefinedBehaviorSanitizer tests passed for
queue accounting, exact ACK removal, hung children and oversized output. Leak
checking was disabled because the execution environment prevents LeakSanitizer
from operating. IPsec fixture tests verify that IKE establishment alone does not
report a tunnel UP; its CHILD_SA must be INSTALLED.

No router installation, live certificate lifecycle, LuCI single sign-on, PTY,
MQTT outage/replay, or flash/RAM/CPU qualification has been performed on the
XE33 2S. The broader backend/deployment implementation is still in progress.

Before installing, check that the router's package feeds provide the ABI
dependencies listed in the IPK, especially `libopenssl1.1`, `libcurl4`,
`libubox20191228`, and `libuci20130104`. Do not force dependency checks or replace
system libraries to make an incompatible build install.

Provision the installation's `ca.crt` and `collector.pub` under `/etc/xnet-rms`,
configure verified HTTPS `server_url`, `mqtt_host`, port 8883 and enrollment token
in `/etc/config/niseva`, and verify router time before enabling the service.
Private device keys are generated locally and retained by sysupgrade keep rules.
