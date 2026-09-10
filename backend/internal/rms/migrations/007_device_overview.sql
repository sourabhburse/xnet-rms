-- The baseline device overview collector is trusted code shipped with the
-- agent. Assign it to every existing device and to future claims so the
-- overview has real values without requiring an administrator to create a
-- profile manually.
INSERT INTO profiles(id, version, name, definition)
VALUES (
    '8f8d7a2c0d1e4b6aa1c2d3e4f5061728',
    1,
    'Device overview telemetry',
    $profile$
    {
      "id": "8f8d7a2c0d1e4b6aa1c2d3e4f5061728",
      "version": 1,
      "name": "Device overview telemetry",
      "source_id": "device_overview",
      "type": "builtin",
      "collector_id": "device_overview",
      "interval_seconds": 60,
      "timeout_seconds": 10,
      "max_output_bytes": 32768,
      "fields": [
        {"id":"rsrp_dbm","path":"/rsrp_dbm","label":"RSRP","unit":"dBm","kind":"gauge","chart":true,"fleet":true},
        {"id":"sinr_db","path":"/sinr_db","label":"SINR","unit":"dB","kind":"gauge","chart":true,"fleet":true},
        {"id":"cpu_usage_percent","path":"/cpu_usage_percent","label":"CPU","unit":"%","kind":"gauge","chart":true,"fleet":true},
        {"id":"memory_used_percent","path":"/memory_used_percent","label":"Memory","unit":"%","kind":"gauge","chart":true,"fleet":true},
        {"id":"throughput_bps","path":"/throughput_bps","label":"Throughput","unit":"B/s","kind":"gauge","chart":true,"fleet":true},
        {"id":"temperature_c","path":"/temperature_c","label":"Temperature","unit":"°C","kind":"gauge","chart":true,"fleet":true},
        {"id":"rssi_dbm","path":"/rssi_dbm","label":"RSSI","unit":"dBm","kind":"gauge","chart":true,"fleet":true},
        {"id":"rx_bytes","path":"/rx_bytes","label":"Received","unit":"B","kind":"counter"},
        {"id":"tx_bytes","path":"/tx_bytes","label":"Sent","unit":"B","kind":"counter"},
        {"id":"uptime_seconds","path":"/uptime_seconds","label":"Uptime","unit":"s","kind":"gauge"},
        {"id":"load_1m","path":"/load_1m","label":"Load (1m)","unit":"load","kind":"gauge"},
        {"id":"load_5m","path":"/load_5m","label":"Load (5m)","unit":"load","kind":"gauge"},
        {"id":"load_15m","path":"/load_15m","label":"Load (15m)","unit":"load","kind":"gauge"},
        {"id":"memory_total_bytes","path":"/memory_total_bytes","label":"Memory total","unit":"B","kind":"gauge"},
        {"id":"memory_available_bytes","path":"/memory_available_bytes","label":"Memory available","unit":"B","kind":"gauge"},
        {"id":"memory_used_bytes","path":"/memory_used_bytes","label":"Memory used","unit":"B","kind":"gauge","chart":true,"fleet":true},
        {"id":"network_type","path":"/network_type","label":"Network type","kind":"text"},
        {"id":"registration","path":"/registration","label":"Registration","kind":"state","fleet":true},
        {"id":"operator_name","path":"/operator_name","label":"Operator","kind":"text","fleet":true},
        {"id":"band","path":"/band","label":"Radio band","kind":"text","fleet":true},
        {"id":"sim_status","path":"/sim_status","label":"SIM status","kind":"state","fleet":true},
        {"id":"data_connectivity","path":"/data_connectivity","label":"Data connectivity","kind":"state","fleet":true}
      ]
    }
    $profile$
)
ON CONFLICT (id, version) DO NOTHING;

INSERT INTO assignments(device_id, profile_id, version, active)
SELECT d.id, '8f8d7a2c0d1e4b6aa1c2d3e4f5061728', 1, true
FROM devices d
WHERE NOT d.revoked
ON CONFLICT (device_id, profile_id, version) DO UPDATE SET active = true;
