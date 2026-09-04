package deployments

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"niseva-rms/backend/internal/database"
	"niseva-rms/backend/internal/models"
	"niseva-rms/backend/internal/mqtt"
)

// ListFirmware returns all firmware versions registered for the tenant
func ListFirmware(c *gin.Context) {
	orgID := c.GetString("organization_id")
	if database.DB == nil {
		c.JSON(http.StatusOK, []gin.H{
			{
				"id":               "fw-01",
				"name":             "OpenWrt 23.05.2 - Niseva v1.2 LTS",
				"version":          "v1.2.0",
				"hardware_model":   "Niseva 2S",
				"file_size_bytes":  14680064,
				"checksum_sha256":  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				"file_url":         "http://82.180.146.203:8080/firmware/niseva-2s-v1.2.0.bin",
				"release_notes":    "Kernel security patches, enhanced cellular reconnect logic, and Parson JSON telemetry engine.",
				"created_at":       time.Now().Add(-72 * time.Hour).Format(time.RFC3339),
			},
			{
				"id":               "fw-02",
				"name":             "OpenWrt 21.02.5 - Legacy Stable",
				"version":          "v1.0.4",
				"hardware_model":   "Niseva 2S",
				"file_size_bytes":  12582912,
				"checksum_sha256":  "a6c5e8...51f9",
				"file_url":         "http://82.180.146.203:8080/firmware/niseva-2s-v1.0.4.bin",
				"release_notes":    "Initial factory release for solar inverters.",
				"created_at":       time.Now().Add(-30 * 24 * time.Hour).Format(time.RFC3339),
			},
		})
		return
	}

	var firmware []models.Firmware
	database.DB.Where("organization_id = ?", orgID).Order("created_at desc").Find(&firmware)
	c.JSON(http.StatusOK, firmware)
}

