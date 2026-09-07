#include "agent.h"
#include "runtime.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <sys/statvfs.h>
#include <libubox/blobmsg.h>
#include <libubox/blobmsg_json.h>
#include "parson.h"

// -------------------------------------------------------------
// 1. Bounded Backlog Ring Buffer (2 MiB Hard Limit)
// -------------------------------------------------------------
typedef struct telemetry_node {
    char boot_id[64];
    char source_id[65];
    int64_t sequence;
    char *topic;
    char *payload;
    size_t payload_len;
    struct telemetry_node *next;
} telemetry_node_t;

static telemetry_node_t *g_queue_head = NULL;
static telemetry_node_t *g_queue_tail = NULL;
static size_t g_queue_bytes = 0;
static int64_t g_dropped_count = 0;
static int64_t g_sequence_counter = 1;

void telemetry_queue_init(void) {
    while(g_queue_head){telemetry_node_t *next=g_queue_head->next;free(g_queue_head->topic);free(g_queue_head->payload);free(g_queue_head);g_queue_head=next;}
    g_queue_head = NULL;
    g_queue_tail = NULL;
    g_queue_bytes = 0;
    g_dropped_count = 0;
    g_sequence_counter = 1;
}

int64_t telemetry_get_dropped_count(void) {
    return g_dropped_count;
}

int64_t telemetry_get_next_sequence(void) {
    return g_sequence_counter++;
}

int telemetry_queue_push(const char *topic, const char *payload, size_t len, const char *boot_id, const char *source_id, int64_t seq) {
    if (!topic || !payload || len == 0) return -1;

    if(len>65536 || strlen(topic)>127)return -1;
    size_t item_cost = sizeof(telemetry_node_t) + strlen(topic) + 1 + len + 1;

    if(item_cost>MAX_TELEMETRY_BACKLOG_BYTES)return -1;
    // Discard oldest unacknowledged snapshots if memory limit reached
    while (g_queue_head && (g_queue_bytes + item_cost > MAX_TELEMETRY_BACKLOG_BYTES)) {
        telemetry_node_t *oldest = g_queue_head;
        g_queue_head = oldest->next;
        if (!g_queue_head) g_queue_tail = NULL;

        size_t oldest_cost = sizeof(telemetry_node_t) + strlen(oldest->topic) + 1 + oldest->payload_len + 1;
        if (g_queue_bytes >= oldest_cost) {
            g_queue_bytes -= oldest_cost;
        } else {
            g_queue_bytes = 0;
        }

        g_dropped_count++;
        printf("[BUFFER] ⚠️ 2MiB limit reached! Dropped oldest unacked snapshot (seq %lld). Total dropped=%lld\n",
               (long long)oldest->sequence, (long long)g_dropped_count);

        free(oldest->topic);
        free(oldest->payload);
        free(oldest);
    }

    telemetry_node_t *node = calloc(1,sizeof(telemetry_node_t));
    if (!node) return -1;

    node->topic = strdup(topic);
    node->payload = malloc(len + 1);
    if (!node->topic || !node->payload) {
        if (node->topic) free(node->topic);
        free(node->payload);
        free(node);
        return -1;
    }
    memcpy(node->payload, payload, len);
    node->payload[len] = '\0';
    node->payload_len = len;

    strncpy(node->boot_id, boot_id ? boot_id : "", sizeof(node->boot_id) - 1);
    strncpy(node->source_id, source_id ? source_id : "", sizeof(node->source_id) - 1);
    node->sequence = seq;
    node->next = NULL;

    if (!g_queue_head) {
        g_queue_head = node;
        g_queue_tail = node;
    } else {
        g_queue_tail->next = node;
        g_queue_tail = node;
    }
    g_queue_bytes += item_cost;

    return 0;
}

void telemetry_queue_ack(const char *boot_id, const char *source_id, int64_t seq) {
    if (!boot_id || !source_id) return;

    telemetry_node_t **curr = &g_queue_head;
    int purged = 0;

    while (*curr) {
        telemetry_node_t *entry = *curr;
        if (strcmp(entry->boot_id, boot_id) == 0 &&
            strcmp(entry->source_id, source_id) == 0 &&
            entry->sequence == seq) {

            *curr = entry->next;
            if (entry == g_queue_tail) {
                g_queue_tail = NULL;
            }

            size_t cost = sizeof(telemetry_node_t) + strlen(entry->topic) + 1 + entry->payload_len + 1;
            if (g_queue_bytes >= cost) {
                g_queue_bytes -= cost;
            } else {
                g_queue_bytes = 0;
            }

            free(entry->topic);
            free(entry->payload);
            free(entry);
            purged++;
        } else {
            curr = &entry->next;
        }
    }

    g_queue_tail=g_queue_head;
    while(g_queue_tail && g_queue_tail->next)g_queue_tail=g_queue_tail->next;
    if (purged > 0) {
        printf("[BUFFER] ✅ ACK received: purged %d confirmed snapshot(s) for seq %lld. Backlog: %zu bytes\n",
               purged, (long long)seq, g_queue_bytes);
    }
}

void telemetry_queue_flush_pending(void) {
    /* One application-level in-flight snapshot; retry without duplicating the entire queue. */
    static struct timespec previous={0};struct timespec now;clock_gettime(CLOCK_MONOTONIC,&now);
    if(!g_mosq || !g_queue_head || now.tv_sec-previous.tv_sec<2)return;
    if(mosquitto_publish(g_mosq,NULL,g_queue_head->topic,g_queue_head->payload_len,g_queue_head->payload,1,false)==MOSQ_ERR_SUCCESS)previous=now;
}

void handle_telemetry_ack(const char *payload) {
    if (!payload) return;

    JSON_Value *root = json_parse_string(payload);
    if (!root) return;

    JSON_Object *obj = json_value_get_object(root);
    if (obj) {
        const char *boot_id = json_object_get_string(obj, "boot_id");
        const char *source_id = json_object_get_string(obj, "source_id");
        int64_t seq = (int64_t)json_object_get_number(obj, "sequence");

        if (boot_id && source_id && seq > 0) {
            telemetry_queue_ack(boot_id, source_id, seq);
        }
    }
    json_value_free(root);
}


size_t telemetry_queue_bytes(void){return g_queue_bytes;}
void send_heartbeat(struct uloop_timeout *t){
    if(g_mosq){char topic[128];snprintf(topic,sizeof(topic),"rms/v1/devices/%s/heartbeat",g_cfg.device_id);const char *p="{\"status\":\"online\"}";mosquitto_publish(g_mosq,NULL,topic,strlen(p),p,0,false);}
    uloop_timeout_set(t,60000);
}
void collect_and_send_telemetry(struct uloop_timeout *t){rms_collect_tick();uloop_timeout_set(t,100);}
