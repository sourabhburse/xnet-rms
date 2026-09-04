#include "agent.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <syslog.h>
#include "parson.h"

void detect_board_hardware(void) {
    // 1. Try reading /var/xnet_board_info.json (Standard XNET board metadata)
    JSON_Value *val = json_parse_file("/var/xnet_board_info.json");
    if (val) {
        JSON_Object *obj = json_value_get_object(val);
        if (obj) {
            const char *s = json_object_get_string(obj, "serial_number");
            const char *m = json_object_get_string(obj, "mac_address");
            const char *mod = json_object_get_string(obj, "model");
            const char *fw = json_object_get_string(obj, "firmware_version");

            if (s && strlen(s) > 0) strncpy(g_cfg.serial, s, sizeof(g_cfg.serial) - 1);
            if (m && strlen(m) > 0) strncpy(g_cfg.mac_address, m, sizeof(g_cfg.mac_address) - 1);
            if (mod && strlen(mod) > 0) strncpy(g_cfg.model, mod, sizeof(g_cfg.model) - 1);
            if (fw && strlen(fw) > 0) strncpy(g_cfg.firmware_version, fw, sizeof(g_cfg.firmware_version) - 1);
        }
        json_value_free(val);
    }

    // 2. Fallback for MAC address
    if (strlen(g_cfg.mac_address) == 0) {
        FILE *f = fopen("/sys/class/net/eth0/address", "r");
        if (!f) f = fopen("/sys/class/net/br-lan/address", "r");
        if (f) {
            char buf[64];
            if (fgets(buf, sizeof(buf), f)) {
                buf[strcspn(buf, "\r\n")] = 0;
                strncpy(g_cfg.mac_address, buf, sizeof(g_cfg.mac_address) - 1);
            }
            fclose(f);
        }
    }

    // 3. Fallback for Model from /tmp/sysinfo/model
    if (strlen(g_cfg.model) == 0) {
        FILE *f = fopen("/tmp/sysinfo/model", "r");
        if (f) {
            char buf[64];
            if (fgets(buf, sizeof(buf), f)) {
                buf[strcspn(buf, "\r\n")] = 0;
                strncpy(g_cfg.model, buf, sizeof(g_cfg.model) - 1);
            }
            fclose(f);
        } else {
            strncpy(g_cfg.model, "Niseva 2S", sizeof(g_cfg.model) - 1);
        }
    }

    // 4. Detect Architecture
    FILE *f_arch = fopen("/etc/openwrt_release", "r");
    if (f_arch) {
        char line[128];
        while (fgets(line, sizeof(line), f_arch)) {
            if (strncmp(line, "DISTRIB_ARCH='", 14) == 0) {
                char *end = strchr(line + 14, '\'');
                if (end) *end = 0;
                strncpy(g_cfg.architecture, line + 14, sizeof(g_cfg.architecture) - 1);
                break;
            }
        }
        fclose(f_arch);
    }
    if (strlen(g_cfg.architecture) == 0) {
        strncpy(g_cfg.architecture, "mips_24kc", sizeof(g_cfg.architecture) - 1);
    }

    // 5. Hardware Capabilities Discovery (HAL)
    g_cfg.caps.sim_slots = 1;
    g_cfg.caps.has_gps = false;
    g_cfg.caps.has_rs485 = false;
    g_cfg.caps.has_wifi_5g = false;
    g_cfg.caps.ethernet_ports = 2;
    g_cfg.caps.is_5g = false;

    if (strstr(g_cfg.model, "2M") || strstr(g_cfg.model, "Dual")) {
        g_cfg.caps.sim_slots = 2;
        g_cfg.caps.has_rs485 = true;
    } else if (strstr(g_cfg.model, "Pro") || strstr(g_cfg.model, "4G-Pro")) {
        g_cfg.caps.sim_slots = 2;
        g_cfg.caps.has_gps = true;
        g_cfg.caps.has_wifi_5g = true;
        g_cfg.caps.ethernet_ports = 4;
    } else if (strstr(g_cfg.model, "5G") || strstr(g_cfg.model, "Ultra")) {
        g_cfg.caps.sim_slots = 2;
        g_cfg.caps.has_gps = true;
        g_cfg.caps.has_wifi_5g = true;
        g_cfg.caps.ethernet_ports = 5;
        g_cfg.caps.is_5g = true;
    }

    // Probe physical devices if present
    if (access("/dev/ttyUSB1", F_OK) == 0 || access("/dev/gnss0", F_OK) == 0) {
        g_cfg.caps.has_gps = true;
    }
    if (access("/dev/ttyS1", F_OK) == 0 || access("/dev/ttyRS485", F_OK) == 0) {
        g_cfg.caps.has_rs485 = true;
    }
    if (access("/sys/class/net/wlan1", F_OK) == 0) {
        g_cfg.caps.has_wifi_5g = true;
    }

    // 6. Fallback for Serial Number
    if (strlen(g_cfg.serial) == 0) {
        if (strlen(g_cfg.mac_address) >= 8) {
            snprintf(g_cfg.serial, sizeof(g_cfg.serial), "NSV-%s", g_cfg.mac_address + 9);
        } else {
            strncpy(g_cfg.serial, "NSV-2S-DEMO", sizeof(g_cfg.serial) - 1);
        }
    }

    // 7. Fallback for Firmware Version
    if (strlen(g_cfg.firmware_version) == 0) {
        FILE *f_fw = fopen("/etc/openwrt_version", "r");
        if (f_fw) {
            char buf[64];
            if (fgets(buf, sizeof(buf), f_fw)) {
                buf[strcspn(buf, "\r\n")] = 0;
                snprintf(g_cfg.firmware_version, sizeof(g_cfg.firmware_version), "v%s", buf);
            }
            fclose(f_fw);
        } else {
            strncpy(g_cfg.firmware_version, "v1.0.0-lts", sizeof(g_cfg.firmware_version) - 1);
        }
    }

    syslog(LOG_INFO, "Hardware detected: Model=%s (%s), Serial=%s, MAC=%s, SIMs=%d, GPS=%d, RS485=%d, 5G=%d",
           g_cfg.model, g_cfg.architecture, g_cfg.serial, g_cfg.mac_address,
           g_cfg.caps.sim_slots, g_cfg.caps.has_gps, g_cfg.caps.has_rs485, g_cfg.caps.is_5g);
}

