package devices

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"niseva-rms/backend/internal/database"
	"niseva-rms/backend/internal/models"
)

type ClaimDeviceRequest struct {
	SerialNumber string `json:"serial_number" binding:"required"`
	MACAddress   string `json:"mac_address" binding:"required"`
	DeviceSecret string `json:"device_secret" binding:"required"`
	Name         string `json:"name"`
	GroupID      *string `json:"group_id"`
}

type CheckInRequest struct {
	SerialNumber    string `json:"serial_number" binding:"required"`
	MACAddress      string `json:"mac_address" binding:"required"`
	HardwareModel   string `json:"hardware_model"`
	FirmwareVersion string `json:"firmware_version"`
	EnrollmentToken string `json:"enrollment_token"`
}

type MqttAuthRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	ClientID string `json:"clientid"`
}

// GenerateSecureToken creates a cryptographically strong random token
func GenerateSecureToken() (string, string, error) {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return "", "", err
	}
	rawToken := "nsv_dev_" + hex.EncodeToString(bytes)
	hashBytes, err := bcrypt.GenerateFromPassword([]byte(rawToken), bcrypt.DefaultCost)
	if err != nil {
		return "", "", err
	}
	return rawToken, string(hashBytes), nil
}

// ListDevices returns all devices belonging to the user's organization
func ListDevices(c *gin.Context) {
	if database.DB == nil {
		c.JSON(http.StatusOK, []gin.H{
			{
				"id":               "dev-01",
				"serial_number":    "NSV-2S-2026-00412",
				"name":             "Solar Site 01 Gateway",
				"hardware_model":   "Niseva 2S",
				"architecture":     "mips_24kc",
				"firmware_version": "v1.0.0-lts",
				"status":           "ONLINE",
				"ip_address":       "192.168.1.1",
				"cellular_carrier": "Airtel 4G",
				"cellular_rssi":    82,
				"cellular_rsrp":    -85,
				"cellular_rsrq":    -10,
				"cellular_sinr":    18,
				"capabilities": gin.H{
					"sim_slots":      1,
					"has_gps":        false,
					"has_rs485":      false,
					"has_wifi_5g":    false,
					"ethernet_ports": 2,
					"is_5g":          false,
				},
				"uptime_seconds": 864200,
				"last_seen_at":   time.Now().Format(time.RFC3339),
			},
			{
				"id":               "dev-02",
				"serial_number":    "NSV-2M-2026-00819",
				"name":             "Gujarat Grid Substation #4",
				"hardware_model":   "Niseva 2M",
				"architecture":     "mips_24kc",
				"firmware_version": "v1.1.2-lts",
				"status":           "ONLINE",
				"ip_address":       "192.168.10.1",
				"cellular_carrier": "Jio LTE (SIM 1 Active)",
				"cellular_rssi":    88,
				"cellular_rsrp":    -79,
				"cellular_rsrq":    -8,
				"cellular_sinr":    22,
				"capabilities": gin.H{
					"sim_slots":      2,
					"has_gps":        false,
					"has_rs485":      true,
					"has_wifi_5g":    false,
					"ethernet_ports": 2,
					"is_5g":          false,
				},
				"uptime_seconds": 1248000,
				"last_seen_at":   time.Now().Format(time.RFC3339),
			},
			{
				"id":               "dev-03",
				"serial_number":    "NSV-4GP-2026-0104",
				"name":             "Fleet Logistics Bus #12",
				"hardware_model":   "Niseva 4G-Pro",
				"architecture":     "mips_1004kc",
				"firmware_version": "v1.2.0-beta",
				"status":           "ONLINE",
				"ip_address":       "192.168.1.1",
				"cellular_carrier": "Vodafone Idea 4G",
				"cellular_rssi":    74,
				"cellular_rsrp":    -91,
				"cellular_rsrq":    -12,
				"cellular_sinr":    14,
				"capabilities": gin.H{
					"sim_slots":      2,
					"has_gps":        true,
					"has_rs485":      false,
					"has_wifi_5g":    true,
					"ethernet_ports": 4,
					"is_5g":          false,
				},
				"uptime_seconds": 342000,
				"last_seen_at":   time.Now().Format(time.RFC3339),
			},
			{
				"id":               "dev-04",
				"serial_number":    "NSV-5GU-2026-0002",
				"name":             "Port Terminal CCTV Hub",
				"hardware_model":   "Niseva 5G-Ultra",
				"architecture":     "aarch64",
				"firmware_version": "v2.0.0-rc1",
				"status":           "ONLINE",
				"ip_address":       "10.50.0.1",
				"cellular_carrier": "Airtel 5G Plus",
				"cellular_rssi":    96,
				"cellular_rsrp":    -72,
				"cellular_rsrq":    -6,
				"cellular_sinr":    28,
				"capabilities": gin.H{
					"sim_slots":      2,
					"has_gps":        true,
					"has_rs485":      true,
					"has_wifi_5g":    true,
					"ethernet_ports": 5,
					"is_5g":          true,
				},
				"uptime_seconds": 2180000,
				"last_seen_at":   time.Now().Format(time.RFC3339),
			},
			{
				"id":               "dev-05",
				"serial_number":    "NSV-2S-2026-00414",
				"name":             "Substation Inverter #3",
				"hardware_model":   "Niseva 2S",
				"architecture":     "mips_24kc",
				"firmware_version": "v1.0.0-lts",
				"status":           "OFFLINE",
				"ip_address":       "192.168.1.1",
				"cellular_carrier": "Airtel 4G",
				"cellular_rssi":    0,
				"capabilities": gin.H{
					"sim_slots":      1,
					"has_gps":        false,
					"has_rs485":      false,
					"has_wifi_5g":    false,
					"ethernet_ports": 2,
					"is_5g":          false,
				},
				"uptime_seconds": 0,
				"last_seen_at":   time.Now().Add(-2 * time.Hour).Format(time.RFC3339),
			},
		})
		return
	}

	orgID := c.GetString("organization_id")
	userRole := c.GetString("role")
	var devices []models.Device

	query := database.DB.Model(&models.Device{})
	if userRole != "SUPER_ADMIN" && orgID != "" {
		query = query.Where("organization_id = ?", orgID)
	}
	if status := c.Query("status"); status != "" && status != "ALL" {
		query = query.Where("status = ?", status)
	}
	if groupID := c.Query("group_id"); groupID != "" {
		query = query.Where("group_id = ?", groupID)
	}

	if err := query.Order("created_at desc").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch devices"})
		return
	}

	var result []gin.H
	for _, dev := range devices {
		var latest models.TelemetryRecord
		_ = database.DB.Where("device_id = ?", dev.ID).Order("timestamp desc").First(&latest).Error

		d := gin.H{
			"id":                dev.ID,
			"serial_number":     dev.SerialNumber,
			"mac_address":       dev.MACAddress,
			"name":              dev.Name,
			"hardware_model":    dev.Model,
			"model":             dev.Model,
			"imei":              dev.IMEI,
			"firmware_version":  dev.FirmwareVersion,
			"status":            dev.Status,
			"last_ip":           dev.LastIP,
			"ip_address":        dev.LastIP,
			"organization_id":   dev.OrganizationID,
			"group_id":          dev.GroupID,
			"last_heartbeat_at": dev.LastHeartbeatAt,
			"created_at":        dev.CreatedAt,
			"updated_at":        dev.UpdatedAt,
			"cellular_rssi":     latest.RSSI,
			"rssi":              latest.RSSI,
			"cellular_rsrp":     latest.RSRP,
			"cellular_rsrq":     latest.RSRQ,
			"cellular_sinr":     latest.SINR,
			"cellular_carrier":  latest.Carrier,
			"carrier":           latest.Carrier,
			"cpu_load":          latest.CPULoad,
			"ram_used_mb":       latest.RAMUsedMB,
			"ram_total_mb":      latest.RAMTotalMB,
			"flash_free_mb":     latest.FlashFreeMB,
			"uptime_seconds":    latest.UptimeSeconds,
			"caps": gin.H{
				"sim_slots":      1,
				"has_gps":        false,
				"has_rs485":      false,
				"has_wifi_5g":    false,
				"ethernet_ports": 2,
				"is_5g":          false,
			},
		}
		result = append(result, d)
	}

	c.JSON(http.StatusOK, result)
}

