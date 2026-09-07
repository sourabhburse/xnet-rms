#!/bin/sh
set -eu
umask 077
: "${RESTIC_REPOSITORY:?}"
: "${RESTIC_PASSWORD_FILE:?}"
: "${RMS_RESTORE_DIR:?Empty staging directory on the replacement host}"
[ ! -e "$RMS_RESTORE_DIR" ] || { echo "Restore target must not already exist" >&2; exit 1; }
restic restore latest --tag xnet-rms --target "$RMS_RESTORE_DIR"
echo "Restore staged. Verify snapshot age and restore rms.dump into a newly created RMS database; restore installation trust and revocation state before enabling access."
