#!/usr/bin/python3
"""Certbot DNS hook. Keep the DuckDNS token out of argv and diagnostic output."""
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.parse
import urllib.request

DOMAIN = "xnet-rms-test.duckdns.org"
TOKEN_FILE = Path.home() / ".config/xnet-rms/duckdns.token"

def main():
    requested = os.environ.get("CERTBOT_DOMAIN", "").removeprefix("*.")
    if requested != DOMAIN:
        raise RuntimeError("Unexpected certificate domain")
    token = TOKEN_FILE.read_text().strip()
    if not token or TOKEN_FILE.stat().st_mode & 0o077:
        raise RuntimeError("Token missing or permissions too broad")
    cleanup = len(sys.argv) > 1 and sys.argv[1] == "cleanup"
    value = os.environ["CERTBOT_VALIDATION"]
    params = {"domains": "xnet-rms-test", "token": token, "txt": value}
    if cleanup:
        params["clear"] = "true"
    url = "https://www.duckdns.org/update?" + urllib.parse.urlencode(params)
    # Do not propagate urllib exception text: it can contain the authenticated URL.
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            result = response.read(1024).decode().strip()
    except Exception:
        raise RuntimeError("DuckDNS HTTPS update failed") from None
    if result != "OK":
        raise RuntimeError("DuckDNS rejected TXT update")
    if cleanup:
        return
    for attempt in range(36):
        ready = True
        for resolver in ("1.1.1.1", "8.8.8.8"):
            answer = subprocess.run(
                ["dig", "@" + resolver, "+short", "+time=3", "+tries=1",
                 "TXT", "_acme-challenge." + DOMAIN],
                capture_output=True, text=True, timeout=5)
            ready = ready and ('"' + value + '"' in answer.stdout)
        if ready:
            print("Public resolvers agree; allowing 120 seconds for secondary validation caches", flush=True)
            time.sleep(120)
            print("DuckDNS validation record propagated")
            return
        time.sleep(5)
    raise RuntimeError("DNS propagation timed out")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Only deliberately authored errors are safe to report.
        print(str(exc) if isinstance(exc, RuntimeError) else "DNS hook failed", file=sys.stderr)
        sys.exit(1)