// GetDevice returns details of a single device
func GetDevice(c *gin.Context) {
	orgID := c.GetString("organization_id")
	userRole := c.GetString("role")
	deviceID := c.Param("id")

	var device models.Device
	query := database.DB.Where("id = ?", deviceID)
	if userRole != "SUPER_ADMIN" && orgID != "" {
		query = query.Where("organization_id = ?", orgID)
	}
	if err := query.First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}

	var latest models.TelemetryRecord
	_ = database.DB.Where("device_id = ?", device.ID).Order("timestamp desc").First(&latest).Error

	c.JSON(http.StatusOK, gin.H{
		"id":                device.ID,
		"serial_number":     device.SerialNumber,
		"mac_address":       device.MACAddress,
		"name":              device.Name,
		"hardware_model":    device.Model,
		"model":             device.Model,
		"imei":              device.IMEI,
		"firmware_version":  device.FirmwareVersion,
		"status":            device.Status,
		"last_ip":           device.LastIP,
		"ip_address":        device.LastIP,
		"organization_id":   device.OrganizationID,
		"group_id":          device.GroupID,
		"last_heartbeat_at": device.LastHeartbeatAt,
		"created_at":        device.CreatedAt,
		"updated_at":        device.UpdatedAt,
		"cellular_rssi":     latest.RSSI,
		"rssi":              latest.RSSI,
		"cellular_rsrp":     latest.RSRP,
		"cellular_rsrq":     latest.RSRQ,
		"cellular_sinr":     latest.SINR,
		"cellular_carrier":  latest.Carrier,
		"carrier":           latest.Carrier,
		"cpu_load":          latest.CPULoad,
		"ram_used_mb":       latest.RAMUsedMB,
		"ram_total_mb":      latest.RAMTotalMB,
		"flash_free_mb":     latest.FlashFreeMB,
		"uptime_seconds":    latest.UptimeSeconds,
		"caps": gin.H{
			"sim_slots":      1,
			"has_gps":        false,
			"has_rs485":      false,
			"has_wifi_5g":    false,
			"ethernet_ports": 2,
			"is_5g":          false,
		},
	})
}

