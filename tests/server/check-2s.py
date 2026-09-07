#!/usr/bin/env python3
"""Read real lab router status without displaying credentials or telemetry bodies."""
import json
from pathlib import Path
import urllib.request

base = 'https://xnet-rms-test.duckdns.org:8445/api/v1/'
login = dict(line.split(': ', 1) for line in (Path.home()/'.config/xnet-rms/initial-login.txt').read_text().splitlines())
token = None
def api(path, payload=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer '+token
    request = urllib.request.Request(base+path, headers=headers, data=None if payload is None else json.dumps(payload).encode())
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)
token = api('auth/login', {'email':login['Email'], 'password':login['Password']})['token']
device = 'cdd1495337a9dc4d5078873432591ff0'
items = api('devices')['items']
for item in items:
    if item['id'] == device:
        print(json.dumps({k:v for k,v in item.items() if k in ('id','status','last_seen','model','firmware_version')}))
for snapshot in api('devices/'+device+'/snapshots'):
    print(json.dumps({k:v for k,v in snapshot.items() if k in ('source_id','status','observed_at','received_at','sequence','error','fields')}))
