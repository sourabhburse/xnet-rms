#include "agent.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <sys/statvfs.h>
#include <libubox/blobmsg.h>
#include <libubox/blobmsg_json.h>
#include "parson.h"

struct cellular_data {
    int rssi;
    int rsrp;
    int rsrq;
    int sinr;
    char net_type[32];
    char carrier[64];
    char band[32];
    char sim_status[32];
    char data_conn[32];
    char imei[32];
    char temperature[16];
};

struct system_data {
    uint64_t uptime;
    float cpu_load;
    int ram_used_mb;
    int ram_total_mb;
    float flash_free_mb;
};

struct wan_data {
    char wan_ip[64];
    uint64_t rx_bytes;
    uint64_t tx_bytes;
};

static void sanitize_string(char *dest, const char *src, size_t max_len) {
    if (!src || !dest) return;
    while (*src == ' ' || *src == '\"' || *src == '\r' || *src == '\n') src++;
    size_t len = 0;
    while (*src && len < max_len - 1) {
        if (*src == '\"' || *src == '\r' || *src == '\n') break;
        dest[len++] = *src++;
    }
    while (len > 0 && dest[len - 1] == ' ') len--;
    dest[len] = '\0';
}

static void cellular_cb(struct ubus_request *req, int type, struct blob_attr *msg) {
    (void)type;
    struct cellular_data *data = (struct cellular_data *)req->priv;
    if (!msg || !data) return;

    struct blob_attr *cur;
    int rem;
    blobmsg_for_each_attr(cur, msg, rem) {
        if (strcmp(blobmsg_name(cur), "message") == 0) {
            const char *raw_json = blobmsg_get_string(cur);
            if (!raw_json) break;

            JSON_Value *root = json_parse_string(raw_json);
            if (!root) break;

            JSON_Array *modems = json_value_get_array(root);
            if (modems && json_array_get_count(modems) > 0) {
                JSON_Object *m = json_array_get_object(modems, 0);
                if (m) {
                    if (json_object_has_value_of_type(m, "rssi", JSONNumber)) {
                        data->rssi = (int)json_object_get_number(m, "rssi");
                    }
                    sanitize_string(data->net_type, json_object_get_string(m, "net_type"), sizeof(data->net_type));
                    sanitize_string(data->carrier, json_object_get_string(m, "plmn_description"), sizeof(data->carrier));
                    sanitize_string(data->sim_status, json_object_get_string(m, "sim_status"), sizeof(data->sim_status));
                    sanitize_string(data->data_conn, json_object_get_string(m, "data_connectivity"), sizeof(data->data_conn));
                    sanitize_string(data->imei, json_object_get_string(m, "imei"), sizeof(data->imei));
                    sanitize_string(data->band, json_object_get_string(m, "band"), sizeof(data->band));
                    sanitize_string(data->temperature, json_object_get_string(m, "temperature"), sizeof(data->temperature));
                }
            }
            json_value_free(root);
            break;
        }
    }
}

static void system_info_cb(struct ubus_request *req, int type, struct blob_attr *msg) {
    (void)type;
    struct system_data *sys = (struct system_data *)req->priv;
    if (!msg || !sys) return;

    char *json_str = blobmsg_format_json(msg, true);
    if (!json_str) return;

    JSON_Value *root = json_parse_string(json_str);
    free(json_str);
    if (!root) return;

    JSON_Object *obj = json_value_get_object(root);
    if (obj) {
        sys->uptime = (uint64_t)json_object_get_number(obj, "uptime");
        JSON_Object *mem = json_object_get_object(obj, "memory");
        if (mem) {
            uint64_t total = (uint64_t)json_object_get_number(mem, "total");
            uint64_t free_mem = (uint64_t)json_object_get_number(mem, "free");
            sys->ram_total_mb = (int)(total / (1024 * 1024));
            sys->ram_used_mb = (int)((total - free_mem) / (1024 * 1024));
        }
    }
    json_value_free(root);
}

