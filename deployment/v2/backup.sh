#!/bin/sh
set -eu
umask 077
: "${DATABASE_URL:?RMS database connection}"
: "${RESTIC_REPOSITORY:?Encrypted backup destination outside this VPS}"
: "${RESTIC_PASSWORD_FILE:?File containing restic repository password}"
case "$RESTIC_REPOSITORY" in sftp:*|s3:*|b2:*|azure:*|gs:*|rest:*) ;; *) echo "An off-host repository URL is required" >&2; exit 1;; esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$work/rms.dump"
# Restic encrypts data and metadata before transfer. Initialize the repository separately.
restic backup --tag xnet-rms --host xnet-rms "$work/rms.dump" /etc/xnet-rms /var/lib/xnet-rms
restic snapshots --latest 1 --tag xnet-rms
