package mqtt

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"

	"niseva-rms/backend/internal/database"
	"niseva-rms/backend/internal/models"
	"niseva-rms/backend/internal/telemetry"
)

var Client paho.Client

func InitMQTT() error {
	brokerURL := os.Getenv("MQTT_BROKER")
	if brokerURL == "" {
		brokerURL = "tcp://localhost:1883"
	}
	user := os.Getenv("MQTT_USER")
	password := os.Getenv("MQTT_PASSWORD")

	opts := paho.NewClientOptions().
		AddBroker(brokerURL).
		SetClientID("niseva-backend-service").
		SetAutoReconnect(true).
		SetKeepAlive(30 * time.Second)

	if user != "" {
		opts.SetUsername(user)
		opts.SetPassword(password)
	}

	opts.SetOnConnectHandler(func(c paho.Client) {
		log.Println("[MQTT] Connected to Mosquitto broker. Subscribing to device topics...")

		// Subscribe to all heartbeats (including LWT)
		c.Subscribe("niseva/device/+/heartbeat", 1, handleHeartbeat)

		// Subscribe to all telemetry updates
		c.Subscribe("niseva/device/+/telemetry", 0, handleTelemetry)

		// Subscribe to command acknowledgments
		c.Subscribe("niseva/device/+/cmd/+/ack", 1, handleCommandAck)
	})

	opts.SetConnectionLostHandler(func(c paho.Client, err error) {
		log.Printf("[MQTT] Connection lost: %v. Reconnecting...\n", err)
	})

	client := paho.NewClient(opts)
	if token := client.Connect(); token.Wait() && token.Error() != nil {
		return fmt.Errorf("MQTT connection error: %w", token.Error())
	}

	Client = client
	return nil
}

func handleHeartbeat(client paho.Client, msg paho.Message) {
	// Topic: niseva/device/{serial}/heartbeat
	parts := strings.Split(msg.Topic(), "/")
	if len(parts) < 4 {
		return
	}
	serial := parts[2]

	var payload struct {
		Status string `json:"status"`
		Uptime uint64 `json:"uptime"`
	}
	if err := json.Unmarshal(msg.Payload(), &payload); err != nil {
		return
	}

	now := time.Now()
	newStatus := models.DeviceStatusOnline
	if strings.ToUpper(payload.Status) == "OFFLINE" {
		newStatus = models.DeviceStatusOffline
	}

	log.Printf("[MQTT] Received heartbeat from %s: %s (uptime %ds)", serial, payload.Status, payload.Uptime)
	if database.DB != nil {
		database.DB.Model(&models.Device{}).
			Where("serial_number = ?", serial).
			Updates(map[string]interface{}{
				"status":            newStatus,
				"last_heartbeat_at": now,
			})
	}
}

func handleTelemetry(client paho.Client, msg paho.Message) {
	if err := telemetry.IngestTelemetryRecord(msg.Payload()); err != nil {
		log.Printf("[MQTT] Error ingesting telemetry: %v\n", err)
	}
}

func handleCommandAck(client paho.Client, msg paho.Message) {
	log.Printf("[MQTT] Received command ACK on topic %s: %s\n", msg.Topic(), string(msg.Payload()))
}

// DispatchCommand sends an RPC instruction to a target router
func DispatchCommand(serial, action string, payload interface{}) error {
	if Client == nil || !Client.IsConnected() {
		return fmt.Errorf("MQTT client not connected")
	}

	cmdID := fmt.Sprintf("cmd_%d", time.Now().UnixNano())
	topic := fmt.Sprintf("niseva/device/%s/cmd/%s", serial, cmdID)

	data, err := json.Marshal(map[string]interface{}{
		"action":     action,
		"command_id": cmdID,
		"payload":    payload,
	})
	if err != nil {
		return err
	}

	token := Client.Publish(topic, 1, false, data)
	token.Wait()
	return token.Error()
}
