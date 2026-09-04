package models

import (
	"time"

	"gorm.io/gorm"
)

type UserRole string

const (
	RoleSuperAdmin UserRole = "SUPER_ADMIN"
	RoleOrgAdmin   UserRole = "ORG_ADMIN"
	RoleOperator   UserRole = "OPERATOR"
	RoleViewer     UserRole = "VIEWER"
)

type DeviceStatus string

const (
	DeviceStatusUnclaimed   DeviceStatus = "UNCLAIMED"
	DeviceStatusPending     DeviceStatus = "PENDING_PROVISION"
	DeviceStatusOnline      DeviceStatus = "ONLINE"
	DeviceStatusOffline     DeviceStatus = "OFFLINE"
	DeviceStatusRebooting   DeviceStatus = "REBOOTING"
	DeviceStatusUpdating    DeviceStatus = "UPDATING_FOTA"
)

type TunnelProtocol string

const (
	ProtocolLuCI     TunnelProtocol = "HTTP_LUCI"
	ProtocolTerminal TunnelProtocol = "TERMINAL_SSH"
	ProtocolSFTP     TunnelProtocol = "SFTP"
	ProtocolTCP      TunnelProtocol = "TCP_FORWARD"
)

type TunnelStatus string

const (
	TunnelPending    TunnelStatus = "PENDING"
	TunnelActive     TunnelStatus = "ACTIVE"
	TunnelExpired    TunnelStatus = "EXPIRED"
	TunnelTerminated TunnelStatus = "TERMINATED"
)

