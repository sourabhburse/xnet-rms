package rms

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const monitoringCatalogVersion = 1

type catalogMetric struct {
	ID                 string `json:"id"`
	Category           string `json:"category"`
	Description        string `json:"description"`
	SourceID           string `json:"source_id"`
	RequiredCapability string `json:"required_capability,omitempty"`
	Baseline           bool   `json:"baseline,omitempty"`
	Field              Field  `json:"field"`
}

type sourceDefinition struct {
	Name        string
	Type        string
	CollectorID string
	Object      string
	Method      string
	Entities    string
	EntityKey   string
	Timeout     int
	MaxOutput   int
	MinAgent    string
}

var monitoringSources = map[string]sourceDefinition{
	"device_overview": {Name: "Device overview", Type: "builtin", CollectorID: "device_overview", Timeout: 10, MaxOutput: 32768, MinAgent: "2.2.0"},
	"ipsec":           {Name: "IPsec tunnels", Type: "builtin", CollectorID: "ipsec", Entities: "/tunnels", EntityKey: "/id", Timeout: 10, MaxOutput: 32768, MinAgent: "2.3.0"},
	"modbus_health":   {Name: "Modbus gateway health", Type: "builtin", CollectorID: "modbus_health", Timeout: 10, MaxOutput: 4096, MinAgent: "2.3.0"},
}

func metric(id, category, description, source, fieldID, path, label, unit, kind string, baseline bool) catalogMetric {
	return catalogMetric{ID: id, Category: category, Description: description, SourceID: source, Baseline: baseline, Field: Field{ID: fieldID, Path: path, Label: label, Unit: unit, Kind: kind}}
}

func versionAtLeast(have, minimum string) bool {
	parse := func(value string) [3]int {
		var out [3]int
		for i, part := range strings.SplitN(value, ".", 4) {
			if i >= len(out) {
				break
			}
			out[i], _ = strconv.Atoi(part)
		}
		return out
	}
	a, b := parse(have), parse(minimum)
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return true
}