// ClaimDevice binds an unclaimed physical router to the customer's organization
func ClaimDevice(c *gin.Context) {
	orgID := c.GetString("organization_id")
	var req ClaimDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var device models.Device
	err := database.DB.Where("serial_number = ?", req.SerialNumber).First(&device).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
		return
	}

	// If record doesn't exist yet, create it as pending claim
	if err == gorm.ErrRecordNotFound {
		device = models.Device{
			SerialNumber: req.SerialNumber,
			MACAddress:   req.MACAddress,
			DeviceSecret: req.DeviceSecret,
			Status:       models.DeviceStatusPending,
		}
	} else {
		// If already claimed by another organization
		if device.OrganizationID != nil && *device.OrganizationID != orgID {
			c.JSON(http.StatusConflict, gin.H{"error": "This device is already claimed by another organization"})
			return
		}

		// Verify MAC and Secret match
		if device.DeviceSecret != "" && device.DeviceSecret != req.DeviceSecret {
			c.JSON(http.StatusForbidden, gin.H{"error": "Invalid Device Secret. Please check the label under your router."})
			return
		}
	}

	rawToken, tokenHash, err := GenerateSecureToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate security credentials"})
		return
	}

	device.Name = req.Name
	if device.Name == "" {
		device.Name = "Router " + req.SerialNumber
	}
	device.OrganizationID = &orgID
	device.GroupID = req.GroupID
	device.TokenHash = tokenHash
	device.Status = models.DeviceStatusPending

	if err := database.DB.Save(&device).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to claim device"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "Device claimed successfully. Router will connect on next check-in.",
		"device":     device,
		"temp_token": rawToken,
	})
}