// CreateFirmware registers a new firmware sysupgrade image
func CreateFirmware(c *gin.Context) {
	orgID := c.GetString("organization_id")

	var req struct {
		Name           string `json:"name" binding:"required"`
		Version        string `json:"version" binding:"required"`
		HardwareModel  string `json:"hardware_model" binding:"required"`
		FileURL        string `json:"file_url" binding:"required"`
		ChecksumSHA256 string `json:"checksum_sha256" binding:"required"`
		FileSizeBytes  int64  `json:"file_size_bytes"`
		ReleaseNotes   string `json:"release_notes"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fw := models.Firmware{
		OrganizationID: orgID,
		Name:           req.Name,
		Version:        req.Version,
		HardwareModel:  req.HardwareModel,
		FileURL:        req.FileURL,
		ChecksumSHA256: req.ChecksumSHA256,
		FileSizeBytes:  req.FileSizeBytes,
		ReleaseNotes:   req.ReleaseNotes,
	}

	if database.DB != nil {
		if err := database.DB.Create(&fw).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create firmware record"})
			return
		}
	} else {
		fw.ID = "fw-" + time.Now().Format("150405")
	}

	c.JSON(http.StatusCreated, fw)
}

// ListPackages returns .ipk packages available for the tenant
func ListPackages(c *gin.Context) {
	orgID := c.GetString("organization_id")
	if database.DB == nil {
		c.JSON(http.StatusOK, []gin.H{
			{
				"id":              "pkg-01",
				"name":            "niseva-agent",
				"version":         "1.0.0-1",
				"architecture":    "mips_24kc",
				"file_size_bytes": 18432,
				"description":     "Native C management agent with Parson JSON and failsafe watchdog.",
				"file_url":        "http://82.180.146.203:8080/packages/niseva-agent_1.0.0-1_mips_24kc.ipk",
				"created_at":      time.Now().Format(time.RFC3339),
			},
			{
				"id":              "pkg-02",
				"name":            "modbus-master",
				"version":         "2.0-9",
				"architecture":    "mips_24kc",
				"file_size_bytes": 13433,
				"description":     "Modbus RTU/TCP telemetry poller for solar inverters.",
				"file_url":        "http://82.180.146.203:8080/packages/modbus-master_2.0-9_mips_24kc.ipk",
				"created_at":      time.Now().Add(-48 * time.Hour).Format(time.RFC3339),
			},
		})
		return
	}

	var packages []models.SoftwarePackage
	database.DB.Where("organization_id = ?", orgID).Order("created_at desc").Find(&packages)
	c.JSON(http.StatusOK, packages)
}

// ListRollouts returns all deployment rollouts
func ListRollouts(c *gin.Context) {
	orgID := c.GetString("organization_id")
	if database.DB == nil {
		c.JSON(http.StatusOK, []gin.H{
			{
				"id":             "rollout-01",
				"name":           "Fleet Upgrade to Niseva v1.2 LTS",
				"type":           "FIRMWARE",
				"target_version": "v1.2.0",
				"strategy":       "CANARY_THEN_ALL",
				"status":         "IN_PROGRESS",
				"total_devices":  42,
				"success_count":  38,
				"failure_count":  1,
				"created_at":     time.Now().Add(-2 * time.Hour).Format(time.RFC3339),
			},
			{
				"id":             "rollout-02",
				"name":           "Deploy niseva-agent 1.0.0",
				"type":           "PACKAGE",
				"target_version": "1.0.0-1",
				"strategy":       "IMMEDIATE",
				"status":         "COMPLETED",
				"total_devices":  42,
				"success_count":  42,
				"failure_count":  0,
				"created_at":     time.Now().Add(-24 * time.Hour).Format(time.RFC3339),
			},
		})
		return
	}

	var rollouts []models.DeploymentRollout
	database.DB.Where("organization_id = ?", orgID).Order("created_at desc").Find(&rollouts)
	c.JSON(http.StatusOK, rollouts)
}

// StartRollout initiates a new firmware or package rollout
func StartRollout(c *gin.Context) {
	orgID := c.GetString("organization_id")

	var req struct {
		Name          string   `json:"name" binding:"required"`
		Type          string   `json:"type" binding:"required"` // "FIRMWARE" | "PACKAGE"
		TargetID      string   `json:"target_id" binding:"required"`
		TargetVersion string   `json:"target_version" binding:"required"`
		Strategy      string   `json:"strategy"` // "CANARY_THEN_ALL" | "IMMEDIATE"
		DeviceIDs     []string `json:"device_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	strategy := req.Strategy
	if strategy == "" {
		strategy = "CANARY_THEN_ALL"
	}

	total := len(req.DeviceIDs)
	if total == 0 {
		total = 42
	}

	rollout := models.DeploymentRollout{
		OrganizationID: orgID,
		Name:           req.Name,
		Type:           req.Type,
		TargetID:       req.TargetID,
		TargetVersion:  req.TargetVersion,
		Strategy:       strategy,
		Status:         "IN_PROGRESS",
		TotalDevices:   total,
		SuccessCount:   0,
		FailureCount:   0,
	}

	if database.DB != nil {
		database.DB.Create(&rollout)

		// Dispatch MQTT commands to devices
		var devices []models.Device
		if len(req.DeviceIDs) > 0 {
			database.DB.Where("id IN ? AND organization_id = ?", req.DeviceIDs, orgID).Find(&devices)
		} else {
			database.DB.Where("organization_id = ?", orgID).Find(&devices)
		}

		for _, d := range devices {
			if req.Type == "FIRMWARE" {
				mqtt.DispatchCommand(d.SerialNumber, "sysupgrade", map[string]interface{}{
					"url":    "http://82.180.146.203:8080/firmware/" + req.TargetVersion + ".bin",
					"sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				})
			}
		}
	} else {
		rollout.ID = "rollout-" + time.Now().Format("150405")
	}

	c.JSON(http.StatusCreated, rollout)
}