var monitoringMetricCatalog = []catalogMetric{
	metric("availability.online_percentage", "Availability", "Percentage of expected heartbeat minutes received", "availability", "heartbeat_coverage_percent", "/heartbeat_coverage_percent", "Online percentage", "%", "gauge", false),
	metric("availability.offline_periods", "Availability", "Recorded transitions to an offline state", "availability", "offline_periods", "/offline_periods", "Offline periods", "", "counter", false),
	metric("availability.heartbeat_coverage", "Availability", "Expected heartbeat-minute coverage", "availability", "heartbeat_coverage_percent", "/heartbeat_coverage_percent", "Heartbeat coverage", "%", "gauge", false),
	metric("availability.reboots", "Availability", "Detected router boot changes", "availability", "reboots", "/reboots", "Reboots", "", "counter", false),
	metric("availability.telemetry_freshness", "Availability", "Age of the telemetry sample when collected; missing samples are evaluated by the stale-data rule", "device_overview", "telemetry_freshness_seconds", "/telemetry_freshness_seconds", "Telemetry freshness", "s", "gauge", false),
	metric("system.cpu_usage", "System", "CPU busy percentage", "device_overview", "cpu_usage_percent", "/cpu_usage_percent", "CPU usage", "%", "gauge", true),
	metric("system.memory_used", "System", "Memory currently in use", "device_overview", "memory_used_percent", "/memory_used_percent", "Memory used", "%", "gauge", true),
	metric("system.memory_available", "System", "Available system memory", "device_overview", "memory_available_bytes", "/memory_available_bytes", "Memory available", "B", "gauge", true),
	metric("system.load_1m", "System", "One minute load average", "device_overview", "load_1m", "/load_1m", "Load (1m)", "load", "gauge", true),
	metric("system.load_5m", "System", "Five minute load average", "device_overview", "load_5m", "/load_5m", "Load (5m)", "load", "gauge", true),
	metric("system.load_15m", "System", "Fifteen minute load average", "device_overview", "load_15m", "/load_15m", "Load (15m)", "load", "gauge", true),
	metric("system.uptime", "Availability", "Router uptime", "device_overview", "uptime_seconds", "/uptime_seconds", "Uptime", "s", "gauge", true),
	metric("system.storage_used", "System", "Writable overlay utilization", "device_overview", "storage_used_percent", "/storage_used_percent", "Storage used", "%", "gauge", false),
	metric("system.storage_free", "System", "Writable overlay free space", "device_overview", "storage_free_bytes", "/storage_free_bytes", "Storage free", "B", "gauge", false),
	metric("system.temperature", "System", "Board or modem temperature when exposed", "device_overview", "temperature_c", "/temperature_c", "Temperature", "°C", "gauge", true),
	metric("cellular.rssi", "Cellular", "Received signal strength", "device_overview", "rssi_dbm", "/rssi_dbm", "RSSI", "dBm", "gauge", true),
	metric("cellular.rsrp", "Cellular", "LTE reference signal received power", "device_overview", "rsrp_dbm", "/rsrp_dbm", "RSRP", "dBm", "gauge", true),
	metric("cellular.sinr", "Cellular", "Signal to interference plus noise ratio", "device_overview", "sinr_db", "/sinr_db", "SINR", "dB", "gauge", true),
	metric("cellular.registration", "Cellular", "Mobile network registration state", "device_overview", "registration", "/registration", "Registration", "", "state", true),
	metric("cellular.connectivity", "Cellular", "Mobile data connectivity state", "device_overview", "data_connectivity", "/data_connectivity", "Data connectivity", "", "state", true),
	metric("cellular.sim", "Cellular", "SIM state", "device_overview", "sim_status", "/sim_status", "SIM status", "", "state", true),
	metric("cellular.network_type", "Cellular", "Current radio access technology", "device_overview", "network_type", "/network_type", "Network type", "", "text", true),
	metric("cellular.operator", "Cellular", "Current mobile operator", "device_overview", "operator_name", "/operator_name", "Operator", "", "text", true),
	metric("cellular.plmn", "Cellular", "Public land mobile network identifier", "device_overview", "plmn", "/plmn", "PLMN", "", "text", false),
	metric("cellular.roaming", "Cellular", "Roaming state when provided by the modem", "device_overview", "roaming", "/roaming", "Roaming", "", "state", false),
	metric("cellular.band", "Cellular", "Current radio band", "device_overview", "band", "/band", "Radio band", "", "text", true),
	metric("cellular.connection_uptime", "Cellular", "Current packet-data connection uptime", "device_overview", "cellular_uptime_seconds", "/cellular_uptime_seconds", "Cellular uptime", "s", "gauge", false),
	metric("cellular.ip", "Cellular", "Current cellular data IP address", "device_overview", "cellular_ip", "/cellular_ip", "Cellular IP", "", "text", false),
	metric("cellular.received", "Cellular", "Received bytes on the active cellular uplink", "device_overview", "rx_bytes", "/rx_bytes", "Cellular received", "B", "counter", false),
	metric("cellular.sent", "Cellular", "Transmitted bytes on the active cellular uplink", "device_overview", "tx_bytes", "/tx_bytes", "Cellular sent", "B", "counter", false),
	metric("wan.interface_state", "WAN", "State of the preferred active uplink", "device_overview", "interface_up", "/interface_up", "Uplink state", "", "state", false),
	metric("wan.interface_uptime", "WAN", "Preferred uplink interface uptime", "device_overview", "interface_uptime_seconds", "/interface_uptime_seconds", "Uplink uptime", "s", "gauge", false),
	metric("wan.ipv4", "WAN", "IPv4 address of the preferred uplink", "device_overview", "ipv4_address", "/ipv4_address", "WAN IPv4", "", "text", false),
	metric("wan.gateway", "WAN", "Default gateway of the preferred uplink", "device_overview", "gateway", "/gateway", "WAN gateway", "", "text", false),
	metric("wan.dns", "WAN", "Primary DNS server of the preferred uplink", "device_overview", "dns", "/dns", "WAN DNS", "", "text", false),
	metric("wan.received", "WAN", "Received bytes on the preferred uplink", "device_overview", "rx_bytes", "/rx_bytes", "Received", "B", "counter", true),
	metric("wan.sent", "WAN", "Transmitted bytes on the preferred uplink", "device_overview", "tx_bytes", "/tx_bytes", "Sent", "B", "counter", true),
	metric("wan.throughput", "WAN", "Combined uplink throughput", "device_overview", "throughput_bps", "/throughput_bps", "Throughput", "B/s", "gauge", true),
	metric("wan.packet_loss", "WAN", "Packet loss to the interface-provided DNS server or gateway", "device_overview", "packet_loss_percent", "/packet_loss_percent", "Uplink packet loss", "%", "gauge", false),
	metric("wan.latency", "WAN", "Average round-trip latency to the interface-provided DNS server or gateway", "device_overview", "latency_ms", "/latency_ms", "Uplink latency", "ms", "gauge", false),
	metric("wan.rx_errors", "WAN", "Receive errors on the preferred uplink", "device_overview", "rx_errors", "/rx_errors", "RX errors", "", "counter", false),
	metric("wan.tx_errors", "WAN", "Transmit errors on the preferred uplink", "device_overview", "tx_errors", "/tx_errors", "TX errors", "", "counter", false),
	metric("ethernet.lan_carrier", "Ethernet and Wi-Fi", "LAN carrier state", "device_overview", "lan_carrier", "/lan_carrier", "LAN carrier", "", "state", false),
	metric("ethernet.received", "Ethernet and Wi-Fi", "Received bytes on the LAN bridge", "device_overview", "lan_rx_bytes", "/lan_rx_bytes", "LAN received", "B", "counter", false),
	metric("ethernet.sent", "Ethernet and Wi-Fi", "Transmitted bytes on the LAN bridge", "device_overview", "lan_tx_bytes", "/lan_tx_bytes", "LAN sent", "B", "counter", false),
	metric("ethernet.rx_errors", "Ethernet and Wi-Fi", "Receive errors on the LAN bridge", "device_overview", "lan_rx_errors", "/lan_rx_errors", "LAN RX errors", "", "counter", false),
	metric("ethernet.tx_errors", "Ethernet and Wi-Fi", "Transmit errors on the LAN bridge", "device_overview", "lan_tx_errors", "/lan_tx_errors", "LAN TX errors", "", "counter", false),
	metric("wifi.radio_state", "Ethernet and Wi-Fi", "Primary Wi-Fi radio state", "device_overview", "wifi_state", "/wifi_state", "Wi-Fi radio", "", "state", false),
	metric("wifi.mode", "Ethernet and Wi-Fi", "Primary Wi-Fi interface operating mode", "device_overview", "wifi_mode", "/wifi_mode", "Wi-Fi mode", "", "text", false),
	metric("wifi.channel", "Ethernet and Wi-Fi", "Primary Wi-Fi interface channel when available", "device_overview", "wifi_channel", "/wifi_channel", "Wi-Fi channel", "", "gauge", false),
	metric("wifi.tx_power", "Ethernet and Wi-Fi", "Primary Wi-Fi transmit power", "device_overview", "wifi_tx_power_dbm", "/wifi_tx_power_dbm", "Wi-Fi TX power", "dBm", "gauge", false),
	metric("wifi.noise", "Ethernet and Wi-Fi", "Primary Wi-Fi noise floor", "device_overview", "wifi_noise_dbm", "/wifi_noise_dbm", "Wi-Fi noise", "dBm", "gauge", false),
	metric("wifi.client_count", "Ethernet and Wi-Fi", "Associated Wi-Fi station count", "device_overview", "wifi_clients", "/wifi_clients", "Wi-Fi clients", "", "gauge", false),
	metric("wifi.received", "Ethernet and Wi-Fi", "Received bytes on the primary Wi-Fi interface", "device_overview", "wifi_rx_bytes", "/wifi_rx_bytes", "Wi-Fi received", "B", "counter", false),
	metric("wifi.sent", "Ethernet and Wi-Fi", "Transmitted bytes on the primary Wi-Fi interface", "device_overview", "wifi_tx_bytes", "/wifi_tx_bytes", "Wi-Fi sent", "B", "counter", false),
	metric("wifi.rx_errors", "Ethernet and Wi-Fi", "Receive errors on the primary Wi-Fi interface", "device_overview", "wifi_rx_errors", "/wifi_rx_errors", "Wi-Fi RX errors", "", "counter", false),
	metric("wifi.tx_errors", "Ethernet and Wi-Fi", "Transmit errors on the primary Wi-Fi interface", "device_overview", "wifi_tx_errors", "/wifi_tx_errors", "Wi-Fi TX errors", "", "counter", false),
	metric("services.rms_agent", "Services", "RMS agent service state", "device_overview", "rms_agent_state", "/rms_agent_state", "RMS agent", "", "state", false),
	metric("services.cellular", "Services", "Cellular daemon service state", "device_overview", "cellular_service_state", "/cellular_service_state", "Cellular service", "", "state", false),
	metric("services.dns", "Services", "DHCP and DNS service state", "device_overview", "dns_service_state", "/dns_service_state", "DHCP/DNS service", "", "state", false),
	metric("services.dhcp_leases", "Services", "Active DHCPv4 lease count", "device_overview", "dhcp_lease_count", "/dhcp_lease_count", "DHCP leases", "", "gauge", false),
	metric("failover.lte2_state", "VPN and failover", "mwan3 state for LTE2", "device_overview", "mwan_lte2_state", "/mwan_lte2_state", "LTE2 failover state", "", "state", false),
	metric("failover.lte2_uptime", "VPN and failover", "mwan3 tracked LTE2 uptime", "device_overview", "mwan_lte2_uptime_seconds", "/mwan_lte2_uptime_seconds", "LTE2 failover uptime", "s", "gauge", false),
	metric("failover.lte2_loss", "VPN and failover", "mwan3 lost-probe count for LTE2", "device_overview", "mwan_lte2_lost", "/mwan_lte2_lost", "LTE2 lost probes", "", "counter", false),
	metric("failover.lte2_score", "VPN and failover", "mwan3 tracking score for LTE2", "device_overview", "mwan_lte2_score", "/mwan_lte2_score", "LTE2 failover score", "", "gauge", false),
	metric("ipsec.state", "VPN and failover", "Per-tunnel IPsec state", "ipsec", "state", "/state", "Tunnel state", "", "state", false),
	metric("ipsec.bytes_in", "VPN and failover", "Per-tunnel received bytes", "ipsec", "bytes_in", "/bytes_in", "Tunnel received", "B", "counter", false),
	metric("ipsec.bytes_out", "VPN and failover", "Per-tunnel transmitted bytes", "ipsec", "bytes_out", "/bytes_out", "Tunnel sent", "B", "counter", false),
	{ID: "industrial.modbus_gateway", Category: "Industrial optional", Description: "Modbus acquisition gateway service state when installed", SourceID: "modbus_health", RequiredCapability: "modbus", Field: Field{ID: "gateway_state", Path: "/gateway_state", Label: "Modbus gateway", Kind: "state"}},
	{ID: "industrial.modbus_errors", Category: "Industrial optional", Description: "Boot-local Modbus communication error count; log rotation is reported as a counter reset", SourceID: "modbus_health", RequiredCapability: "modbus", Field: Field{ID: "communication_errors", Path: "/communication_errors", Label: "Modbus communication errors", Kind: "counter"}},
}

