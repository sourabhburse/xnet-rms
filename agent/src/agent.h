#ifndef NISEVA_AGENT_H
#define NISEVA_AGENT_H

#include <libubox/uloop.h>
#include <libubus.h>
#include <uci.h>
#include <mosquitto.h>
#include <stdint.h>
#include <stdbool.h>
#include "parson.h"

#define AGENT_VERSION "1.0.0"
#define DEFAULT_SERVER "http://82.180.146.203:8090"
#define DEFAULT_MQTT_HOST "82.180.146.203"
#define DEFAULT_MQTT_PORT 1883
#define DEFAULT_HEARTBEAT_SEC 60
#define DEFAULT_TELEMETRY_SEC 300
#define DEFAULT_ROLLBACK_SEC 180

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
    char mac_address[32];
    char model[64];
    char architecture[32];
    char firmware_version[64];
    char server_url[128];
    char mqtt_host[128];
    int mqtt_port;
    char mqtt_token[128];
    char enrollment_token[128];
    int heartbeat_interval;
    int telemetry_interval;
    int rollback_timeout;
    bool provisioned;
    hardware_capabilities_t caps;
} agent_config_t;

extern agent_config_t g_cfg;
extern struct ubus_context *g_ubus;
extern struct mosquitto *g_mosq;

// Core subsystem declarations
int load_config(void);
int save_config_option(const char *section, const char *option, const char *value);
void detect_board_hardware(void);
int perform_provision_checkin(void);

int init_mqtt(void);
void send_heartbeat(struct uloop_timeout *t);
void collect_and_send_telemetry(struct uloop_timeout *t);

void handle_mqtt_message(const struct mosquitto_message *msg);
void send_command_ack(const char *cmd_id, const char *status, const char *message);
void trigger_reboot(int delay_seconds);

int apply_uci_config_with_watchdog(JSON_Array *commands);
void check_rollback_watchdog(struct uloop_timeout *t);
void cancel_rollback_watchdog(void);

int open_reverse_tunnel(const char *token, const char *target_host, int target_port, const char *protocol, int ttl_seconds);
void close_reverse_tunnel(void);
void handle_sysupgrade(const char *url, const char *sha256);

#endif // NISEVA_AGENT_H