// Organization represents a multi-tenant isolation boundary
type Organization struct {
	ID        string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name      string    `gorm:"not null" json:"name"`
	Slug      string    `gorm:"uniqueIndex;not null" json:"slug"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	Users        []User        `gorm:"foreignKey:OrganizationID;constraint:OnDelete:CASCADE" json:"users,omitempty"`
	Devices      []Device      `gorm:"foreignKey:OrganizationID;constraint:OnDelete:CASCADE" json:"devices,omitempty"`
	DeviceGroups []DeviceGroup `gorm:"foreignKey:OrganizationID;constraint:OnDelete:CASCADE" json:"device_groups,omitempty"`
}

// User represents an administrator or operator
type User struct {
	ID             string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Email          string    `gorm:"uniqueIndex;not null" json:"email"`
	PasswordHash   string    `gorm:"not null" json:"-"`
	FirstName      string    `json:"first_name"`
	LastName       string    `json:"last_name"`
	Role           UserRole  `gorm:"type:varchar(32);default:'OPERATOR'" json:"role"`
	OrganizationID string    `gorm:"type:uuid;index;not null" json:"organization_id"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Device represents a managed or claimable Niseva OpenWrt router
type Device struct {
	ID              string       `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	SerialNumber    string       `gorm:"uniqueIndex;not null" json:"serial_number"`
	MACAddress      string       `gorm:"uniqueIndex;not null" json:"mac_address"`
	Model           string       `gorm:"default:'Niseva 2S'" json:"model"`
	Name            string       `json:"name"`
	IMEI            string       `json:"imei"`
	FirmwareVersion string       `json:"firmware_version"`
	Status          DeviceStatus `gorm:"type:varchar(32);default:'UNCLAIMED';index" json:"status"`
	DeviceSecret    string       `json:"-"` // Factory PIN (used for initial claiming verification)
	TokenHash       string       `json:"-"` // Hashed token for MQTT/API authentication
	LastHeartbeatAt *time.Time   `json:"last_heartbeat_at"`
	LastIP          string       `json:"last_ip"`
	ConfigHash      string       `json:"config_hash"`

	OrganizationID *string      `gorm:"type:uuid;index" json:"organization_id"`
	GroupID        *string      `gorm:"type:uuid;index" json:"group_id"`
	Group          *DeviceGroup `gorm:"foreignKey:GroupID" json:"group,omitempty"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// DeviceGroup groups routers for batch operations and config profiles
type DeviceGroup struct {
	ID              string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name            string    `gorm:"not null" json:"name"`
	Description     string    `json:"description"`
	OrganizationID  string    `gorm:"type:uuid;index;not null" json:"organization_id"`
	ConfigProfileID *string   `gorm:"type:uuid" json:"config_profile_id"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// EnrollmentToken allows mass zero-touch provisioning of batches
type EnrollmentToken struct {
	ID             string     `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Token          string     `gorm:"uniqueIndex;not null" json:"token"`
	Name           string     `json:"name"`
	OrganizationID string     `gorm:"type:uuid;index;not null" json:"organization_id"`
	GroupID        *string    `gorm:"type:uuid" json:"group_id"`
	MaxUses        *int       `json:"max_uses"`
	UsedCount      int        `gorm:"default:0" json:"used_count"`
	ExpiresAt      *time.Time `json:"expires_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

// TelemetryRecord stores historical time-series telemetry per router
type TelemetryRecord struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	DeviceID  string    `gorm:"type:uuid;index:idx_device_time;not null" json:"device_id"`
	Timestamp time.Time `gorm:"index:idx_device_time;not null" json:"timestamp"`

	// Cellular RF Metrics (from ubus call cellular status)
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

	// System health (from ubus call system info)
	UptimeSeconds uint64  `json:"uptime_seconds"`
	CPULoad       float64 `json:"cpu_load"`
	RAMUsedMB     int     `json:"ram_used_mb"`
	RAMTotalMB    int     `json:"ram_total_mb"`
	FlashFreeMB   float64 `json:"flash_free_mb"`

	// Traffic stats (from ubus call network.interface.wan status)
	RXBytes uint64 `json:"rx_bytes"`
	TXBytes uint64 `json:"tx_bytes"`

	// Custom Services (IPsec, Modbus, Custom apps) stored in PostgreSQL JSONB
	Services []byte `gorm:"type:jsonb" json:"services"`
}

// TunnelSession tracks active RMS Connect remote sessions
type TunnelSession struct {
	ID               string         `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	DeviceID         string         `gorm:"type:uuid;index;not null" json:"device_id"`
	UserID           string         `gorm:"type:uuid;index;not null" json:"user_id"`
	Protocol         TunnelProtocol `gorm:"type:varchar(32);not null" json:"protocol"`
	TargetHost       string         `gorm:"default:'127.0.0.1'" json:"target_host"`
	TargetPort       int            `gorm:"default:80" json:"target_port"`
	Token            string         `gorm:"uniqueIndex;not null" json:"token"`
	Status           TunnelStatus   `gorm:"type:varchar(32);default:'PENDING'" json:"status"`
	BytesTransferred uint64         `gorm:"default:0" json:"bytes_transferred"`
	ExpiresAt        time.Time      `json:"expires_at"`
	CreatedAt        time.Time      `json:"created_at"`
}

// ConfigProfile stores reusable UCI configuration templates
type ConfigProfile struct {
	ID             string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name           string    `gorm:"not null" json:"name"`
	Description    string    `json:"description"`
	UCIPayload     []byte    `gorm:"type:jsonb;not null" json:"uci_payload"`
	Version        int       `gorm:"default:1" json:"version"`
	OrganizationID string    `gorm:"type:uuid;index;not null" json:"organization_id"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// AuditLog provides immutable accountability for compliance
type AuditLog struct {
	ID             string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	UserID         *string   `gorm:"type:uuid;index" json:"user_id"`
	OrganizationID string    `gorm:"type:uuid;index;not null" json:"organization_id"`
	Action         string    `gorm:"not null" json:"action"`
	ResourceType   string    `json:"resource_type"`
	ResourceID     string    `json:"resource_id"`
	Details        string    `json:"details"`
	IPAddress      string    `json:"ip_address"`
	CreatedAt      time.Time `json:"created_at"`
}

// Firmware stores sysupgrade images
type Firmware struct {
	ID             string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name           string    `gorm:"not null" json:"name"`
	Version        string    `gorm:"not null" json:"version"`
	HardwareModel  string    `gorm:"not null" json:"hardware_model"` // e.g. "Niseva 2S"
	FileSizeBytes  int64     `json:"file_size_bytes"`
	ChecksumSHA256 string    `gorm:"not null" json:"checksum_sha256"`
	FileURL        string    `gorm:"not null" json:"file_url"`
	ReleaseNotes   string    `json:"release_notes"`
	OrganizationID string    `gorm:"type:uuid;index;not null" json:"organization_id"`
	CreatedAt      time.Time `json:"created_at"`
}

// SoftwarePackage stores custom .ipk packages
type SoftwarePackage struct {
	ID             string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	Name           string    `gorm:"not null" json:"name"`
	Version        string    `gorm:"not null" json:"version"`
	Architecture   string    `gorm:"default:'mips_24kc'" json:"architecture"`
	FileSizeBytes  int64     `json:"file_size_bytes"`
	ChecksumSHA256 string    `json:"checksum_sha256"`
	FileURL        string    `gorm:"not null" json:"file_url"`
	Description    string    `json:"description"`
	OrganizationID string    `gorm:"type:uuid;index;not null" json:"organization_id"`
	CreatedAt      time.Time `json:"created_at"`
}

// DeploymentRollout tracks fleet-wide or canary rollouts
type DeploymentRollout struct {
	ID             string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	OrganizationID string    `gorm:"type:uuid;index;not null" json:"organization_id"`
	Name           string    `gorm:"not null" json:"name"`
	Type           string    `gorm:"type:varchar(32);not null" json:"type"` // "FIRMWARE" | "PACKAGE"
	TargetID       string    `gorm:"type:uuid;not null" json:"target_id"`
	TargetVersion  string    `json:"target_version"`
	Strategy       string    `gorm:"default:'CANARY_THEN_ALL'" json:"strategy"` // "CANARY_THEN_ALL" | "IMMEDIATE"
	Status         string    `gorm:"default:'IN_PROGRESS'" json:"status"`       // "IN_PROGRESS" | "COMPLETED" | "FAILED"
	TotalDevices   int       `gorm:"default:0" json:"total_devices"`
	SuccessCount   int       `gorm:"default:0" json:"success_count"`
	FailureCount   int       `gorm:"default:0" json:"failure_count"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// DeviceDeploymentStatus tracks individual router progress within a rollout
type DeviceDeploymentStatus struct {
	ID              string    `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	RolloutID       string    `gorm:"type:uuid;index;not null" json:"rollout_id"`
	DeviceID        string    `gorm:"type:uuid;index;not null" json:"device_id"`
	Status          string    `gorm:"default:'PENDING'" json:"status"` // "PENDING" | "DOWNLOADING" | "FLASHING" | "SUCCESS" | "FAILED"
	ProgressPercent int       `gorm:"default:0" json:"progress_percent"`
	ErrorMessage    string    `json:"error_message"`
	UpdatedAt       time.Time `json:"updated_at"`
}
