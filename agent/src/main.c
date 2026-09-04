#include "agent.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>

agent_config_t g_cfg = {0};
struct ubus_context *g_ubus = NULL;
struct mosquitto *g_mosq = NULL;

static struct uloop_timeout heartbeat_timer;
static struct uloop_timeout telemetry_timer;
static struct uloop_timeout checkin_retry_timer;

static void on_signal(int sig) {
    (void)sig;
    uloop_end();
}

static void on_mqtt_connect(struct mosquitto *mosq, void *obj, int rc) {
    (void)obj;
    if (rc == 0) {
        printf("[MQTT] Connected successfully to broker.\n");
        char cmd_topic[128];
        snprintf(cmd_topic, sizeof(cmd_topic), "niseva/device/%s/cmd/#", g_cfg.serial);
        mosquitto_subscribe(mosq, NULL, cmd_topic, 1);

        // Cancel watchdog if we just reconnected after a config change
        cancel_rollback_watchdog();

        // Send immediate heartbeat on connect
        send_heartbeat(&heartbeat_timer);
    } else {
        fprintf(stderr, "[MQTT] Connect failed with code %d\n", rc);
    }
}

static void on_mqtt_message(struct mosquitto *mosq, void *obj, const struct mosquitto_message *msg) {
    (void)mosq;
    (void)obj;
    handle_mqtt_message(msg);
}

int init_mqtt(void) {
    if (!g_cfg.provisioned || strlen(g_cfg.mqtt_token) == 0) {
        printf("[MQTT] Skipping MQTT init (device not yet provisioned)\n");
        return -1;
    }

    mosquitto_lib_init();

    char client_id[64];
    snprintf(client_id, sizeof(client_id), "NSV-%s", g_cfg.serial);

    g_mosq = mosquitto_new(client_id, true, NULL);
    if (!g_mosq) {
        fprintf(stderr, "[ERROR] Failed to allocate Mosquitto instance\n");
        return -1;
    }

    // Set credentials
    char username[64];
    snprintf(username, sizeof(username), "device-%s", g_cfg.serial);
    mosquitto_username_pw_set(g_mosq, username, g_cfg.mqtt_token);

    // Set Last Will and Testament (LWT) for instant offline detection
    char lwt_topic[128];
    snprintf(lwt_topic, sizeof(lwt_topic), "niseva/device/%s/heartbeat", g_cfg.serial);
    const char *lwt_payload = "{\"status\": \"OFFLINE\"}";
    mosquitto_will_set(g_mosq, lwt_topic, strlen(lwt_payload), lwt_payload, 1, false);

    // Callbacks
    mosquitto_connect_callback_set(g_mosq, on_mqtt_connect);
    mosquitto_message_callback_set(g_mosq, on_mqtt_message);

    // TLS Encryption for Port 8883 (MQTTS)
    if (g_cfg.mqtt_port == 8883) {
        const char *ca_file = "/etc/ssl/certs/ca-certificates.crt";
        const char *ca_dir = "/etc/ssl/certs";
        if (access(ca_file, F_OK) == 0) {
            mosquitto_tls_set(g_mosq, ca_file, NULL, NULL, NULL, NULL);
        } else if (access(ca_dir, F_OK) == 0) {
            mosquitto_tls_set(g_mosq, NULL, ca_dir, NULL, NULL, NULL);
        }
        mosquitto_tls_insecure_set(g_mosq, false);
    }

    // Connect asynchronously
    int rc = mosquitto_connect_async(g_mosq, g_cfg.mqtt_host, g_cfg.mqtt_port, 30);
    if (rc != MOSQ_ERR_SUCCESS) {
        fprintf(stderr, "[MQTT] Unable to connect to %s:%d: %s\n",
                g_cfg.mqtt_host, g_cfg.mqtt_port, mosquitto_strerror(rc));
        return -1;
    }

    mosquitto_loop_start(g_mosq);
    return 0;
}

static void checkin_retry_cb(struct uloop_timeout *t) {
    if (!g_cfg.provisioned) {
        if (perform_provision_checkin() == 0) {
            // Succeeded! Start MQTT and regular timers
            init_mqtt();
            uloop_timeout_set(&heartbeat_timer, 1000);
            uloop_timeout_set(&telemetry_timer, 5000);
            return;
        }
        // Retry in 30 seconds
        uloop_timeout_set(t, 30 * 1000);
    }
}

