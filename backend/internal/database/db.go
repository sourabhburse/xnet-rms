package database

import (
	"fmt"
	"log"
	"os"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"niseva-rms/backend/internal/models"
)

var DB *gorm.DB

func InitDB() (*gorm.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://rms_admin:niseva_rms_secret_2026@localhost:5432/niseva_rms?sslmode=disable"
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	log.Println("[DB] Connected to PostgreSQL. Running AutoMigrate...")
	err = db.AutoMigrate(
		&models.Organization{},
		&models.User{},
		&models.DeviceGroup{},
		&models.Device{},
		&models.EnrollmentToken{},
		&models.TelemetryRecord{},
		&models.TunnelSession{},
		&models.ConfigProfile{},
		&models.AuditLog{},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to auto-migrate database: %w", err)
	}

	DB = db
	seedDefaultAdmin(db)

	return db, nil
}

func seedDefaultAdmin(db *gorm.DB) {
	var orgCount int64
	db.Model(&models.Organization{}).Count(&orgCount)
	if orgCount == 0 {
		defaultOrg := models.Organization{
			Name: "Default Organization",
			Slug: "default",
		}
		if err := db.Create(&defaultOrg).Error; err != nil {
			log.Printf("[DB] Error seeding default organization: %v\n", err)
			return
		}

		hash, _ := bcrypt.GenerateFromPassword([]byte("Admin@12345"), bcrypt.DefaultCost)
		adminUser := models.User{
			Email:          "admin@niseva.com",
			PasswordHash:   string(hash),
			FirstName:      "System",
			LastName:       "Admin",
			Role:           models.RoleSuperAdmin,
			OrganizationID: defaultOrg.ID,
		}
		if err := db.Create(&adminUser).Error; err != nil {
			log.Printf("[DB] Error seeding default admin: %v\n", err)
			return
		}

		log.Println("[DB] Seeded default organization and admin: admin@niseva.com / Admin@12345")
	}
}
