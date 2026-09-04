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

	limitStr := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitStr)
	if limit <= 0 || limit > 1000 {
		limit = 100
	}

	var records []models.TelemetryRecord
	database.DB.Where("device_id = ?", device.ID).
		Order("timestamp desc").
		Limit(limit).
		Find(&records)

	// Reverse to ascending chronological order for chart display
	for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
		records[i], records[j] = records[j], records[i]
	}

	c.JSON(http.StatusOK, records)
}

// GetDashboardSummary aggregates fleet overview metrics
func GetDashboardSummary(c *gin.Context) {
	if database.DB == nil {
		c.JSON(http.StatusOK, gin.H{
			"total_devices":   5,
			"online_devices":  4,
			"offline_devices": 1,
			"active_tunnels":  0,
			"data_usage_gb":   2.84,
		})
		return
	}

	orgID := c.GetString("organization_id")
	userRole := c.GetString("role")

	var totalDevices, onlineDevices, offlineDevices int64
	devQuery := database.DB.Model(&models.Device{})
	if userRole != "SUPER_ADMIN" && orgID != "" {
		devQuery = devQuery.Where("organization_id = ?", orgID)
	}
	devQuery.Count(&totalDevices)

	onlineQuery := database.DB.Model(&models.Device{}).Where("status = ?", models.DeviceStatusOnline)
	if userRole != "SUPER_ADMIN" && orgID != "" {
		onlineQuery = onlineQuery.Where("organization_id = ?", orgID)
	}
	onlineQuery.Count(&onlineDevices)

	offlineQuery := database.DB.Model(&models.Device{}).Where("status = ?", models.DeviceStatusOffline)
	if userRole != "SUPER_ADMIN" && orgID != "" {
		offlineQuery = offlineQuery.Where("organization_id = ?", orgID)
	}
	offlineQuery.Count(&offlineDevices)

	// Pending / Unclaimed devices
	var pendingDevices int64
	pendingQuery := database.DB.Model(&models.Device{}).Where("status IN ?", []models.DeviceStatus{models.DeviceStatusPending, models.DeviceStatusUnclaimed})
	if userRole != "SUPER_ADMIN" && orgID != "" {
		pendingQuery = pendingQuery.Where("organization_id = ?", orgID)
	}
	pendingQuery.Count(&pendingDevices)

	// Active tunnels
	var activeTunnels int64
	tunQuery := database.DB.Model(&models.TunnelSession{}).Where("status = ?", models.TunnelActive)
	tunQuery.Count(&activeTunnels)

	// Aggregate cumulative network usage from telemetry records
	var dataUsageGB float64 = 0.42
	var totalBytes struct {
		TotalRX uint64 `gorm:"column:total_rx"`
		TotalTX uint64 `gorm:"column:total_tx"`
	}
	if err := database.DB.Model(&models.TelemetryRecord{}).
		Select("COALESCE(SUM(rx_bytes), 0) as total_rx, COALESCE(SUM(tx_bytes), 0) as total_tx").
		Scan(&totalBytes).Error; err == nil {
		computed := float64(totalBytes.TotalRX+totalBytes.TotalTX) / (1024 * 1024 * 1024)
		if computed > 0 {
			dataUsageGB = float64(int(computed*100)) / 100.0
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"total_devices":   totalDevices,
		"online_devices":  onlineDevices,
		"offline_devices": offlineDevices,
		"pending_devices": pendingDevices,
		"active_tunnels":  activeTunnels,
		"data_usage_gb":   dataUsageGB,
	})
}