static void wan_status_cb(struct ubus_request *req, int type, struct blob_attr *msg) {
    (void)type;
    struct wan_data *wan = (struct wan_data *)req->priv;
    if (!msg || !wan) return;

    char *json_str = blobmsg_format_json(msg, true);
    if (!json_str) return;

    JSON_Value *root = json_parse_string(json_str);
    free(json_str);
    if (!root) return;

    JSON_Object *obj = json_value_get_object(root);
    if (obj) {
        JSON_Array *ips = json_object_get_array(obj, "ipv4-address");
        if (ips && json_array_get_count(ips) > 0) {
            JSON_Object *first_ip = json_array_get_object(ips, 0);
            const char *addr = json_object_get_string(first_ip, "address");
            if (addr) strncpy(wan->wan_ip, addr, sizeof(wan->wan_ip) - 1);
        }
    }
    json_value_free(root);
}

static void collect_system_metrics(struct system_data *sys) {
    // 1. Query real ubus call system info
    if (g_ubus) {
        uint32_t id;
        if (ubus_lookup_id(g_ubus, "system", &id) == UBUS_STATUS_OK) {
            ubus_invoke(g_ubus, id, "info", NULL, system_info_cb, sys, 1000);
        }
    }

    // 2. Read real CPU 1-minute load average from /proc/loadavg
    FILE *f = fopen("/proc/loadavg", "r");
    if (f) {
        if (fscanf(f, "%f", &sys->cpu_load) != 1) {
            sys->cpu_load = 0.05f;
        }
        fclose(f);
    }

    // 3. Read real flash free space on /overlay via POSIX statvfs
    struct statvfs st;
    if (statvfs("/overlay", &st) == 0) {
        sys->flash_free_mb = (float)((double)(st.f_bavail * st.f_frsize) / (1024.0 * 1024.0));
    } else {
        sys->flash_free_mb = 2.5f;
    }
}

static void collect_wan_metrics(struct wan_data *wan) {
    strncpy(wan->wan_ip, "127.0.0.1", sizeof(wan->wan_ip));

    // 1. Query real ubus call network.interface.wan status
    if (g_ubus) {
        uint32_t id;
        if (ubus_lookup_id(g_ubus, "network.interface.wan", &id) == UBUS_STATUS_OK) {
            ubus_invoke(g_ubus, id, "status", NULL, wan_status_cb, wan, 1000);
        } else if (ubus_lookup_id(g_ubus, "network.interface.wwan", &id) == UBUS_STATUS_OK) {
            ubus_invoke(g_ubus, id, "status", NULL, wan_status_cb, wan, 1000);
        }
    }

    // 2. Read network interface traffic statistics
    const char *ifaces[] = {"/sys/class/net/wwan0/statistics", "/sys/class/net/eth0.2/statistics", "/sys/class/net/eth0/statistics"};
    for (size_t i = 0; i < sizeof(ifaces)/sizeof(ifaces[0]); i++) {
        char rx_path[128], tx_path[128];
        snprintf(rx_path, sizeof(rx_path), "%s/rx_bytes", ifaces[i]);
        snprintf(tx_path, sizeof(tx_path), "%s/tx_bytes", ifaces[i]);

        FILE *frx = fopen(rx_path, "r");
        FILE *ftx = fopen(tx_path, "r");
        if (frx && ftx) {
            fscanf(frx, "%llu", (unsigned long long *)&wan->rx_bytes);
            fscanf(ftx, "%llu", (unsigned long long *)&wan->tx_bytes);
            fclose(frx);
            fclose(ftx);
            break;
        }
        if (frx) fclose(frx);
        if (ftx) fclose(ftx);
    }
}

void send_heartbeat(struct uloop_timeout *t) {
    if (g_mosq && g_cfg.provisioned) {
        char topic[128];
        snprintf(topic, sizeof(topic), "niseva/device/%s/heartbeat", g_cfg.serial);

        struct system_data sys = {0};
        collect_system_metrics(&sys);

        char payload[128];
        snprintf(payload, sizeof(payload), "{\"status\": \"ONLINE\", \"uptime\": %llu}", (unsigned long long)sys.uptime);

        mosquitto_publish(g_mosq, NULL, topic, strlen(payload), payload, 1, false);
    }

    uloop_timeout_set(t, g_cfg.heartbeat_interval * 1000);
}