int perform_provision_checkin(void) {
    syslog(LOG_INFO, "Starting Zero-Touch HTTP Check-in to %s/api/v1/provision/check-in...", g_cfg.server_url);

    // Construct Check-in JSON with Hardware Capabilities
    JSON_Value *root = json_value_init_object();
    JSON_Object *obj = json_value_get_object(root);

    json_object_set_string(obj, "serial_number", g_cfg.serial);
    json_object_set_string(obj, "mac_address", g_cfg.mac_address);
    json_object_set_string(obj, "model", g_cfg.model);
    json_object_set_string(obj, "architecture", g_cfg.architecture);
    json_object_set_string(obj, "firmware_version", g_cfg.firmware_version);
    json_object_set_string(obj, "enrollment_token", g_cfg.enrollment_token);

    JSON_Value *caps_val = json_value_init_object();
    JSON_Object *caps_obj = json_value_get_object(caps_val);
    json_object_set_number(caps_obj, "sim_slots", g_cfg.caps.sim_slots);
    json_object_set_boolean(caps_obj, "has_gps", g_cfg.caps.has_gps);
    json_object_set_boolean(caps_obj, "has_rs485", g_cfg.caps.has_rs485);
    json_object_set_boolean(caps_obj, "has_wifi_5g", g_cfg.caps.has_wifi_5g);
    json_object_set_number(caps_obj, "ethernet_ports", g_cfg.caps.ethernet_ports);
    json_object_set_boolean(caps_obj, "is_5g", g_cfg.caps.is_5g);
    json_object_set_value(obj, "capabilities", caps_val);

    char *json_body = json_serialize_to_string(root);
    json_value_free(root);

    if (!json_body) return -1;

    char cmd[1024];
    snprintf(cmd, sizeof(cmd),
             "uclient-fetch --post-data='%s' --header='Content-Type: application/json' -O - '%s/api/v1/provision/check-in' 2>/dev/null",
             json_body, g_cfg.server_url);
    free(json_body);

    FILE *fp = popen(cmd, "r");
    if (!fp) {
        syslog(LOG_ERR, "Failed to execute uclient-fetch for bootstrap check-in");
        return -1;
    }

    char response_buf[2048] = {0};
    size_t bytes_read = fread(response_buf, 1, sizeof(response_buf) - 1, fp);
    pclose(fp);

    if (bytes_read == 0) {
        syslog(LOG_WARNING, "No response received from Cloud RMS provision server");
        return -1;
    }

    JSON_Value *resp_val = json_parse_string(response_buf);
    if (!resp_val) {
        syslog(LOG_ERR, "Invalid JSON received from provision server: %s", response_buf);
        return -1;
    }

    JSON_Object *resp_obj = json_value_get_object(resp_val);
    JSON_Object *mqtt_obj = json_object_get_object(resp_obj, "mqtt");
    const char *mqtt_host = json_object_get_string(resp_obj, "mqtt_host");
    if (!mqtt_host && mqtt_obj) mqtt_host = json_object_get_string(mqtt_obj, "host");
    int mqtt_port = (int)json_object_get_number(resp_obj, "mqtt_port");
    if (mqtt_port == 0 && mqtt_obj) mqtt_port = (int)json_object_get_number(mqtt_obj, "port");
    const char *mqtt_token = json_object_get_string(resp_obj, "mqtt_token");
    if (!mqtt_token && mqtt_obj) mqtt_token = json_object_get_string(mqtt_obj, "token");

    if (mqtt_host && mqtt_token && strlen(mqtt_token) > 0) {
        syslog(LOG_INFO, "Device provisioned successfully! MQTT Broker=%s:%d", mqtt_host, mqtt_port > 0 ? mqtt_port : 1883);

        save_config_option("general", "mqtt_host", mqtt_host);
        if (mqtt_port > 0) {
            char port_str[16];
            snprintf(port_str, sizeof(port_str), "%d", mqtt_port);
            save_config_option("general", "mqtt_port", port_str);
        }
        save_config_option("general", "mqtt_token", mqtt_token);
        save_config_option("general", "provisioned", "1");

        strncpy(g_cfg.mqtt_host, mqtt_host, sizeof(g_cfg.mqtt_host) - 1);
        if (mqtt_port > 0) g_cfg.mqtt_port = mqtt_port;
        strncpy(g_cfg.mqtt_token, mqtt_token, sizeof(g_cfg.mqtt_token) - 1);
        g_cfg.provisioned = true;

        json_value_free(resp_val);
        return 0;
    }

    json_value_free(resp_val);
    return -1;
}
