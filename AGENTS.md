# XNET RMS project instructions

## Branch and repository rules

- Develop and review changes on `dev` unless the user explicitly selects another branch.
- Preserve unrelated working-tree changes. Do not reset, clean, or delete untracked files without explicit authorization.
- Keep credentials, private keys, enrollment tokens, database URLs, certificate authorities, and router IPK files out of Git.
- The hosted test VPS is a deployment target, not a source-of-truth checkout. Source changes must be pushed to Git before deployment.

## Making a change live

Follow [docs/LIVE_DEPLOYMENT.md](docs/LIVE_DEPLOYMENT.md). In particular:

1. Build and test the affected component.
2. For any dashboard change, run the frontend build and synchronize `frontend/dist` into `backend/cmd/server/dist`.
3. Push the commit to `dev`.
4. Pull the exact commit on the VPS and build the Go server from the `backend` module.
5. Record and verify the binary SHA-256 checksum before the privileged install.
6. Run migrations only when the release adds them, then restart `xnet-rms-core` and `xnet-rms-tunnel`.
7. Check health endpoints, logs, and the actual browser UI. A successful local build is not a live deployment.

The final `sudo install` and service restart are normally performed interactively by the VPS operator because the deployment SSH account requires a sudo password.

## Component boundaries

- The Go server embeds the dashboard from `backend/cmd/server/dist`; changing React source alone does not update the hosted UI.
- Mosquitto is a separate service. Restart it only for MQTT configuration, ACL, or certificate changes.
- OpenWrt `.ipk` artifacts are built and tested locally or in the router workflow; do not upload them to the RMS VPS unless a release procedure explicitly requires it.
- LuCI remote sessions authorize the RMS tunnel, then show the router's normal LuCI login. Never generate or inject a router `sysauth` cookie. Terminal SSH is a separate operator-authorized path.
