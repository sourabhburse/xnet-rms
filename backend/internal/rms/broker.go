package rms

import (
	"context"
	"encoding/json"
	"errors"
	mqtt "github.com/eclipse/paho.mqtt.golang"
	"hash/fnv"
	"log"
	"strings"
	"time"
)

func (s *Core) StartMQTT(ctx context.Context) (mqtt.Client, error) {
	tlsConfig, e := TLSConfig(s.Config.PKIDir, "rms-core", false)
	if e != nil {
		return nil, e
	}
	if !strings.HasPrefix(s.Config.MQTTURL, "ssl://") {
		return nil, errors.New("RMS_MQTT_URL must use ssl://")
	}
	type packet struct {
		topic string
		data  []byte
	}
	queues := make([]chan packet, 8)
	for i := range queues {
		queues[i] = make(chan packet, 128)
		go func(q chan packet) {
			for {
				select {
				case <-ctx.Done():
					return
				case p := <-q:
					parts := strings.Split(p.topic, "/")
					if len(parts) != 5 || !validID(parts[3]) {
						continue
					}
					id := parts[3]
					switch parts[4] {
					case "snapshots":
						if e := s.Ingest(id, p.data, time.Now().UTC()); e != nil {
							log.Printf("snapshot rejected device=%s: %v", id, e)
						}
					case "heartbeat":
						var beat struct {
							Status string `json:"status"`
						}
						if json.Unmarshal(p.data, &beat) == nil {
							if beat.Status == "online" {
								s.DB.Exec("UPDATE devices SET last_seen=now() WHERE id=$1 AND NOT revoked", id)
							} else if beat.Status == "offline" {
								s.DB.Exec("UPDATE devices SET last_seen=now()-interval '180 seconds' WHERE id=$1 AND NOT revoked", id)
							}
						}
					}
				}
			}
		}(queues[i])
	}
	opts := mqtt.NewClientOptions().AddBroker(s.Config.MQTTURL).SetClientID("rms-core").SetTLSConfig(tlsConfig).SetAutoReconnect(true).SetConnectRetry(true).SetConnectRetryInterval(5 * time.Second).SetConnectTimeout(10 * time.Second).SetWriteTimeout(5 * time.Second)
	opts.SetOnConnectHandler(func(c mqtt.Client) {
		c.Subscribe("rms/v1/devices/+/+", 1, func(_ mqtt.Client, m mqtt.Message) {
			if len(m.Payload()) > MaxSnapshot {
				return
			}
			parts := strings.Split(m.Topic(), "/")
			if len(parts) != 5 {
				return
			}
			h := fnv.New32a()
			h.Write([]byte(parts[3]))
			p := packet{m.Topic(), append([]byte(nil), m.Payload()...)}
			select {
			case queues[int(h.Sum32())%len(queues)] <- p:
			default: /* No application ack: router retains and retries. */
			}
		})
	})
	c := mqtt.NewClient(opts)
	s.Publish = func(topic string, v any) error {
		if !c.IsConnected() {
			return errors.New("MQTT unavailable")
		}
		t := c.Publish(topic, 1, false, []byte(raw(v)))
		if !t.WaitTimeout(5 * time.Second) {
			return errors.New("MQTT publish timeout")
		}
		return t.Error()
	}
	c.Connect()
	go func() { <-ctx.Done(); c.Disconnect(500) }()
	return c, nil
}
