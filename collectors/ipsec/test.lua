arg={"--parser"}
local parse=dofile("agent/files/ipsec.lua")
local conns=[[site: IKEv2, no reauthentication
  local: %any
  lan: TUNNEL, rekeying every 3600s
]]
local sas=[[site: #1, ESTABLISHED, IKEv2
  lan: #2, reqid 1, INSTALLED, TUNNEL
    in  abcdef12,  123 bytes,  4 packets
    out 12345678, 456 bytes,  7 packets
]]
local result=assert(parse(conns,sas));assert(#result.tunnels==1)
assert(result.tunnels[1].state=="UP" and result.tunnels[1].bytes_in==123)
assert(parse(conns,"").tunnels[1].state=="DOWN")
assert(parse(conns,sas:gsub("INSTALLED","INSTALLING")).tunnels[1].state=="DOWN")
assert(parse(conns,sas:gsub("ESTABLISHED","CONNECTING")).tunnels[1].state=="DOWN")
assert(not parse("unknown format",sas))
print("IPsec fixture tests passed")
