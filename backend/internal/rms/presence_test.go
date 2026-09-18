package rms

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"
)

const testPingDevice = "4f039a3e5d91c928936204d11cd3fcca"

// captureProbe records the command a probe publishes and optionally answers it
// inline. Answering synchronously is safe because PingDevice registers its
// waiter before publishing and the waiter channel is buffered.
func captureProbe(s *Core, answerAs string) *string {
	var seen string
	s.Publish = func(topic string, v any) error {
		b, _ := json.Marshal(v)
		var cmd struct {
			Action    string `json:"action"`
			RequestID string `json:"request_id"`
		}
		json.Unmarshal(b, &cmd)
		seen = cmd.RequestID
		if answerAs != "" {
			s.deliverPong(answerAs, cmd.RequestID)
		}
		return nil
	}
	return &seen
}

func TestPingDeviceAnsweredProbeSucceeds(t *testing.T) {
	s := &Core{}
	captureProbe(s, testPingDevice)
	if !s.PingDevice(testPingDevice) {
		t.Fatal("expected an answered probe to report the router reachable")
	}
}

// A pong must not be attributed to a probe of a different router, otherwise one
// chatty device could vouch for a silent one.
func TestPingDeviceIgnoresPongFromOtherDevice(t *testing.T) {
	s := &Core{}
	other := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	var waiter *pingWaiter
	s.Publish = func(topic string, v any) error {
		b, _ := json.Marshal(v)
		var cmd struct {
			RequestID string `json:"request_id"`
		}
		json.Unmarshal(b, &cmd)
		s.deliverPong(other, cmd.RequestID)
		if v, ok := s.pings.Load(cmd.RequestID); ok {
			waiter = v.(*pingWaiter)
		}
		return errors.New("stop here rather than waiting out pingTimeout")
	}
	if s.PingDevice(testPingDevice) {
		t.Fatal("expected a pong from another device to be ignored")
	}
	if waiter == nil {
		t.Fatal("expected the waiter to have been registered")
	}
	select {
	case <-waiter.done:
		t.Fatal("expected the mismatched pong not to have woken the waiter")
	default:
	}
}

func TestPingDeviceRejectsMalformedDeviceAndMissingBroker(t *testing.T) {
	s := &Core{}
	captureProbe(s, "")
	for _, bad := range []string{"", "not-an-id", testPingDevice + "extra"} {
		if s.PingDevice(bad) {
			t.Fatalf("expected device id %q to be rejected", bad)
		}
	}
	offline := &Core{}
	if offline.PingDevice(testPingDevice) {
		t.Fatal("expected a probe to fail when MQTT is unavailable")
	}
}

// The registry must not retain a waiter once its caller has returned, or a
// long-lived process would leak one entry per probe.
func TestPingDeviceCleansUpWaiter(t *testing.T) {
	s := &Core{}
	seen := captureProbe(s, testPingDevice)
	s.PingDevice(testPingDevice)
	if *seen == "" {
		t.Fatal("expected the probe to carry a request id")
	}
	if _, ok := s.pings.Load(*seen); ok {
		t.Fatal("expected the waiter to be removed after the probe returned")
	}
	count := 0
	s.pings.Range(func(_, _ any) bool { count++; return true })
	if count != 0 {
		t.Fatalf("expected an empty ping registry, found %d entries", count)
	}
}

// A late pong, arriving after the caller gave up, must be dropped rather than
// block the MQTT worker that delivers it.
func TestDeliverPongAfterGiveUpDoesNotBlock(t *testing.T) {
	s := &Core{}
	done := make(chan struct{})
	go func() {
		s.deliverPong(testPingDevice, "1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a")
		close(done)
	}()
	<-done
}

// A probe arriving while another is already in flight for the same router must
// join it rather than publish a second command, so a held-down refresh button
// cannot amplify into a burst of MQTT traffic at the device.
func TestPingDeviceJoinsInflightProbeInsteadOfPublishing(t *testing.T) {
	s := &Core{}
	published := 0
	s.Publish = func(topic string, v any) error {
		published++
		return nil
	}
	// Stand in for a probe that is in flight and has just been answered, so the
	// joining caller resolves immediately and the test needs no timing.
	leader := &pingWaiter{device: testPingDevice, done: make(chan struct{})}
	leader.resolve()
	s.pingInflight.Store(testPingDevice, leader)

	if !s.PingDevice(testPingDevice) {
		t.Fatal("expected the joining caller to observe the in-flight probe's pong")
	}
	if published != 0 {
		t.Fatalf("expected a joined probe to publish nothing, got %d commands", published)
	}
}

// Exercises the real concurrent path under -race. The exact command count is
// not asserted: callers that arrive after an earlier probe has already
// completed legitimately start a new one.
func TestPingDeviceConcurrentProbesAreRaceFree(t *testing.T) {
	s := &Core{}
	var mu sync.Mutex
	published := 0
	s.Publish = func(topic string, v any) error {
		mu.Lock()
		published++
		mu.Unlock()
		b, _ := json.Marshal(v)
		var cmd struct {
			RequestID string `json:"request_id"`
		}
		json.Unmarshal(b, &cmd)
		s.deliverPong(testPingDevice, cmd.RequestID)
		return nil
	}
	const callers = 16
	results := make(chan bool, callers)
	for i := 0; i < callers; i++ {
		go func() { results <- s.PingDevice(testPingDevice) }()
	}
	for i := 0; i < callers; i++ {
		if !<-results {
			t.Fatal("expected every caller to observe a pong")
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if published < 1 || published > callers {
		t.Fatalf("expected between 1 and %d commands, got %d", callers, published)
	}
	if _, stuck := s.pingInflight.Load(testPingDevice); stuck {
		t.Fatal("expected no in-flight entry to survive")
	}
}

// The in-flight entry must be released once a probe finishes, or a device could
// only ever be probed once.
func TestPingDeviceReleasesInflightEntry(t *testing.T) {
	s := &Core{}
	captureProbe(s, testPingDevice)
	if !s.PingDevice(testPingDevice) {
		t.Fatal("expected the first probe to succeed")
	}
	if _, stuck := s.pingInflight.Load(testPingDevice); stuck {
		t.Fatal("expected the in-flight entry to be released")
	}
	if !s.PingDevice(testPingDevice) {
		t.Fatal("expected a second probe to succeed after the first released")
	}
}
