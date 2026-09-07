module("luci.controller.niseva_rms", package.seeall)

local http = require "luci.http"
local jsonc = require "luci.jsonc"

function index()
    entry({"admin", "services", "niseva-rms"}, alias("admin", "services", "niseva-rms", "settings"), _("RMS"), 60).dependent = true
    entry({"admin", "services", "niseva-rms", "settings"}, cbi("niseva_rms/settings"), _("Settings"), 10)
    entry({"admin", "services", "niseva-rms", "status"}, call("status"), nil).leaf = true
    entry({"admin", "services", "niseva-rms", "connect"}, call("connect"), nil).leaf = true
end

local function private_status()
    local pipe = io.popen("/usr/sbin/niseva-agent --status 2>/dev/null", "r")
    if not pipe then return { connection_state = "unknown", last_error = "status_unavailable" } end
    local data = pipe:read("*a") or ""
    pipe:close()
    local parsed = jsonc.parse(data)
    if type(parsed) ~= "table" then return { connection_state = "unknown", last_error = "invalid_status" } end
    parsed.token_configured = nil
    return parsed
end

function status()
    http.prepare_content("application/json")
    http.write_json(private_status())
end

function connect()
    local ok = os.execute("/usr/sbin/niseva-agent --connect >/dev/null 2>&1")
    http.prepare_content("application/json")
    http.write_json({ accepted = ok == 0 })
end