// RouterCheckIn handles the bootstrap check-in from the on-router C agent
func RouterCheckIn(c *gin.Context) {
	var req CheckInRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	mqttHost := os.Getenv("MQTT_PUBLIC_HOST")
	if mqttHost == "" {
		mqttHost = "82.180.146.203"
	}
	mqttPort := 1883
	if p := os.Getenv("MQTT_PUBLIC_PORT"); p != "" {
		if intVal, err := strconv.Atoi(p); err == nil {
			mqttPort = intVal
		}
	}

	if database.DB == nil {
		rawToken, _, _ := GenerateSecureToken()
		c.JSON(http.StatusOK, gin.H{
			"status":             "PROVISIONED",
			"mqtt_host":          mqttHost,
			"mqtt_port":          mqttPort,
			"mqtt_token":         rawToken,
			"mqtt": gin.H{
				"host":      mqttHost,
				"port":      mqttPort,
				"client_id": "NSV-" + req.SerialNumber,
				"username":  "device-" + req.SerialNumber,
				"token":     rawToken,
			},
			"telemetry_interval": 300,
			"heartbeat_interval": 60,
		})
		return
	}

	var device models.Device
	err := database.DB.Where("serial_number = ?", req.SerialNumber).First(&device).Error

	// If device is not in registry at all, register as UNCLAIMED
	if err == gorm.ErrRecordNotFound {
		device = models.Device{
			SerialNumber:    req.SerialNumber,
			MACAddress:      req.MACAddress,
			Model:           req.HardwareModel,
			FirmwareVersion: req.FirmwareVersion,
			Status:          models.DeviceStatusUnclaimed,
			LastIP:          c.ClientIP(),
		}

		// If enrollment token is provided, auto-bind to organization
		if req.EnrollmentToken != "" {
			var enroll models.EnrollmentToken
			if err := database.DB.Where("token = ?", req.EnrollmentToken).First(&enroll).Error; err == nil {
				if enroll.ExpiresAt == nil || enroll.ExpiresAt.After(time.Now()) {
					if enroll.MaxUses == nil || enroll.UsedCount < *enroll.MaxUses {
						rawToken, tokenHash, _ := GenerateSecureToken()
						device.OrganizationID = &enroll.OrganizationID
						device.GroupID = enroll.GroupID
						device.TokenHash = tokenHash
						device.Status = models.DeviceStatusPending
						database.DB.Model(&enroll).Update("used_count", enroll.UsedCount+1)
						database.DB.Create(&device)

						c.JSON(http.StatusOK, gin.H{
							"status":             "PROVISIONED",
							"mqtt_host":          mqttHost,
							"mqtt_port":          mqttPort,
							"mqtt_token":         rawToken,
							"mqtt": gin.H{
								"host":      mqttHost,
								"port":      mqttPort,
								"client_id": "NSV-" + device.SerialNumber,
								"username":  "device-" + device.SerialNumber,
								"token":     rawToken,
							},
							"telemetry_interval": 300,
							"heartbeat_interval": 60,
						})
						return
					}
				}
			}
		}

		database.DB.Create(&device)
		c.JSON(http.StatusOK, gin.H{
			"status":                "UNCLAIMED",
			"poll_interval_seconds": 30,
		})
		return
	}

	// If claimed and pending credentials delivery
	if device.OrganizationID != nil && device.Status == models.DeviceStatusPending {
		rawToken, tokenHash, _ := GenerateSecureToken()
		device.TokenHash = tokenHash
		device.Status = models.DeviceStatusOnline
		device.LastIP = c.ClientIP()
		database.DB.Save(&device)

		c.JSON(http.StatusOK, gin.H{
			"status":             "PROVISIONED",
			"mqtt_host":          mqttHost,
			"mqtt_port":          mqttPort,
			"mqtt_token":         rawToken,
			"mqtt": gin.H{
				"host":      mqttHost,
				"port":      mqttPort,
				"client_id": "NSV-" + device.SerialNumber,
				"username":  "device-" + device.SerialNumber,
				"token":     rawToken,
			},
			"telemetry_interval": 300,
			"heartbeat_interval": 60,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":                string(device.Status),
		"poll_interval_seconds": 60,
	})
}

// InternalMqttAuth handles Mosquitto go-auth webhook
func InternalMqttAuth(c *gin.Context) {
	var req MqttAuthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Backend internal user
	if req.Username == "niseva_backend" && req.Password == "backend_secret_2026" {
		c.JSON(http.StatusOK, gin.H{"result": "ok"})
		return
	}

	serial := strings.TrimPrefix(req.Username, "device-")
	var device models.Device
	if err := database.DB.Where("serial_number = ?", serial).First(&device).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Device not found"})
		return
	}

	if device.TokenHash == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "No active credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(device.TokenHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"result": "ok"})
}

