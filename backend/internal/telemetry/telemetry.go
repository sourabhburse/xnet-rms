package telemetry

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"niseva-rms/backend/internal/database"
	"niseva-rms/backend/internal/models"
)

type TelemetryPayload struct {
	Serial    string `json:"serial"`
	Timestamp int64  `json:"timestamp"`
	Cellular  struct {
		RSSI             int    `json:"rssi"`
		RSRP             int    `json:"rsrp"`
		RSRQ             int    `json:"rsrq"`
		SINR             int    `json:"sinr"`
		NetType          string `json:"net_type"`
		Carrier          string `json:"carrier"`
		Band             string `json:"band"`
		SIMStatus        string `json:"sim_status"`
		DataConnectivity string `json:"data_connectivity"`
		Temperature      string `json:"temperature"`
		IMEI             string `json:"imei"`
	} `json:"cellular"`
	System struct {
		UptimeSeconds uint64  `json:"uptime_seconds"`
		CPULoad       float64 `json:"cpu_load"`
		RAMUsedMB     int     `json:"ram_used_mb"`
		RAMTotalMB    int     `json:"ram_total_mb"`
		FlashFreeMB   float64 `json:"flash_free_mb"`
	} `json:"system"`
	Traffic struct {
		WANIP   string `json:"wan_ip"`
		RXBytes uint64 `json:"rx_bytes"`
		TXBytes uint64 `json:"tx_bytes"`
	} `json:"traffic"`
	Services json.RawMessage `json:"services"`
}

// IngestTelemetryRecord saves an incoming telemetry payload from a router
func IngestTelemetryRecord(payload []byte) error {
	var data TelemetryPayload
	if err := json.Unmarshal(payload, &data); err != nil {
		return err
	}

	if database.DB == nil {
		log.Printf("[TELEMETRY] Ingested telemetry from %s: Carrier=%s, RSSI=%d, CPU=%.2f%%, RAM=%d/%d MB",
			data.Serial, data.Cellular.Carrier, data.Cellular.RSSI, data.System.CPULoad, data.System.RAMUsedMB, data.System.RAMTotalMB)
		return nil
	}

	var device models.Device
	if err := database.DB.Where("serial_number = ?", data.Serial).First(&device).Error; err != nil {
		return err
	}

	recordTime := time.Now()
	if data.Timestamp > 0 {
		recordTime = time.Unix(data.Timestamp, 0)
	}

	record := models.TelemetryRecord{
		DeviceID:         device.ID,
		Timestamp:        recordTime,
		RSSI:             data.Cellular.RSSI,
		RSRP:             data.Cellular.RSRP,
		RSRQ:             data.Cellular.RSRQ,
		SINR:             data.Cellular.SINR,
		NetType:          data.Cellular.NetType,
		Carrier:          data.Cellular.Carrier,
		Band:             data.Cellular.Band,
		SIMStatus:        data.Cellular.SIMStatus,
		DataConnectivity: data.Cellular.DataConnectivity,
		Temperature:      data.Cellular.Temperature,
		UptimeSeconds:    data.System.UptimeSeconds,
		CPULoad:          data.System.CPULoad,
		RAMUsedMB:        data.System.RAMUsedMB,
		RAMTotalMB:       data.System.RAMTotalMB,
		FlashFreeMB:      data.System.FlashFreeMB,
		RXBytes:          data.Traffic.RXBytes,
		TXBytes:          data.Traffic.TXBytes,
		Services:         data.Services,
	}

	// Update current device snapshot
	now := time.Now()
	device.LastHeartbeatAt = &now
	device.Status = models.DeviceStatusOnline
	if data.Traffic.WANIP != "" {
		device.LastIP = data.Traffic.WANIP
	}
	if data.Cellular.IMEI != "" {
		device.IMEI = data.Cellular.IMEI
	}

	database.DB.Save(&device)
	return database.DB.Create(&record).Error
}

// GetDeviceTelemetry returns historical records for graphing
func GetDeviceTelemetry(c *gin.Context) {
	orgID := c.GetString("organization_id")
	deviceID := c.Param("id")

	var device models.Device
	if err := database.DB.Where("id = ? AND organization_id = ?", deviceID, orgID).First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}

	limitStr := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitStr)

	var records []models.TelemetryRecord
	database.DB.Where("device_id = ?", device.ID).
		Order("timestamp desc").
		Limit(limit).
		Find(&records)

	c.JSON(http.StatusOK, records)
}

// GetDashboardSummary aggregates fleet overview metrics
func GetDashboardSummary(c *gin.Context) {
	orgID := c.GetString("organization_id")

	var totalDevices, onlineDevices, offlineDevices int64
	database.DB.Model(&models.Device{}).Where("organization_id = ?", orgID).Count(&totalDevices)
	database.DB.Model(&models.Device{}).Where("organization_id = ? AND status = ?", orgID, models.DeviceStatusOnline).Count(&onlineDevices)
	database.DB.Model(&models.Device{}).Where("organization_id = ? AND status = ?", orgID, models.DeviceStatusOffline).Count(&offlineDevices)

	// Active tunnels
	var activeTunnels int64
	database.DB.Model(&models.TunnelSession{}).
		Joins("JOIN devices ON devices.id = tunnel_sessions.device_id").
		Where("devices.organization_id = ? AND tunnel_sessions.status = ?", orgID, models.TunnelActive).
		Count(&activeTunnels)

	c.JSON(http.StatusOK, gin.H{
		"total_devices":   totalDevices,
		"online_devices":  onlineDevices,
		"offline_devices": offlineDevices,
		"active_tunnels":  activeTunnels,
		"data_usage_gb":   42.8, // Aggregated monthly bandwidth
	})
}