var metricByID = func() map[string]catalogMetric {
	out := make(map[string]catalogMetric, len(monitoringMetricCatalog))
	for _, item := range monitoringMetricCatalog {
		out[item.ID] = item
	}
	return out
}()

type thresholdCondition struct {
	Operator string   `json:"operator"`
	Value    *float64 `json:"value,omitempty"`
	Minimum  *float64 `json:"minimum,omitempty"`
	Maximum  *float64 `json:"maximum,omitempty"`
}

type metricThreshold struct {
	Warning  *thresholdCondition `json:"warning,omitempty"`
	Critical *thresholdCondition `json:"critical,omitempty"`
	States   map[string]string   `json:"states,omitempty"`
}

type templateMetric struct {
	MetricID    string           `json:"metric_id"`
	Label       string           `json:"label,omitempty"`
	Description string           `json:"description,omitempty"`
	Threshold   *metricThreshold `json:"threshold,omitempty"`
}

type staleRule struct {
	Enabled         bool   `json:"enabled"`
	Severity        string `json:"severity,omitempty"`
	MissedIntervals int    `json:"missed_intervals,omitempty"`
}

type monitoringTemplateDefinition struct {
	CatalogVersion  int              `json:"catalog_version"`
	IntervalSeconds int              `json:"interval_seconds"`
	Metrics         []templateMetric `json:"metrics"`
	Stale           staleRule        `json:"stale"`
}

type monitoringTemplateRequest struct {
	OrganizationID string                       `json:"organization_id,omitempty"`
	Name           string                       `json:"name"`
	Description    string                       `json:"description"`
	Definition     monitoringTemplateDefinition `json:"definition"`
}

func validateCondition(c *thresholdCondition) error {
	if c == nil {
		return nil
	}
	switch c.Operator {
	case "gt", "gte", "lt", "lte":
		if c.Value == nil || c.Minimum != nil || c.Maximum != nil {
			return errors.New("comparison threshold requires one value")
		}
	case "outside":
		if c.Minimum == nil || c.Maximum == nil || *c.Minimum >= *c.Maximum || c.Value != nil {
			return errors.New("outside threshold requires minimum below maximum")
		}
	default:
		return errors.New("unsupported threshold operator")
	}
	return nil
}