int load_config(void) {
    struct uci_context *ctx = uci_alloc_context();
    if (!ctx) return -1;

    struct uci_package *pkg = NULL;
    if (uci_load(ctx, "niseva", &pkg) != UCI_OK) {
        uci_free_context(ctx);
        return -1;
    }

    struct uci_section *sec = uci_lookup_section(ctx, pkg, "general");
    if (sec) {
        const char *serial = uci_lookup_option_string(ctx, sec, "serial_number");
        const char *token = uci_lookup_option_string(ctx, sec, "mqtt_token");
        const char *host = uci_lookup_option_string(ctx, sec, "mqtt_host");
        const char *port = uci_lookup_option_string(ctx, sec, "mqtt_port");
        const char *server = uci_lookup_option_string(ctx, sec, "server_url");
        const char *enroll = uci_lookup_option_string(ctx, sec, "enrollment_token");
        const char *hb = uci_lookup_option_string(ctx, sec, "heartbeat_interval");
        const char *tel = uci_lookup_option_string(ctx, sec, "telemetry_interval");

        if (serial && strlen(serial) > 0) strncpy(g_cfg.serial, serial, sizeof(g_cfg.serial) - 1);
        if (token && strlen(token) > 0) strncpy(g_cfg.mqtt_token, token, sizeof(g_cfg.mqtt_token) - 1);
        if (host && strlen(host) > 0) strncpy(g_cfg.mqtt_host, host, sizeof(g_cfg.mqtt_host) - 1);
        if (server && strlen(server) > 0) strncpy(g_cfg.server_url, server, sizeof(g_cfg.server_url) - 1);
        if (enroll && strlen(enroll) > 0) strncpy(g_cfg.enrollment_token, enroll, sizeof(g_cfg.enrollment_token) - 1);

        g_cfg.mqtt_port = port ? atoi(port) : DEFAULT_MQTT_PORT;
        g_cfg.heartbeat_interval = hb ? atoi(hb) : DEFAULT_HEARTBEAT_SEC;
        g_cfg.telemetry_interval = tel ? atoi(tel) : DEFAULT_TELEMETRY_SEC;
        g_cfg.rollback_timeout = DEFAULT_ROLLBACK_SEC;
        g_cfg.provisioned = (strlen(g_cfg.mqtt_token) > 0);
    }

    uci_free_context(ctx);

    if (strlen(g_cfg.server_url) == 0) {
        strncpy(g_cfg.server_url, DEFAULT_SERVER, sizeof(g_cfg.server_url) - 1);
    }
    if (strlen(g_cfg.mqtt_host) == 0) {
        strncpy(g_cfg.mqtt_host, DEFAULT_MQTT_HOST, sizeof(g_cfg.mqtt_host) - 1);
    }

    return 0;
}

int save_config_option(const char *section, const char *option, const char *value) {
    struct uci_context *ctx = uci_alloc_context();
    if (!ctx) return -1;

    struct uci_ptr ptr = {
        .package = "niseva",
        .section = section,
        .option = option,
        .value = value,
    };

    if (uci_set(ctx, &ptr) == UCI_OK) {
        uci_commit(ctx, &ptr.p, false);
    }

    uci_free_context(ctx);
    return 0;
}

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);

    printf("===================================================\n");
    printf(" Niseva Cloud RMS Router Agent v%s (OpenWrt)\n", AGENT_VERSION);
    printf("===================================================\n");

    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);

    uloop_init();

    // 1. Connect to OpenWrt ubus
    g_ubus = ubus_connect(NULL);
    if (!g_ubus) {
        fprintf(stderr, "[WARN] Failed to connect to OpenWrt ubus (will retry dynamically)\n");
    }

    // 2. Detect board info and load UCI config
    detect_board_hardware();
    load_config();

    printf("[CONFIG] Serial: %s | Server: %s | Host: %s:%d | Provisioned: %s\n",
           g_cfg.serial, g_cfg.server_url, g_cfg.mqtt_host, g_cfg.mqtt_port,
           g_cfg.provisioned ? "YES" : "NO (Awaiting Claim/Bootstrap)");

    heartbeat_timer.cb = send_heartbeat;
    telemetry_timer.cb = collect_and_send_telemetry;
    checkin_retry_timer.cb = checkin_retry_cb;

    // 3. Bootstrap check-in or start MQTT directly
    if (!g_cfg.provisioned) {
        if (perform_provision_checkin() == 0) {
            init_mqtt();
            uloop_timeout_set(&heartbeat_timer, 1000);
            uloop_timeout_set(&telemetry_timer, 5000);
        } else {
            // Schedule periodic 30-second check-in retry
            uloop_timeout_set(&checkin_retry_timer, 30 * 1000);
        }
    } else {
        init_mqtt();
        uloop_timeout_set(&heartbeat_timer, 1000);
        uloop_timeout_set(&telemetry_timer, 5000);
    }

    // 4. Single-threaded non-blocking event loop
    uloop_run();

    // 5. Cleanup
    uloop_done();
    if (g_mosq) {
        mosquitto_loop_stop(g_mosq, true);
        mosquitto_destroy(g_mosq);
    }
    mosquitto_lib_cleanup();
    if (g_ubus) {
        ubus_free(g_ubus);
    }

    printf("[EXIT] Niseva agent terminated gracefully.\n");
    return 0;
}
