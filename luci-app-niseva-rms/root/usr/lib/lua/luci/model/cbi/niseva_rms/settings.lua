local m = Map("niseva", translate("Remote Management System"), translate("Configure XNET RMS connection and inspect registration status."))
m:section(SimpleSection).template = "niseva_rms/status"

local s = m:section(NamedSection, "general", "niseva", translate("RMS settings"))
s.anonymous = true
s.addremove = false

local mode = s:option(ListValue, "mode", translate("Connection type"))
mode:value("enabled", translate("Enabled"))
mode:value("standby", translate("Standby"))
mode:value("disabled", translate("Disabled"))
mode.default = "enabled"

local server = s:option(ListValue, "server", translate("Server"))
server:value("hosted", translate("Hosted XNET RMS"))
server:value("custom", translate("Custom installation"))
server.default = "hosted"

local hosted = s:option(Value, "hosted_hostname", translate("Hosted hostname"))
hosted.readonly = true
hosted.rmempty = false

local hostname = s:option(Value, "hostname", translate("Custom hostname"))
hostname.datatype = "host"
hostname:depends("server", "custom")
hostname.rmempty = false

local port = s:option(Value, "port", translate("HTTPS port"))
port.datatype = "port"
port:depends("server", "custom")
port.rmempty = false

local token = s:option(Value, "enrollment_token", translate("Organization token"))
token.password = true
token.rmempty = true
token.description = translate("Optional. It is cleared after successful enrollment.")

for _, spec in ipairs({
    {"retry_initial", "Initial retry interval (seconds)", "120"},
    {"retry_initial_period", "Initial retry period (seconds)", "3600"},
    {"retry_regular", "Regular retry interval (seconds)", "300"},
    {"retry_standby", "Standby retry interval (seconds)", "21600"},
    {"standby_after", "Automatic standby after (seconds)", "1209600"}
}) do
    local name, label, default = unpack(spec)
    local v = s:option(Value, name, translate(label))
    v.datatype = "uinteger"
    v.default = default
    v.description = translate("Advanced UCI setting; validated by the agent.")
end

return m