func validateTemplateDefinition(def *monitoringTemplateDefinition) error {
	if def.CatalogVersion == 0 {
		def.CatalogVersion = monitoringCatalogVersion
	}
	if def.CatalogVersion != monitoringCatalogVersion || def.IntervalSeconds < 60 || def.IntervalSeconds > 300 || len(def.Metrics) == 0 || len(def.Metrics) > 64 {
		return errors.New("catalog version, 60-300 second interval and 1-64 metrics required")
	}
	seen := map[string]bool{}
	for i := range def.Metrics {
		item := &def.Metrics[i]
		catalog, ok := metricByID[item.MetricID]
		if !ok || seen[item.MetricID] {
			return errors.New("unknown or duplicate metric")
		}
		seen[item.MetricID] = true
		item.Label = strings.TrimSpace(item.Label)
		item.Description = strings.TrimSpace(item.Description)
		if len(item.Label) > 128 || len(item.Description) > 512 {
			return errors.New("metric label or description too long")
		}
		if item.Threshold == nil {
			continue
		}
		if strings.HasPrefix(item.MetricID, "availability.") {
			return errors.New("availability thresholds use the stale-data rule in v1")
		}
		if catalog.Field.Kind == "gauge" {
			if len(item.Threshold.States) != 0 || (item.Threshold.Warning == nil && item.Threshold.Critical == nil) {
				return errors.New("gauge threshold requires warning or critical comparison")
			}
			if err := validateCondition(item.Threshold.Warning); err != nil {
				return err
			}
			if err := validateCondition(item.Threshold.Critical); err != nil {
				return err
			}
		} else if catalog.Field.Kind == "state" {
			if item.Threshold.Warning != nil || item.Threshold.Critical != nil || len(item.Threshold.States) == 0 || len(item.Threshold.States) > 32 {
				return errors.New("state threshold requires a state severity map")
			}
			normalized := make(map[string]string, len(item.Threshold.States))
			for value, severity := range item.Threshold.States {
				if strings.TrimSpace(value) == "" || len(value) > 128 || (severity != "healthy" && severity != "warning" && severity != "critical") {
					return errors.New("invalid state threshold")
				}
				normalized[strings.ToLower(strings.TrimSpace(value))] = severity
			}
			item.Threshold.States = normalized
		} else {
			return errors.New("thresholds are supported only for gauges and states")
		}
	}
	if def.Stale.Enabled {
		if def.Stale.Severity != "warning" && def.Stale.Severity != "critical" {
			return errors.New("stale severity must be warning or critical")
		}
		if def.Stale.MissedIntervals < 2 || def.Stale.MissedIntervals > 10 {
			return errors.New("stale rule requires 2-10 missed intervals")
		}
	}
	return nil
}

func (s *Core) monitoringCatalog(w http.ResponseWriter, r *http.Request) {
	categories := []string{"Availability", "System", "Cellular", "WAN", "Ethernet and Wi-Fi", "VPN and failover", "Services", "Industrial"}
	output(w, 200, map[string]any{"version": monitoringCatalogVersion, "categories": categories, "metrics": monitoringMetricCatalog})
}

func templateOrg(a Actor, requested string) (string, bool) {
	if a.Role != "SUPER_ADMIN" {
		return a.Org, true
	}
	return requested, validID(requested)
}

func (s *Core) monitoringTemplates(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok {
		fail(w, 400, "invalid organization")
		return
	}
	s.rows(w, `SELECT row_to_json(x) FROM (
		SELECT t.id,t.organization_id,t.name,t.description,t.current_version AS version,
		       v.definition,t.archived,t.created_at,t.updated_at
		FROM monitoring_templates t
		JOIN monitoring_template_versions v ON v.template_id=t.id AND v.version=t.current_version
		WHERE ($1='' OR t.organization_id=$1) AND NOT t.archived
		ORDER BY t.name
	) x`, org)
}

func (s *Core) createMonitoringTemplate(w http.ResponseWriter, r *http.Request) {
	var req monitoringTemplateRequest
	if !body(w, r, &req) {
		return
	}
	req.Name, req.Description = strings.TrimSpace(req.Name), strings.TrimSpace(req.Description)
	if req.Name == "" || len(req.Name) > 128 || len(req.Description) > 512 {
		fail(w, 400, "valid template name and description required")
		return
	}
	if err := validateTemplateDefinition(&req.Definition); err != nil {
		fail(w, 400, err.Error())
		return
	}
	a := actor(r)
	org, ok := templateOrg(a, req.OrganizationID)
	if !ok {
		fail(w, 400, "valid organization required")
		return
	}
	id := randomID()
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "template storage unavailable")
		return
	}
	defer tx.Rollback()
	_, err = tx.Exec("INSERT INTO monitoring_templates(id,organization_id,name,description,current_version) VALUES($1,$2,$3,$4,1)", id, org, req.Name, req.Description)
	if err == nil {
		_, err = tx.Exec("INSERT INTO monitoring_template_versions(template_id,version,definition,created_by) VALUES($1,1,$2,$3)", id, string(raw(req.Definition)), a.ID)
	}
	if err == nil {
		err = audit(tx, org, a.ID, "monitoring.template.create", id)
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 409, "template name already exists or save failed")
		return
	}
	output(w, 201, map[string]any{"id": id, "version": 1})
}

func loadTemplateTx(tx *sql.Tx, id string, a Actor, lock bool) (string, int, error) {
	query := "SELECT organization_id,current_version FROM monitoring_templates WHERE id=$1 AND NOT archived AND ($2='SUPER_ADMIN' OR organization_id=$3)"
	if lock {
		query += " FOR UPDATE"
	}
	var org string
	var version int
	err := tx.QueryRow(query, id, a.Role, a.Org).Scan(&org, &version)
	return org, version, err
}

