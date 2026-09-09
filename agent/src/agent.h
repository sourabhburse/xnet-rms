#ifndef NISEVA_AGENT_H
#define NISEVA_AGENT_H

#include <libubox/uloop.h>
#include <libubus.h>
#include <uci.h>
#include <mosquitto.h>
#include <stdint.h>
#include <stdbool.h>
#include <time.h>
#include "parson.h"

#define AGENT_VERSION "2.1.2"
#define DEFAULT_SERVER ""
#define DEFAULT_MQTT_HOST ""
#define DEFAULT_MQTT_PORT 8883
#define DEFAULT_HEARTBEAT_SEC 60
#define DEFAULT_TELEMETRY_SEC 60
#define DEFAULT_ROLLBACK_SEC 180

#define RMS_PKI_DIR "/etc/xnet-rms"
#define RMS_CLIENT_KEY "/etc/xnet-rms/client.key"
#define RMS_CLIENT_CRT "/etc/xnet-rms/client.crt"
#define RMS_CA_CRT "/etc/xnet-rms/ca.crt"
#define MAX_TELEMETRY_BACKLOG_BYTES (2 * 1024 * 1024)

typedef struct {
    int sim_slots;
    bool has_gps;
    bool has_rs485;
    bool has_wifi_5g;
    int ethernet_ports;
    bool is_5g;
} hardware_capabilities_t;

typedef struct {
    char serial[64];
    char device_id[64];
    char mac_address[32];
    char model[64];
    char architecture[32];
    char firmware_version[64];
    char server_url[128];
    char mqtt_host[128];
    int mqtt_port;
    char mode[16];
    char organization[129];
    unsigned retry_initial, retry_initial_period, retry_regular, retry_standby, standby_after;

    char mqtt_token[128];
    char enrollment_token[257];
    char boot_id[64];
    int heartbeat_interval;
    int telemetry_interval;
    int rollback_timeout;
    bool provisioned;
    hardware_capabilities_t caps;
} agent_config_t;

extern agent_config_t g_cfg;
extern struct ubus_context *g_ubus;
extern struct mosquitto *g_mosq;

// Configuration & Hardware
int load_config(void);
int save_config_option(const char *section, const char *option, const char *value);
int save_provisioned_config(const char *device_id, const char *mqtt_host, const char *mqtt_port, const char *organization);
void detect_board_hardware(void);

// PKI Lifecycle & Provisioning
int generate_ec_p256_key_if_missing(void);
char *generate_csr_pem(void);
int perform_provision_checkin(void);
int perform_challenge_recovery(void);
char *sign_challenge_message(const char *message);

// MQTT & Telemetry
int init_mqtt(void);
void send_heartbeat(struct uloop_timeout *t);
void collect_and_send_telemetry(struct uloop_timeout *t);
void handle_telemetry_ack(const char *payload);

// Bounded Telemetry Buffer Queue (2 MiB)
void telemetry_queue_init(void);
int telemetry_queue_push(const char *topic, const char *payload, size_t len, const char *boot_id, const char *source_id, int64_t seq);
void telemetry_queue_ack(const char *boot_id, const char *source_id, int64_t seq);
void telemetry_queue_flush_pending(void);
int64_t telemetry_get_dropped_count(void);
int64_t telemetry_get_next_sequence(void);

// Commands & Rollback
void handle_mqtt_message(const struct mosquitto_message *msg);
void send_command_ack(const char *cmd_id, const char *status, const char *message);
void trigger_reboot(int delay_seconds);
int apply_uci_config_with_watchdog(JSON_Array *commands);
void check_rollback_watchdog(struct uloop_timeout *t);
void cancel_rollback_watchdog(void);
void handle_sysupgrade(const char *url, const char *sha256);

// Remote Access Tunnel (LuCI SSO & Dropbear SSH Bridge)
int open_reverse_tunnel(const char *session_id, const char *protocol, const char *gateway_url, int ttl_seconds, const char *public_key);
void check_reverse_tunnel(void);
void close_reverse_tunnel(void);
int close_reverse_tunnel_session(const char *session_id);
int rms_ssh_inject_key(const char *session_id, const char *pubkey);
void rms_ssh_cleanup_key(void);

#endif // NISEVA_AGENT_H
