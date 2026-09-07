#!/usr/bin/lua
-- Bounded by the RMS collector supervisor; requires strongSwan swanctl.
local function capture(option)
  local pipe=io.popen("LC_ALL=C swanctl "..option.." 2>/dev/null; printf '\\n__RMS_EXIT_%s\\n' \"$?\"", "r")
  if not pipe then return nil end
  local data=pipe:read(65537) or "";pipe:close()
  if #data>65536 then return nil end
  local status=data:match("\n__RMS_EXIT_(%d+)\n$")
  if status~="0" then return nil end
  return (data:gsub("\n__RMS_EXIT_%d+\n$",""))
end
local function parse(conns,sas)
  local tunnels,connection={},nil
  local function get(conn,child)
    local id=#conn..":"..conn..child
    if not tunnels[id] then tunnels[id]={id=id,name=conn.." / "..child,connection=conn,child=child,state="DOWN",ike_state="ABSENT",child_state="ABSENT",unsupported_fields={"last_failure_reason"}} end
    return tunnels[id]
  end
  local loaded=0
  for line in conns:gmatch("[^\n]+") do
    local name=line:match("^(%S+):%s+IKEv[12]")
    if name then connection=name;loaded=loaded+1 end
    local child=line:match("^  (%S+):%s+TUNNEL") or line:match("^  (%S+):%s+TRANSPORT")
    if connection and child then get(connection,child) end
  end
  if #conns>0 and loaded==0 then return nil,"Unsupported swanctl connection output" end
  connection=nil
  local ike,current
  for line in sas:gmatch("[^\n]+") do
    local name,state=line:match("^(%S+):%s+#%d+,%s+(%u+)")
    if name then connection=name;ike=state;current=nil end
    local child,childstate=line:match("^  (%S+):%s+#%d+,%s+reqid%s+%d+,%s+(%u+)")
    if connection and child then
      current=get(connection,child)
      if current.state~="UP" or childstate=="INSTALLED" then current.ike_state=ike;current.child_state=childstate;current.state=(ike=="ESTABLISHED" and childstate=="INSTALLED") and "UP" or "DOWN" end
    end
    if current then
      local bytes,packets=line:match("^%s+in%s+%x+,%s+(%d+)%s+bytes,%s+(%d+)%s+packets")
      if bytes then current.bytes_in=tonumber(bytes);current.packets_in=tonumber(packets) end
      bytes,packets=line:match("^%s+out%s+%x+,%s+(%d+)%s+bytes,%s+(%d+)%s+packets")
      if bytes then current.bytes_out=tonumber(bytes);current.packets_out=tonumber(packets) end
    end
  end
  local out={};for _,v in pairs(tunnels) do out[#out+1]=v end
  table.sort(out,function(a,b)return a.id<b.id end)
  return {implementation="strongswan-swanctl",tunnels=out}
end
-- The parser is loadable for fixture tests without invoking local commands.
if arg and arg[1]=="--parser" then return parse end
local json_ok,json=pcall(require,"luci.jsonc")
if not json_ok then json_ok,json=pcall(require,"cjson") end
if not json_ok then io.write([[{"error":"JSON library unavailable"}]],"\n");os.exit(2) end
local encode=json.stringify or json.encode
local function fail(reason,code) io.write(encode({error=reason}),"\n");os.exit(code) end
local conns,sas=capture("--list-conns"),capture("--list-sas")
if not conns or not sas then fail("swanctl unavailable or query failed",2) end
local result,err=parse(conns,sas);if not result then fail(err,2) end
io.write(encode(result),"\n")