func (s *Core) updateMonitoringTemplate(w http.ResponseWriter, r *http.Request) {
	var req monitoringTemplateRequest
	if !body(w, r, &req) {
		return
	}
	req.Name, req.Description = strings.TrimSpace(req.Name), strings.TrimSpace(req.Description)
	if req.Name == "" || len(req.Name) > 128 || len(req.Description) > 512 {
		fail(w, 400, "valid template name and description required")
		return
	}
	if err := validateTemplateDefinition(&req.Definition); err != nil {
		fail(w, 400, err.Error())
		return
	}
	a, id := actor(r), r.PathValue("id")
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "template storage unavailable")
		return
	}
	defer tx.Rollback()
	org, current, err := loadTemplateTx(tx, id, a, true)
	next := current + 1
	if err == nil {
		_, err = tx.Exec("INSERT INTO monitoring_template_versions(template_id,version,definition,created_by) VALUES($1,$2,$3,$4)", id, next, string(raw(req.Definition)), a.ID)
	}
	if err == nil {
		_, err = tx.Exec("UPDATE monitoring_templates SET name=$2,description=$3,current_version=$4,updated_at=now() WHERE id=$1", id, req.Name, req.Description, next)
	}
	if err == nil {
		_, err = tx.Exec("UPDATE monitoring_bindings SET template_version=$2,updated_at=now() WHERE template_id=$1", id, next)
	}
	if err == nil {
		err = resolveTemplateAlertsTx(tx, id, "configuration_changed", time.Now().UTC())
	}
	if err == nil {
		err = reconcileOrganizationTx(tx, org)
	}
	if err == nil {
		err = audit(tx, org, a.ID, "monitoring.template.version", id)
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 409, "template update failed")
		return
	}
	output(w, 200, map[string]any{"id": id, "version": next})
}

func (s *Core) deleteMonitoringTemplate(w http.ResponseWriter, r *http.Request) {
	a, id := actor(r), r.PathValue("id")
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "template storage unavailable")
		return
	}
	defer tx.Rollback()
	org, _, err := loadTemplateTx(tx, id, a, true)
	if err == nil {
		_, err = tx.Exec("UPDATE monitoring_templates SET archived=true,updated_at=now() WHERE id=$1", id)
	}
	if err == nil {
		_, err = tx.Exec("UPDATE monitoring_bindings SET enabled=false,updated_at=now() WHERE template_id=$1", id)
	}
	if err == nil {
		err = resolveTemplateAlertsTx(tx, id, "unassigned", time.Now().UTC())
	}
	if err == nil {
		err = reconcileOrganizationTx(tx, org)
	}
	if err == nil {
		err = audit(tx, org, a.ID, "monitoring.template.archive", id)
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 404, "template not found or archive failed")
		return
	}
	w.WriteHeader(204)
}

type bindingRequest struct {
	TemplateID string `json:"template_id"`
	TargetType string `json:"target_type"`
	TargetID   string `json:"target_id"`
	Interval   int    `json:"interval_seconds,omitempty"`
	Enabled    *bool  `json:"enabled,omitempty"`
}

func validateBindingTargetTx(tx *sql.Tx, org, kind, id string) error {
	if !validID(id) {
		return errors.New("invalid target")
	}
	var found bool
	var query string
	switch kind {
	case "device":
		query = "SELECT EXISTS(SELECT 1 FROM devices WHERE id=$1 AND organization_id=$2 AND NOT revoked)"
	case "group":
		query = "SELECT EXISTS(SELECT 1 FROM device_groups WHERE id=$1 AND organization_id=$2)"
	case "tag":
		query = "SELECT EXISTS(SELECT 1 FROM tags WHERE id=$1 AND organization_id=$2)"
	default:
		return errors.New("target type must be device, group or tag")
	}
	if err := tx.QueryRow(query, id, org).Scan(&found); err != nil || !found {
		return errors.New("assignment target not found")
	}
	return nil
}

func (s *Core) monitoringBindings(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	org, ok := scopedOrganization(r, a)
	if !ok {
		fail(w, 400, "invalid organization")
		return
	}
	s.rows(w, `SELECT row_to_json(x) FROM (
		SELECT b.*,t.name AS template_name FROM monitoring_bindings b
		JOIN monitoring_templates t ON t.id=b.template_id
		WHERE $1='' OR b.organization_id=$1 ORDER BY b.created_at DESC
	) x`, org)
}

func (s *Core) createMonitoringBinding(w http.ResponseWriter, r *http.Request) {
	var req bindingRequest
	if !body(w, r, &req) {
		return
	}
	if req.Interval != 0 && (req.Interval < 60 || req.Interval > 300) {
		fail(w, 400, "interval must be 60-300 seconds")
		return
	}
	a := actor(r)
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "binding unavailable")
		return
	}
	defer tx.Rollback()
	org, version, err := loadTemplateTx(tx, req.TemplateID, a, false)
	if err == nil {
		err = validateBindingTargetTx(tx, org, req.TargetType, req.TargetID)
	}
	id := randomID()
	if err == nil {
		var interval any
		if req.Interval > 0 {
			interval = req.Interval
		}
		err = tx.QueryRow(`INSERT INTO monitoring_bindings(id,organization_id,template_id,template_version,target_type,target_id,interval_seconds)
			VALUES($1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT(template_id,target_type,target_id) DO UPDATE SET template_version=EXCLUDED.template_version,enabled=true,interval_seconds=EXCLUDED.interval_seconds,updated_at=now()
			RETURNING id`, id, org, req.TemplateID, version, req.TargetType, req.TargetID, interval).Scan(&id)
	}
	if err == nil {
		err = reconcileOrganizationTx(tx, org)
	}
	if err == nil {
		err = audit(tx, org, a.ID, "monitoring.binding.create", req.TargetID)
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 409, fmt.Sprintf("binding failed: %v", err))
		return
	}
	output(w, 201, map[string]any{"id": id, "effective": true})
}

