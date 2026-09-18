package rms

import (
	"context"
	"encoding/json"
	"errors"
	mqtt "github.com/eclipse/paho.mqtt.golang"
	"hash/fnv"
	"log"
	"strings"
	"sync"
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
							Status    string `json:"status"`
							RequestID string `json:"request_id"`
						}
						if json.Unmarshal(p.data, &beat) == nil {
							now := time.Now().UTC()
							if beat.Status == "online" {
								minute := uint(now.Minute())
								mask := int64(1) << minute
								s.DB.Exec(`WITH touched AS (
									UPDATE devices SET last_seen=$2 WHERE id=$1 AND NOT revoked RETURNING id
								) INSERT INTO presence_hours(device_id,hour,seen_minutes)
								SELECT id,date_trunc('hour',$2::timestamptz),$3 FROM touched
								ON CONFLICT(device_id,hour) DO UPDATE
								SET seen_minutes=presence_hours.seen_minutes | EXCLUDED.seen_minutes`, id, now, mask)
								// Only after last_seen is committed, so a caller
								// woken by this pong cannot re-read a stale row.
								if beat.RequestID != "" {
									s.deliverPong(id, beat.RequestID)
								}
							} else if beat.Status == "offline" {
								s.DB.Exec(`WITH touched AS (
									UPDATE devices SET last_seen=$2-interval '180 seconds' WHERE id=$1 AND NOT revoked AND last_seen>$2-interval '180 seconds' RETURNING id
								) INSERT INTO presence_hours(device_id,hour,offline_events)
								SELECT id,date_trunc('hour',$2::timestamptz),1 FROM touched
								ON CONFLICT(device_id,hour) DO UPDATE
								SET offline_events=presence_hours.offline_events+1`, id, now)
							}
						}
					case "previews":
						s.acceptMonitoringPreview(id, p.data)
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

// pingTimeout bounds how long a caller waits for a router to answer a liveness
// probe. Three seconds covers a cellular round trip with room to spare while
// staying well inside a browser request.
const pingTimeout = 3 * time.Second

// pingMinAgent is the first agent release that answers a ping. Older routers
// silently ignore the unknown command, so probing them only burns pingTimeout.
const pingMinAgent = "2.4.0"

type pingWaiter struct {
	device string
	done   chan struct{}
	once   sync.Once
}

// resolve wakes every caller joined to this probe. It closes rather than sends
// so late and duplicate pongs are harmless, and never blocks the MQTT worker.
func (w *pingWaiter) resolve() { w.once.Do(func() { close(w.done) }) }

// deliverPong wakes the callers waiting on requestID. The device is checked so
// a pong cannot be attributed to a probe of a different router.
func (s *Core) deliverPong(device, requestID string) {
	v, ok := s.pings.Load(requestID)
	if !ok {
		return
	}
	if waiter, ok := v.(*pingWaiter); ok && waiter.device == device {
		waiter.resolve()
	}
}

// PingDevice asks a router to prove it is reachable right now, returning true
// only if it answered within pingTimeout.
//
// A false result means "could not confirm", never "offline": an agent older
// than pingMinAgent never answers, the broker may be down, and a router on a
// slow link may answer after pingTimeout. Callers must fall back to the stored
// last_seen verdict rather than treating false as proof the router is gone.
//
// The router answers on its ordinary heartbeat topic, so a successful probe
// also refreshes devices.last_seen through the handler above, and the pong is
// only delivered once that write has committed.
//
// Concurrent probes of one device are coalesced onto a single command. Without
// that, a held-down refresh button or a handful of operators on the same page
// would each publish to the router and each pin a goroutine for pingTimeout.
func (s *Core) PingDevice(device, agentVersion string) bool {
	if s.Publish == nil || !validID(device) || !versionAtLeast(agentVersion, pingMinAgent) {
		return false
	}
	waiter := &pingWaiter{device: device, done: make(chan struct{})}
	timer := time.NewTimer(pingTimeout)
	defer timer.Stop()
	if existing, inflight := s.pingInflight.LoadOrStore(device, waiter); inflight {
		joined, ok := existing.(*pingWaiter)
		if !ok {
			return false
		}
		select {
		case <-joined.done:
			return true
		case <-timer.C:
			return false
		}
	}
	defer s.pingInflight.Delete(device)
	requestID := randomID()
	s.pings.Store(requestID, waiter)
	defer s.pings.Delete(requestID)
	if s.Publish("rms/v1/devices/"+device+"/commands", map[string]any{"action": "ping", "request_id": requestID}) != nil {
		return false
	}
	select {
	case <-waiter.done:
		return true
	case <-timer.C:
		return false
	}
}