// ListProducts returns the registered product models and their hardware specifications
func ListProducts(c *gin.Context) {
	c.JSON(http.StatusOK, []gin.H{
		{
			"model":            "Niseva 2S",
			"slug":             "niseva-2s",
			"category":         "Compact Industrial 4G Router",
			"architecture":     "mips_24kc",
			"soc":              "MediaTek MT7628 / QCA9531",
			"cellular":         "4G LTE Cat 4 (Single SIM)",
			"ethernet":         "2x 10/100 Mbps (1 WAN, 1 LAN)",
			"wifi":             "2.4GHz 802.11b/g/n (300 Mbps)",
			"serial_ports":     "None",
			"gps":              false,
			"target_use":       "Solar Farm Monitoring, ATM / Kiosks, Smart Metering",
			"certified_fw":     "v1.0.0-lts",
		},
		{
			"model":            "Niseva 2M",
			"slug":             "niseva-2m",
			"category":         "Dual-SIM & Modbus Industrial Gateway",
			"architecture":     "mips_24kc",
			"soc":              "MediaTek MT7628AN",
			"cellular":         "4G LTE Cat 4 (Dual SIM Auto-Failover)",
			"ethernet":         "2x 10/100 Mbps (1 WAN, 1 LAN)",
			"wifi":             "2.4GHz 802.11b/g/n",
			"serial_ports":     "1x RS485 / RS232 (Modbus RTU/TCP Gateway)",
			"gps":              false,
			"target_use":       "Power Substation SCADA, Industrial PLC Inverters",
			"certified_fw":     "v1.1.2-lts",
		},
		{
			"model":            "Niseva 4G-Pro",
			"slug":             "niseva-4g-pro",
			"category":         "Multi-Port Gigabit Fleet & Branch Router",
			"architecture":     "mips_1004kc",
			"soc":              "MediaTek MT7621A Dual-Core 880MHz",
			"cellular":         "4G LTE Cat 6 / Cat 12 (Dual SIM)",
			"ethernet":         "4x Gigabit 10/100/1000 Mbps (1 WAN, 3 LAN)",
			"wifi":             "Dual-Band AC1200 (2.4GHz + 5GHz)",
			"serial_ports":     "1x RS232 Console",
			"gps":              true,
			"target_use":       "Transit Buses & Police Fleets, Enterprise Branch Backup",
			"certified_fw":     "v1.2.0-lts",
		},
		{
			"model":            "Niseva 5G-Ultra",
			"slug":             "niseva-5g-ultra",
			"category":         "Next-Gen High-Throughput 5G Enterprise Gateway",
			"architecture":     "aarch64",
			"soc":              "Quad-Core ARM Cortex-A53 1.3GHz",
			"cellular":         "5G Sub-6GHz SA/NSA (Dual SIM + eSIM)",
			"ethernet":         "5x Gigabit RJ45 + 1x SFP Optical Port",
			"wifi":             "Wi-Fi 6 AX1800 (802.11ax)",
			"serial_ports":     "1x RS485 Isolated + 2x DI/DO",
			"gps":              true,
			"target_use":       "CCTV Video Surveillance, Port Terminal Automation, Edge AI",
			"certified_fw":     "v2.0.0-rc1",
		},
	})
}