func (s *Core) mutateMonitoringBinding(w http.ResponseWriter, r *http.Request) {
	a, id := actor(r), r.PathValue("id")
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "binding unavailable")
		return
	}
	defer tx.Rollback()
	var org string
	err = tx.QueryRow("SELECT organization_id FROM monitoring_bindings WHERE id=$1 AND ($2='SUPER_ADMIN' OR organization_id=$3) FOR UPDATE", id, a.Role, a.Org).Scan(&org)
	if err != nil {
		fail(w, 404, "binding not found")
		return
	}
	if r.Method == http.MethodDelete {
		_, err = tx.Exec("DELETE FROM monitoring_bindings WHERE id=$1", id)
	} else {
		var req struct {
			Enabled  bool `json:"enabled"`
			Interval int  `json:"interval_seconds,omitempty"`
		}
		if !body(w, r, &req) {
			return
		}
		if req.Interval != 0 && (req.Interval < 60 || req.Interval > 300) {
			fail(w, 400, "interval must be 60-300 seconds")
			return
		}
		var interval any
		if req.Interval > 0 {
			interval = req.Interval
		}
		_, err = tx.Exec("UPDATE monitoring_bindings SET enabled=$2,interval_seconds=$3,updated_at=now() WHERE id=$1", id, req.Enabled, interval)
	}
	if err == nil {
		err = reconcileOrganizationTx(tx, org)
	}
	if err == nil {
		err = audit(tx, org, a.ID, "monitoring.binding.update", id)
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 409, "binding update failed")
		return
	}
	w.WriteHeader(204)
}

type compiledSource struct {
	interval int
	fields   map[string]Field
}

func matchingDefinitionsTx(tx *sql.Tx, deviceID string) ([]monitoringTemplateDefinition, error) {
	rows, err := tx.Query(`SELECT v.definition,b.interval_seconds FROM monitoring_bindings b
		JOIN monitoring_template_versions v ON v.template_id=b.template_id AND v.version=b.template_version
		WHERE b.enabled AND (
			(b.target_type='device' AND b.target_id=$1) OR
			(b.target_type='group' AND EXISTS(SELECT 1 FROM device_group_members gm WHERE gm.device_id=$1 AND gm.group_id=b.target_id)) OR
			(b.target_type='tag' AND EXISTS(SELECT 1 FROM device_tags dt WHERE dt.device_id=$1 AND dt.tag_id=b.target_id))
		)`, deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []monitoringTemplateDefinition{}
	for rows.Next() {
		var data []byte
		var interval sql.NullInt64
		if err = rows.Scan(&data, &interval); err != nil {
			return nil, err
		}
		var def monitoringTemplateDefinition
		if err = json.Unmarshal(data, &def); err != nil {
			return nil, err
		}
		if interval.Valid {
			def.IntervalSeconds = int(interval.Int64)
		}
		out = append(out, def)
	}
	return out, rows.Err()
}

func compiledProfile(org, source string, item compiledSource) (Profile, error) {
	spec, ok := monitoringSources[source]
	if !ok {
		return Profile{}, errors.New("unknown collector source")
	}
	fields := make([]Field, 0, len(item.fields))
	for _, field := range item.fields {
		fields = append(fields, field)
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i].ID < fields[j].ID })
	p := Profile{Version: 1, Name: spec.Name, SourceID: source, Type: spec.Type, CollectorID: spec.CollectorID, Object: spec.Object, Method: spec.Method, Entities: spec.Entities, EntityKey: spec.EntityKey, Interval: item.interval, Timeout: spec.Timeout, MaxOutput: spec.MaxOutput, Fields: fields}
	b, _ := json.Marshal(struct {
		Organization string  `json:"organization"`
		Profile      Profile `json:"profile"`
	}{org, p})
	h := sha256.Sum256(b)
	p.ID = hex.EncodeToString(h[:16])
	return p, p.Validate()
}

