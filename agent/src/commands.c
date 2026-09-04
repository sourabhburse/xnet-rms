#include "agent.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/statvfs.h>
#include "parson.h"

void send_command_ack(const char *cmd_id, const char *status, const char *message) {
    if (!g_mosq || !cmd_id) return;

    char topic[128];
    snprintf(topic, sizeof(topic), "niseva/device/%s/cmd/%s/ack", g_cfg.serial, cmd_id);

    char payload[256];
    snprintf(payload, sizeof(payload),
        "{\"command_id\":\"%s\",\"status\":\"%s\",\"message\":\"%s\",\"timestamp\":%ld}",
        cmd_id, status, message ? message : "", (long)time(NULL)
    );

    mosquitto_publish(g_mosq, NULL, topic, strlen(payload), payload, 1, false);
}

void trigger_reboot(int delay_seconds) {
    printf("[CMD] Rebooting router in %d seconds...\n", delay_seconds);
    sleep(delay_seconds);
    if (g_ubus) {
        uint32_t id;
        if (ubus_lookup_id(g_ubus, "system", &id) == UBUS_STATUS_OK) {
            ubus_invoke(g_ubus, id, "reboot", NULL, NULL, NULL, 1000);
            return;
        }
    }
    system("reboot");
}

void handle_sysupgrade(const char *url, const char *sha256) {
    if (!url || strlen(url) == 0) return;

    printf("[FOTA] Starting firmware sysupgrade from %s...\n", url);

    // Pre-flight check: Ensure /tmp has at least 8MB free RAM
    struct statvfs st;
    if (statvfs("/tmp", &st) == 0) {
        double free_mb = (double)(st.f_bavail * st.f_frsize) / (1024.0 * 1024.0);
        if (free_mb < 8.0) {
            fprintf(stderr, "[FOTA] Insufficient RAM in /tmp (%.1f MB free, need 8 MB). Aborting.\n", free_mb);
            return;
        }
    }

    // Download firmware image into /tmp/sysupgrade.bin
    char dl_cmd[512];
    snprintf(dl_cmd, sizeof(dl_cmd), "uclient-fetch -q -O /tmp/sysupgrade.bin %s", url);
    if (system(dl_cmd) != 0) {
        fprintf(stderr, "[FOTA] Failed to download firmware image\n");
        return;
    }

    // Verify SHA256 if provided
    if (sha256 && strlen(sha256) == 64) {
        char verify_cmd[256];
        snprintf(verify_cmd, sizeof(verify_cmd), "echo '%s  /tmp/sysupgrade.bin' | sha256sum -c -s", sha256);
        if (system(verify_cmd) != 0) {
            fprintf(stderr, "[FOTA] SHA256 checksum mismatch! Image corrupt. Deleting.\n");
            system("rm -f /tmp/sysupgrade.bin");
            return;
        }
    }

    printf("[FOTA] Image verified. Executing /sbin/sysupgrade -v /tmp/sysupgrade.bin...\n");
    system("/sbin/sysupgrade -v /tmp/sysupgrade.bin");
}

void handle_mqtt_message(const struct mosquitto_message *msg) {
    if (!msg->payload || msg->payloadlen == 0) return;

    printf("[CMD] Received command on topic: %s\n", msg->topic);

    JSON_Value *root = json_parse_string((const char *)msg->payload);
    if (!root) {
        fprintf(stderr, "[CMD] Failed to parse JSON command payload\n");
        return;
    }

    JSON_Object *cmd = json_value_get_object(root);
    if (!cmd) {
        json_value_free(root);
        return;
    }

    const char *action = json_object_get_string(cmd, "action");
    const char *cmd_id = json_object_get_string(cmd, "command_id");
    if (!action) {
        json_value_free(root);
        return;
    }

    // 1. Reboot Action
    if (strcmp(action, "reboot") == 0) {
        int delay = 3;
        JSON_Object *payload = json_object_get_object(cmd, "payload");
        if (payload && json_object_has_value_of_type(payload, "delay_seconds", JSONNumber)) {
            delay = (int)json_object_get_number(payload, "delay_seconds");
        }
        send_command_ack(cmd_id, "SUCCESS", "Router reboot scheduled");
        json_value_free(root);
        trigger_reboot(delay);
        return;
    }

    // 2. Config Push Action (with 180s watchdog)
    if (strcmp(action, "config_push") == 0) {
        JSON_Object *payload = json_object_get_object(cmd, "payload");
        if (payload) {
            JSON_Array *commands = json_object_get_array(payload, "uci_commands");
            if (commands) {
                apply_uci_config_with_watchdog(commands);
                send_command_ack(cmd_id, "SUCCESS", "UCI configuration applied with 180s watchdog");
            }
        }
        json_value_free(root);
        return;
    }

    // 3. Open Reverse Tunnel Action (RMS Connect)
    if (strcmp(action, "open_tunnel") == 0) {
        JSON_Object *payload = json_object_get_object(cmd, "payload");
        const char *token = NULL;
        const char *target_host = "127.0.0.1";
        int target_port = 80;
        const char *protocol = "HTTP_LUCI";
        int ttl_seconds = 1800;

        if (payload) {
            token = json_object_get_string(payload, "token");
            const char *h = json_object_get_string(payload, "target_host");
            if (h) target_host = h;
            if (json_object_has_value_of_type(payload, "target_port", JSONNumber)) {
                target_port = (int)json_object_get_number(payload, "target_port");
            }
            const char *p = json_object_get_string(payload, "protocol");
            if (p) protocol = p;
            if (json_object_has_value_of_type(payload, "ttl_seconds", JSONNumber)) {
                ttl_seconds = (int)json_object_get_number(payload, "ttl_seconds");
            }
        }

        if (token) {
            open_reverse_tunnel(token, target_host, target_port, protocol, ttl_seconds);
            send_command_ack(cmd_id, "SUCCESS", "On-demand reverse tunnel initiated");
        }
        json_value_free(root);
        return;
    }

    // 4. Close Reverse Tunnel Action (Killswitch / Operator Terminate)
    if (strcmp(action, "close_tunnel") == 0) {
        close_reverse_tunnel();
        send_command_ack(cmd_id, "SUCCESS", "Reverse tunnel closed on router");
        json_value_free(root);
        return;
    }

    // 5. Firmware FOTA Sysupgrade Action
    if (strcmp(action, "sysupgrade") == 0) {
        JSON_Object *payload = json_object_get_object(cmd, "payload");
        if (payload) {
            const char *url = json_object_get_string(payload, "url");
            const char *sha256 = json_object_get_string(payload, "sha256");
            send_command_ack(cmd_id, "PROCESSING", "Downloading firmware sysupgrade image");
            handle_sysupgrade(url, sha256);
        }
        json_value_free(root);
        return;
    }

    json_value_free(root);
}
