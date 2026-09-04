package alerts

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// ListRules returns configured alert rules
func ListRules(c *gin.Context) {
	c.JSON(http.StatusOK, []gin.H{
		{
			"id":              "rule-01",
			"name":            "Anti-Theft SIM Swap / IMEI Mismatch",
			"trigger_type":    "SIM_SWAP_IMEI_MISMATCH",
			"severity":        "CRITICAL",
			"threshold_desc":  "Triggers immediately if SIM IMSI changes or IMEI differs from claimed hardware",
			"channels":        []string{"SLACK", "TELEGRAM", "EMAIL"},
			"is_active":       true,
			"created_at":      time.Now().Add(-30 * 24 * time.Hour).Format(time.RFC3339),
		},
		{
			"id":              "rule-02",
			"name":            "Cellular Signal Drop (Marginal RF)",
			"trigger_type":    "CELLULAR_RSSI_DROP",
			"severity":        "WARNING",
			"threshold_desc":  "RSSI < 60 or fallback from LTE to 2G/EDGE for > 10 minutes",
			"channels":        []string{"SLACK"},
			"is_active":       true,
			"created_at":      time.Now().Add(-20 * 24 * time.Hour).Format(time.RFC3339),
		},
		{
			"id":              "rule-03",
			"name":            "Router Offline (3 Heartbeats Missed)",
			"trigger_type":    "DEVICE_OFFLINE",
			"severity":        "CRITICAL",
			"threshold_desc":  "Device misses 3 consecutive 60s heartbeats (180s silence)",
			"channels":        []string{"SLACK", "TELEGRAM"},
			"is_active":       true,
			"created_at":      time.Now().Add(-15 * 24 * time.Hour).Format(time.RFC3339),
		},
		{
			"id":              "rule-04",
			"name":            "Monthly Cellular Data Quota (80% & 100%)",
			"trigger_type":    "DATA_QUOTA_REACHED",
			"severity":        "WARNING",
			"threshold_desc":  "WAN interface traffic exceeds 20 GB of 25 GB monthly allowance",
			"channels":        []string{"EMAIL"},
			"is_active":       true,
			"created_at":      time.Now().Add(-10 * 24 * time.Hour).Format(time.RFC3339),
		},
	})
}

// ListIncidents returns active and recent alarm incidents
func ListIncidents(c *gin.Context) {
	c.JSON(http.StatusOK, []gin.H{
		{
			"id":            "inc-01",
			"rule_name":     "Router Offline (3 Heartbeats Missed)",
			"severity":      "CRITICAL",
			"device_name":   "Substation Inverter #3",
			"serial_number": "NSV-2S-2026-00414",
			"status":        "ACTIVE",
			"message":       "Router disconnected unexpectedly from Airtel 4G cell tower. LWT trigger fired.",
			"triggered_at":  time.Now().Add(-1 * time.Hour).Format(time.RFC3339),
		},
		{
			"id":            "inc-02",
			"rule_name":     "Cellular Signal Drop (Marginal RF)",
			"severity":      "WARNING",
			"device_name":   "Solar Site 02 Gateway",
			"serial_number": "NSV-2S-2026-00413",
			"status":        "ACKNOWLEDGED",
			"message":       "Cellular RSSI degraded to 54 dBm due to heavy rain. Signal quality marginal.",
			"triggered_at":  time.Now().Add(-3 * time.Hour).Format(time.RFC3339),
		},
		{
			"id":            "inc-03",
			"rule_name":     "Monthly Cellular Data Quota (80%)",
			"severity":      "INFO",
			"device_name":   "Solar Site 01 Gateway",
			"serial_number": "NSV-2S-2026-00412",
			"status":        "RESOLVED",
			"message":       "Device consumed 20.1 GB / 25 GB monthly quota. Quota reset scheduled for 1st of month.",
			"triggered_at":  time.Now().Add(-24 * time.Hour).Format(time.RFC3339),
			"resolved_at":   time.Now().Add(-12 * time.Hour).Format(time.RFC3339),
		},
	})
}

// AcknowledgeIncident acknowledges an alarm
func AcknowledgeIncident(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "Incident acknowledged by operator"})
}

// ResolveIncident marks an alarm resolved
func ResolveIncident(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "Incident marked as resolved"})
}

// TestWebhook dispatches a mock webhook alert
func TestWebhook(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "Test alert notification dispatched successfully!"})
}