func reconcileDeviceTx(tx *sql.Tx, deviceID, org string) error {
	if err := resolveOrphanedDeviceAlertsTx(tx, deviceID, "unassigned", time.Now().UTC()); err != nil {
		return err
	}
	definitions, err := matchingDefinitionsTx(tx, deviceID)
	if err != nil {
		return err
	}
	var agentVersion string
	if err = tx.QueryRow("SELECT agent_version FROM devices WHERE id=$1", deviceID).Scan(&agentVersion); err != nil {
		return err
	}
	compiled := map[string]*compiledSource{}
	for _, def := range definitions {
		for _, selected := range def.Metrics {
			catalog, ok := metricByID[selected.MetricID]
			if !ok || catalog.SourceID == "availability" {
				continue
			}
			if source, exists := monitoringSources[catalog.SourceID]; !exists || !versionAtLeast(agentVersion, source.MinAgent) {
				continue
			}
			item := compiled[catalog.SourceID]
			if item == nil {
				item = &compiledSource{interval: def.IntervalSeconds, fields: map[string]Field{}}
				compiled[catalog.SourceID] = item
			}
			if def.IntervalSeconds < item.interval {
				item.interval = def.IntervalSeconds
			}
			item.fields[catalog.Field.ID] = catalog.Field
		}
	}
	if item := compiled["device_overview"]; item != nil {
		for _, catalog := range monitoringMetricCatalog {
			if catalog.SourceID == "device_overview" && catalog.Baseline {
				item.fields[catalog.Field.ID] = catalog.Field
			}
		}
	}
	rows, err := tx.Query("SELECT profile_id,profile_version FROM monitoring_effective_assignments WHERE device_id=$1", deviceID)
	if err != nil {
		return err
	}
	type oldAssignment struct {
		id      string
		version int
	}
	old := []oldAssignment{}
	for rows.Next() {
		var x oldAssignment
		if err = rows.Scan(&x.id, &x.version); err != nil {
			rows.Close()
			return err
		}
		old = append(old, x)
	}
	rows.Close()
	for _, x := range old {
		if _, err = tx.Exec("DELETE FROM assignments WHERE device_id=$1 AND profile_id=$2 AND version=$3", deviceID, x.id, x.version); err != nil {
			return err
		}
	}
	if _, err = tx.Exec("DELETE FROM monitoring_effective_assignments WHERE device_id=$1", deviceID); err != nil {
		return err
	}
	if _, exists := compiled["device_overview"]; exists {
		_, err = tx.Exec("UPDATE assignments SET active=false WHERE device_id=$1 AND profile_id=$2", deviceID, DeviceOverviewProfileID)
	} else {
		_, err = tx.Exec(`INSERT INTO assignments(device_id,profile_id,version,active)
			SELECT $1,id,version,true FROM profiles WHERE id=$2 AND version=1
			ON CONFLICT(device_id,profile_id,version) DO UPDATE SET active=true`, deviceID, DeviceOverviewProfileID)
	}
	if err != nil {
		return err
	}
	if len(compiled) > 16 {
		return errors.New("at most 16 active monitoring sources per device")
	}
	for source, item := range compiled {
		p, err := compiledProfile(org, source, *item)
		if err != nil {
			return err
		}
		definition := string(raw(p))
		if _, err = tx.Exec("INSERT INTO profiles(id,version,name,definition,organization_id) VALUES($1,1,$2,$3,$4) ON CONFLICT(id,version) DO NOTHING", p.ID, p.Name, definition, org); err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT INTO assignments(device_id,profile_id,version,active) VALUES($1,$2,1,true) ON CONFLICT(device_id,profile_id,version) DO UPDATE SET active=true", deviceID, p.ID); err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT INTO monitoring_effective_assignments(device_id,source_id,profile_id,profile_version) VALUES($1,$2,$3,1)", deviceID, source, p.ID); err != nil {
			return err
		}
	}
	return nil
}

func reconcileOrganizationTx(tx *sql.Tx, org string) error {
	rows, err := tx.Query("SELECT id FROM devices WHERE organization_id=$1 AND NOT revoked ORDER BY id", org)
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		if err = reconcileDeviceTx(tx, id, org); err != nil {
			return err
		}
	}
	return nil
}

func (s *Core) deviceMonitoring(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.scopedDevice(r, id) {
		fail(w, 404, "device not found")
		return
	}
	s.rows(w, `SELECT row_to_json(x) FROM (
		SELECT b.id AS binding_id,b.target_type,b.target_id,b.enabled,b.interval_seconds,
		       t.id AS template_id,t.name,t.current_version AS version,v.definition
		FROM monitoring_bindings b
		JOIN monitoring_templates t ON t.id=b.template_id
		JOIN monitoring_template_versions v ON v.template_id=b.template_id AND v.version=b.template_version
		WHERE b.enabled AND ((b.target_type='device' AND b.target_id=$1)
		 OR (b.target_type='group' AND EXISTS(SELECT 1 FROM device_group_members gm WHERE gm.device_id=$1 AND gm.group_id=b.target_id))
		 OR (b.target_type='tag' AND EXISTS(SELECT 1 FROM device_tags dt WHERE dt.device_id=$1 AND dt.tag_id=b.target_id)))
		ORDER BY t.name
	) x`, id)
}

func (s *Core) deviceTag(w http.ResponseWriter, r *http.Request) {
	a := actor(r)
	deviceID, tagID := r.PathValue("id"), r.PathValue("tag")
	tx, err := s.DB.Begin()
	if err != nil {
		fail(w, 503, "tag update unavailable")
		return
	}
	defer tx.Rollback()
	var org, tagOrg string
	err = tx.QueryRow("SELECT organization_id FROM devices WHERE id=$1 AND NOT revoked AND ($2='SUPER_ADMIN' OR organization_id=$3) FOR UPDATE", deviceID, a.Role, a.Org).Scan(&org)
	if err == nil {
		err = tx.QueryRow("SELECT organization_id FROM tags WHERE id=$1 FOR SHARE", tagID).Scan(&tagOrg)
	}
	if err != nil || org != tagOrg {
		fail(w, 404, "device or tag not found")
		return
	}
	if r.Method == http.MethodPut {
		_, err = tx.Exec("INSERT INTO device_tags(device_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING", deviceID, tagID)
	} else {
		_, err = tx.Exec("DELETE FROM device_tags WHERE device_id=$1 AND tag_id=$2", deviceID, tagID)
	}
	if err == nil {
		err = reconcileDeviceTx(tx, deviceID, org)
	}
	if err == nil {
		action := "device.tag.remove"
		if r.Method == http.MethodPut {
			action = "device.tag.add"
		}
		err = audit(tx, org, a.ID, action, deviceID)
	}
	if err != nil || tx.Commit() != nil {
		fail(w, 409, "tag update failed")
		return
	}
	w.WriteHeader(204)
}