void collect_and_send_telemetry(struct uloop_timeout *t) {
    if (!g_mosq || !g_cfg.provisioned) {
        uloop_timeout_set(t, g_cfg.telemetry_interval * 1000);
        return;
    }

    struct cellular_data cell = {0};
    cell.rssi = 0;
    strncpy(cell.net_type, "NONE", sizeof(cell.net_type));
    strncpy(cell.carrier, "Searching...", sizeof(cell.carrier));
    strncpy(cell.sim_status, "Ready", sizeof(cell.sim_status));
    strncpy(cell.data_conn, "disconnected", sizeof(cell.data_conn));

    // 1. Query native ubus call cellular status
    if (g_ubus) {
        uint32_t id;
        if (ubus_lookup_id(g_ubus, "cellular", &id) == UBUS_STATUS_OK) {
            ubus_invoke(g_ubus, id, "status", NULL, cellular_cb, &cell, 2000);
        }
    }

    // 2. Query real System Health metrics
    struct system_data sys = {0};
    collect_system_metrics(&sys);

    // 3. Query real WAN Network metrics
    struct wan_data wan = {0};
    collect_wan_metrics(&wan);

    // 4. Query monitored services (IPsec strongSwan & Modbus)
    bool ipsec_running = (access("/var/run/charon.pid", F_OK) == 0);
    bool modbus_running = (access("/var/run/modbus-master.pid", F_OK) == 0);

    char topic[128];
    snprintf(topic, sizeof(topic), "niseva/device/%s/telemetry", g_cfg.serial);

    char json_payload[1024];
    snprintf(json_payload, sizeof(json_payload),
        "{"
            "\"serial\":\"%s\","
            "\"timestamp\":%ld,"
            "\"cellular\":{"
                "\"rssi\":%d,"
                "\"net_type\":\"%s\","
                "\"carrier\":\"%s\","
                "\"sim_status\":\"%s\","
                "\"data_connectivity\":\"%s\","
                "\"imei\":\"%s\","
                "\"band\":\"%s\","
                "\"temperature\":\"%s\""
            "},"
            "\"system\":{"
                "\"uptime_seconds\":%llu,"
                "\"cpu_load\":%.2f,"
                "\"ram_used_mb\":%d,"
                "\"ram_total_mb\":%d,"
                "\"flash_free_mb\":%.2f"
            "},"
            "\"traffic\":{"
                "\"wan_ip\":\"%s\","
                "\"rx_bytes\":%llu,"
                "\"tx_bytes\":%llu"
            "},"
            "\"services\":{"
                "\"ipsec\":{\"status\":\"%s\"},"
                "\"modbus\":{\"status\":\"%s\"}"
            "}"
        "}",
        g_cfg.serial,
        (long)time(NULL),
        cell.rssi, cell.net_type, cell.carrier, cell.sim_status,
        cell.data_conn, cell.imei, cell.band, cell.temperature,
        (unsigned long long)sys.uptime,
        sys.cpu_load,
        sys.ram_used_mb,
        sys.ram_total_mb,
        sys.flash_free_mb,
        wan.wan_ip,
        (unsigned long long)wan.rx_bytes,
        (unsigned long long)wan.tx_bytes,
        ipsec_running ? "ESTABLISHED" : "STOPPED",
        modbus_running ? "RUNNING" : "STOPPED"
    );

    mosquitto_publish(g_mosq, NULL, topic, strlen(json_payload), json_payload, 0, false);
    printf("[TELEMETRY] Published live stats: RSSI=%d, Carrier=%s, RAM=%d/%dMB, FlashFree=%.2fMB, WAN=%s\n",
           cell.rssi, cell.carrier, sys.ram_used_mb, sys.ram_total_mb, sys.flash_free_mb, wan.wan_ip);

    uloop_timeout_set(t, g_cfg.telemetry_interval * 1000);
}
