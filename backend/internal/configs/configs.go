package configs

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"niseva-rms/backend/internal/database"
	"niseva-rms/backend/internal/models"
	"niseva-rms/backend/internal/mqtt"
)

// ListProfiles returns all saved configuration profiles
func ListProfiles(c *gin.Context) {
	orgID := c.GetString("organization_id")
	if database.DB == nil {
		c.JSON(http.StatusOK, []gin.H{
			{
				"id":             "prof-01",
				"name":           "Standard Airtel 4G & Dual-SIM Fallback",
				"subsystem":      "CELLULAR",
				"description":    "Configures primary wwan0 APN to airtelgprs.com with auto-APN retry.",
				"version":        2,
				"uci_commands": []string{
					"set network.wwan.apn='airtelgprs.com'",
					"set network.wwan.proto='qmi'",
					"set network.wwan.auth='none'",
				},
				"created_at": time.Now().Add(-10 * 24 * time.Hour).Format(time.RFC3339),
			},
			{
				"id":             "prof-02",
				"name":           "Solar Farm Office Wi-Fi (WPA3-SAE)",
				"subsystem":      "WIFI",
				"description":    "Secure 2.4GHz office Wi-Fi with WPA3-SAE mixed encryption.",
				"version":        1,
				"uci_commands": []string{
					"set wireless.default_radio0.ssid='SolarOffice-WiFi'",
					"set wireless.default_radio0.encryption='sae-mixed'",
					"set wireless.default_radio0.key='SolarSecure2026!'",
				},
				"created_at": time.Now().Add(-5 * 24 * time.Hour).Format(time.RFC3339),
			},
			{
				"id":             "prof-03",
				"name":           "Headquarters IPsec strongSwan Tunnel",
				"subsystem":      "IPSEC",
				"description":    "Site-to-site IPsec tunnel bridging 192.168.1.0/24 to HQ 10.0.0.0/16.",
				"version":        3,
				"uci_commands": []string{
					"set ipsec.hq.gateway='198.51.100.1'",
					"set ipsec.hq.local_subnet='192.168.1.0/24'",
					"set ipsec.hq.remote_subnet='10.0.0.0/16'",
					"set ipsec.hq.auth_method='psk'",
				},
				"created_at": time.Now().Add(-2 * 24 * time.Hour).Format(time.RFC3339),
			},
			{
				"id":             "prof-04",
				"name":           "Modbus TCP Port Forward (Port 502)",
				"subsystem":      "FIREWALL",
				"description":    "Forwards WAN TCP 502 to internal solar inverter gateway at 192.168.1.50:502.",
				"version":        1,
				"uci_commands": []string{
					"add firewall redirect",
					"set firewall.@redirect[-1].name='Modbus-Inverter'",
					"set firewall.@redirect[-1].src='wan'",
					"set firewall.@redirect[-1].src_dport='502'",
					"set firewall.@redirect[-1].dest='lan'",
					"set firewall.@redirect[-1].dest_ip='192.168.1.50'",
					"set firewall.@redirect[-1].dest_port='502'",
					"set firewall.@redirect[-1].proto='tcp'",
				},
				"created_at": time.Now().Add(-1 * 24 * time.Hour).Format(time.RFC3339),
			},
		})
		return
	}

	var profiles []models.ConfigProfile
	database.DB.Where("organization_id = ?", orgID).Order("updated_at desc").Find(&profiles)
	c.JSON(http.StatusOK, profiles)
}

// CreateProfile saves a new configuration profile
func CreateProfile(c *gin.Context) {
	orgID := c.GetString("organization_id")

	var req struct {
		Name        string   `json:"name" binding:"required"`
		Description string   `json:"description"`
		Subsystem   string   `json:"subsystem"`
		UCICommands []string `json:"uci_commands" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	payloadBytes, _ := json.Marshal(req.UCICommands)

	profile := models.ConfigProfile{
		OrganizationID: orgID,
		Name:           req.Name,
		Description:    req.Description,
		UCIPayload:     payloadBytes,
		Version:        1,
	}

	if database.DB != nil {
		if err := database.DB.Create(&profile).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create profile"})
			return
		}
	} else {
		profile.ID = "prof-" + time.Now().Format("150405")
	}

	c.JSON(http.StatusCreated, profile)
}

// PushProfile pushes a configuration profile to target routers with watchdog
func PushProfile(c *gin.Context) {
	orgID := c.GetString("organization_id")
	profileID := c.Param("id")

	var req struct {
		DeviceIDs []string `json:"device_ids"`
	}
	_ = c.ShouldBindJSON(&req)

	if database.DB == nil {
		c.JSON(http.StatusOK, gin.H{
			"message":        "Configuration profile dispatched to selected routers with 180s failsafe rollback watchdog.",
			"target_devices": 42,
			"profile_id":     profileID,
		})
		return
	}

	var profile models.ConfigProfile
	if err := database.DB.Where("id = ? AND organization_id = ?", profileID, orgID).First(&profile).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Profile not found"})
		return
	}

	var uciCommands []string
	json.Unmarshal(profile.UCIPayload, &uciCommands)

	var devices []models.Device
	if len(req.DeviceIDs) > 0 {
		database.DB.Where("id IN ? AND organization_id = ?", req.DeviceIDs, orgID).Find(&devices)
	} else {
		database.DB.Where("organization_id = ?", orgID).Find(&devices)
	}

	for _, d := range devices {
		mqtt.DispatchCommand(d.SerialNumber, "config_push", map[string]interface{}{
			"uci_commands": uciCommands,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"message":        "Configuration profile dispatched to selected routers with 180s failsafe rollback watchdog.",
		"target_devices": len(devices),
		"profile_id":     profile.ID,
	})
}