func (s *Core) monitoringPreview(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeviceID  string   `json:"device_id"`
		MetricIDs []string `json:"metric_ids"`
	}
	if !body(w, r, &req) {
		return
	}
	if len(req.MetricIDs) == 0 || len(req.MetricIDs) > 64 {
		fail(w, 400, "1-64 metrics required")
		return
	}
	a := actor(r)
	var agentVersion string
	if err := s.DB.QueryRow("SELECT agent_version FROM devices WHERE id=$1 AND NOT revoked AND ($2='SUPER_ADMIN' OR organization_id=$3)", req.DeviceID, a.Role, a.Org).Scan(&agentVersion); err != nil {
		fail(w, 404, "device not found")
		return
	}
	expected := map[string]bool{}
	seenMetrics := map[string]bool{}
	for _, id := range req.MetricIDs {
		catalog, ok := metricByID[id]
		if !ok || seenMetrics[id] {
			fail(w, 400, "unknown or duplicate metric")
			return
		}
		seenMetrics[id] = true
		if source, ok := monitoringSources[catalog.SourceID]; ok && versionAtLeast(agentVersion, source.MinAgent) {
			expected[catalog.SourceID] = true
		}
	}
	previewID := randomID()
	job := &monitoringPreviewJob{Result: monitoringPreviewResult{ID: previewID, DeviceID: req.DeviceID, Status: "pending", Cached: false, CreatedAt: time.Now().UTC()}, MetricIDs: append([]string(nil), req.MetricIDs...), Expected: expected, Samples: map[string]monitoringPreviewSample{}}
	job.rebuild()
	s.previews.Store(previewID, job)
	if len(expected) > 0 {
		collectors := make([]string, 0, len(expected))
		for source := range expected {
			collectors = append(collectors, monitoringSources[source].CollectorID)
		}
		sort.Strings(collectors)
		if s.Publish == nil || s.Publish("rms/v1/devices/"+req.DeviceID+"/commands", map[string]any{"action": "preview_collect", "request_id": previewID, "collector_ids": collectors}) != nil {
			s.previews.Delete(previewID)
			fail(w, 503, "router preview dispatch failed")
			return
		}
	}
	job.Mu.Lock()
	result := job.Result
	job.Mu.Unlock()
	output(w, 202, result)
}

type monitoringPreviewResult struct {
	ID        string           `json:"id"`
	DeviceID  string           `json:"device_id"`
	Status    string           `json:"status"`
	Cached    bool             `json:"cached"`
	Items     []map[string]any `json:"items"`
	CreatedAt time.Time        `json:"created_at"`
}

type monitoringPreviewSample struct {
	Status     string
	ObservedAt time.Time
	Data       []byte
}

type monitoringPreviewJob struct {
	Mu        sync.Mutex
	Result    monitoringPreviewResult
	MetricIDs []string
	Expected  map[string]bool
	Samples   map[string]monitoringPreviewSample
}

func (job *monitoringPreviewJob) rebuild() {
	items := make([]map[string]any, 0, len(job.MetricIDs))
	for _, id := range job.MetricIDs {
		catalog := metricByID[id]
		item := map[string]any{"metric_id": id, "available": false}
		if sample, ok := job.Samples[catalog.SourceID]; ok {
			item["source_status"] = sample.Status
			item["observed_at"] = sample.ObservedAt
			if sample.Status == "ok" {
				spec := monitoringSources[catalog.SourceID]
				profile := Profile{Entities: spec.Entities, EntityKey: spec.EntityKey, Fields: []Field{catalog.Field}}
				if values, err := Extract(profile, sample.Data); err == nil {
					if value, found := values[catalog.Field.ID]; found {
						item["available"], item["value"] = true, value
					} else {
						repeated := []Selected{}
						for key, value := range values {
							if strings.HasSuffix(key, ":"+catalog.Field.ID) {
								repeated = append(repeated, value)
							}
						}
						if len(repeated) > 0 {
							item["available"], item["value"] = true, repeated
						}
					}
				}
			}
		} else if !job.Expected[catalog.SourceID] {
			item["source_status"] = "unsupported"
		}
		items = append(items, item)
	}
	job.Result.Items = items
	complete := true
	for source := range job.Expected {
		if _, ok := job.Samples[source]; !ok {
			complete = false
			break
		}
	}
	if complete {
		job.Result.Status = "complete"
	}
}

func (s *Core) acceptMonitoringPreview(deviceID string, payload []byte) {
	var envelope struct {
		RequestID  string          `json:"request_id"`
		SourceID   string          `json:"source_id"`
		ObservedAt time.Time       `json:"observed_at"`
		Status     string          `json:"status"`
		Data       json.RawMessage `json:"data"`
	}
	if json.Unmarshal(payload, &envelope) != nil || !validID(envelope.RequestID) || !safeName(envelope.SourceID) || (envelope.Status != "ok" && envelope.Status != "error" && envelope.Status != "unsupported") || len(envelope.Data) > 32768 {
		return
	}
	value, ok := s.previews.Load(envelope.RequestID)
	if !ok {
		return
	}
	job, ok := value.(*monitoringPreviewJob)
	if !ok || job.Result.DeviceID != deviceID || !job.Expected[envelope.SourceID] {
		return
	}
	job.Mu.Lock()
	defer job.Mu.Unlock()
	job.Samples[envelope.SourceID] = monitoringPreviewSample{Status: envelope.Status, ObservedAt: envelope.ObservedAt, Data: append([]byte(nil), envelope.Data...)}
	job.rebuild()
}

func (s *Core) monitoringPreviewStatus(w http.ResponseWriter, r *http.Request) {
	value, ok := s.previews.Load(r.PathValue("id"))
	if !ok {
		fail(w, 404, "preview not found or expired")
		return
	}
	job, ok := value.(*monitoringPreviewJob)
	if !ok {
		fail(w, 404, "preview not found")
		return
	}
	job.Mu.Lock()
	defer job.Mu.Unlock()
	if time.Since(job.Result.CreatedAt) > 10*time.Minute {
		s.previews.Delete(job.Result.ID)
		fail(w, 404, "preview expired")
		return
	}
	if job.Result.Status == "pending" && time.Since(job.Result.CreatedAt) > 60*time.Second {
		job.Result.Status = "failed"
		job.rebuild()
	}
	if !s.scopedDevice(r, job.Result.DeviceID) {
		fail(w, 404, "preview not found")
		return
	}
	output(w, 200, job.Result)
}
