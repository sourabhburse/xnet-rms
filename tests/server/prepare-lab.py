#!/usr/bin/python3
"""Create an isolated lab customer/profile and save its enrollment token privately.

Run as ubuntu on the VPS after installation. No credentials are printed.
This prepares test enrollment; it does not enroll a fabricated router.
"""
import argparse
import json
import os
from pathlib import Path
import urllib.request

BASE = "https://xnet-rms-test.duckdns.org:8445/api/v1/"
DIRECTORY = Path.home() / ".config/xnet-rms"
STATE = DIRECTORY / "lab-enrollment.json"

def save(state):
    temporary = STATE.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(STATE)

def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--assign-device", help="Assign lab profile to this enrolled device ID")
    args = parser.parse_args()
    login = dict(line.split(": ", 1) for line in (DIRECTORY / "initial-login.txt").read_text().splitlines())
    token = None
    def api(path, payload=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(BASE + path, headers=headers,
            data=None if payload is None else json.dumps(payload).encode())
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    token = api("auth/login", {"email": login["Email"], "password": login["Password"]})["token"]
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    if "organization_id" not in state:
        state["organization_id"] = api("organizations", {"name": "XNET RMS 2S test lab"})["id"]
        save(state)
    if "profile_id" not in state:
        profile = api("profiles", {
            "version": 1, "name": "Router system health", "source_id": "system",
            "type": "ubus", "object": "system", "method": "info", "args": {},
            "interval_seconds": 60, "timeout_seconds": 5, "max_output_bytes": 32768,
            "fields": [
                {"id": "uptime", "path": "/uptime", "kind": "counter", "label": "Uptime", "unit": "s"},
                {"id": "memory_free", "path": "/memory/free", "kind": "gauge", "label": "Free RAM", "unit": "B"},
                {"id": "memory_total", "path": "/memory/total", "kind": "gauge", "label": "Total RAM", "unit": "B"}
            ]})
        state["profile_id"] = profile["id"]
        save(state)
    if "enrollment_token" not in state:
        result = api("enrollment-tokens", {"name": "2S initial test enrollment", "organization_id": state["organization_id"], "max_uses": 1})
        state["enrollment_token"] = result["token"]
        state["token_id"] = result["id"]
        save(state)
    if args.assign_device:
        devices = api("devices")
        device = next((d for d in devices["items"] if d["id"] == args.assign_device), None)
        if device is None or device["organization_id"] != state["organization_id"]:
            raise RuntimeError("Device must already be enrolled into this test lab")
        api("devices/" + device["id"] + "/profiles", {"profile_id": state["profile_id"], "version": 1})
        print("Lab system profile assigned")
    print("Lab prepared. Enrollment material saved privately at " + str(STATE))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never dump HTTP bodies or credential-bearing variables on failure.
        raise SystemExit("Lab preparation failed; check RMS health, initial login file, and existing lab state.")
