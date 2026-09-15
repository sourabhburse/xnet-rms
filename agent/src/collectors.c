#include "agent.h"
#include "runtime.h"
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/sha.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/stat.h>

#define PROFILE_FILE "/tmp/xnet-rms-profiles.json"
#define COLLECTOR_DIR RMS_PKI_DIR "/collectors"
#define BUILTIN_DEVICE_OVERVIEW "/usr/libexec/xnet-rms/device-overview.sh"
#define BUILTIN_IPSEC "/usr/libexec/xnet-rms/ipsec.lua"
#define BUILTIN_MODBUS_HEALTH "/usr/libexec/xnet-rms/modbus-health.sh"

static JSON_Value *profiles;
static time_t loaded;
static long next_run[16];
static pid_t child;
static int pipefd = -1, index_running;
static long deadline;
static char buffer[32769];
static size_t used, limit;
static char observed[32];
static int overflow;
static char preview_request[64], preview_sources[4][33], preview_source[33];
static size_t preview_count, preview_next;
static int preview_running;

static long seconds(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec;
}

static int complete_json(const char *s) {
    int depth = 0, quoted = 0, escape = 0, started = 0;
    for (; *s; s++) {
        if (quoted) {
            if (escape) escape = 0;
            else if (*s == '\\') escape = 1;
            else if (*s == '"') quoted = 0;
            continue;
        }
        if (*s == '"') {
            quoted = 1;
            continue;
        }
        if (*s == '{' || *s == '[') {
            depth++;
            started = 1;
        } else if (*s == '}' || *s == ']') {
            if (--depth < 0) return 0;
            if (depth == 0) {
                s++;
                while (*s == ' ' || *s == '\r' || *s == '\n' || *s == '\t') s++;
                return !*s;
            }
        } else if (!started && *s != ' ' && *s != '\r' && *s != '\n' && *s != '\t') {
            return 0;
        }
    }
    return 0;
}

static JSON_Value *normalize_ubus_message(JSON_Value *data) {
    JSON_Object *root = json_value_get_object(data);
    const char *message = root ? json_object_get_string(root, "message") : NULL;
    if (!message || !*message) return data;
    JSON_Value *inner = json_parse_string(message);
    if (!inner || (!json_value_get_object(inner) && !json_value_get_array(inner))) {
        json_value_free(inner);
        return data;
    }
    JSON_Value *wrapped = json_value_init_object();
    json_object_set_value(json_value_get_object(wrapped), "message", inner);
    json_value_free(data);
    return wrapped;
}

static const char *builtin_collector_path(const char *id) {
    if (!id) return NULL;
    if (!strcmp(id, "device_overview")) return BUILTIN_DEVICE_OVERVIEW;
    if (!strcmp(id, "ipsec")) return BUILTIN_IPSEC;
    if (!strcmp(id, "modbus_health")) return BUILTIN_MODBUS_HEALTH;
    return NULL;
}

int rms_preview_collect(const char *request_id, JSON_Array *collector_ids) {
    size_t count = json_array_get_count(collector_ids);
    if (!rms_id(request_id) || count < 1 || count > 4 || preview_request[0]) return -1;
    for (size_t i = 0; i < count; i++) {
        const char *id = json_array_get_string(collector_ids, i);
        if (!rms_id(id) || !builtin_collector_path(id)) return -1;
        snprintf(preview_sources[i], sizeof(preview_sources[i]), "%s", id);
    }
    snprintf(preview_request, sizeof(preview_request), "%s", request_id);
    preview_count = count;
    preview_next = 0;
    return 0;
}

/* Defence in depth: even platform-authored profiles may call only known
 * read-only ubus methods. Customer templates never contain raw ubus calls. */
static int readonly_ubus(const char *object, const char *method) {
    if (!object || !method) return 0;
    if ((!strcmp(object, "system") && (!strcmp(method, "info") || !strcmp(method, "board"))) ||
        (!strcmp(object, "cellular") && !strcmp(method, "status")) ||
        (!strcmp(object, "ipsec-status") && (!strcmp(method, "status") || !strcmp(method, "statusall"))) ||
        (!strcmp(object, "mwan3") && !strcmp(method, "status")) ||
        (!strcmp(object, "network.device") && !strcmp(method, "status")) ||
        (!strcmp(object, "service") && !strcmp(method, "list")) ||
        (!strcmp(object, "dhcp") && (!strcmp(method, "ipv4leases") || !strcmp(method, "ipv6leases"))) ||
        (!strcmp(object, "dnsmasq") && !strcmp(method, "metrics")) ||
        (!strcmp(object, "iwinfo") && (!strcmp(method, "info") || !strcmp(method, "assoclist")))) return 1;
    return !strncmp(object, "network.interface.", 18) && strlen(object) <= 96 && !strcmp(method, "status");
}

static int verify_bundle(JSON_Object *b, const char *id, int version) {
    const char *script = json_object_get_string(b, "script");
    const char *hash = json_object_get_string(b, "sha256");
    const char *sig = json_object_get_string(b, "signature");
    const char *bid = json_object_get_string(b, "id");
    if (!script || strlen(script) > 65536 || strncmp(script, "#!", 2) ||
        !hash || strlen(hash) != 64 || !sig || strlen(sig) > 256 || !bid ||
        strcmp(bid, id) || json_object_get_number(b, "version") != version) return -1;
    unsigned char h[32], signature[256];
    SHA256((const unsigned char *)script, strlen(script), h);
    char hex[65];
    for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", h[i]);
    if (strcmp(hex, hash)) return -1;
    int n = EVP_DecodeBlock(signature, (const unsigned char *)sig, strlen(sig));
    if (n < 0) return -1;
    size_t sl = strlen(sig);
    if (sl && sig[sl - 1] == '=') n--;
    if (sl > 1 && sig[sl - 2] == '=') n--;
    char msg[256];
    snprintf(msg, sizeof(msg), "xnet-rms/collector/v1\n%s\n%d\n%s", id, version, hash);
    FILE *f = fopen(RMS_PKI_DIR "/collector.pub", "r");
    EVP_PKEY *key = f ? PEM_read_PUBKEY(f, NULL, NULL, NULL) : NULL;
    if (f) fclose(f);
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    int ok = key && ctx && EVP_DigestVerifyInit(ctx, NULL, EVP_sha256(), NULL, key) == 1 &&
             EVP_DigestVerifyUpdate(ctx, msg, strlen(msg)) == 1 &&
             EVP_DigestVerifyFinal(ctx, signature, n) == 1;
    EVP_MD_CTX_free(ctx);
    EVP_PKEY_free(key);
    return ok ? 0 : -1;
}

int rms_sync_profiles(void) {
    char url[512];
    snprintf(url, sizeof(url), "%s/api/v1/agent/profiles", g_cfg.server_url);
    char *text = rms_http(url, NULL, 1, 131072);
    if (!text) return -1;
    JSON_Value *v = json_parse_string(text);
    JSON_Array *a = json_object_get_array(json_value_get_object(v), "profiles");
    int rc = -1;
    if (!a || json_array_get_count(a) > 16) goto done;
    for (size_t i = 0; i < json_array_get_count(a); i++) {
        JSON_Object *p = json_array_get_object(a, i);
        const char *type = json_object_get_string(p, "type");
        if (!type || !rms_id(json_object_get_string(p, "id"))) goto done;
        double interval = json_object_get_number(p, "interval_seconds");
        double timeout = json_object_get_number(p, "timeout_seconds");
        double max = json_object_get_number(p, "max_output_bytes");
        if (interval < 60 || interval > 300 || timeout < 1 || timeout > 15 ||
            max < 256 || max > 32768) goto done;
        if (!strcmp(type, "script")) {
            const char *id = json_object_get_string(p, "bundle_id");
            int version = json_object_get_number(p, "bundle_version");
            if (!rms_id(id) || version < 1) goto done;
            char dir[256], path[320];
            snprintf(dir, sizeof(dir), "%s/%s", COLLECTOR_DIR, id);
            snprintf(path, sizeof(path), "%s/%d.sh", dir, version);
            if (access(path, F_OK) == 0) continue;
            snprintf(url, sizeof(url), "%s/api/v1/agent/bundles/%s?version=%d", g_cfg.server_url, id, version);
            char *bundle = rms_http(url, NULL, 1, 131072);
            if (!bundle) goto done;
            JSON_Value *bv = json_parse_string(bundle);
            free(bundle);
            JSON_Object *bo = json_value_get_object(bv);
            if (!bo || verify_bundle(bo, id, version)) {
                json_value_free(bv);
                goto done;
            }
            mkdir(COLLECTOR_DIR, 0700);
            mkdir(dir, 0700);
            const char *script = json_object_get_string(bo, "script");
            int result = rms_write_atomic(path, script, strlen(script), 0700);
            json_value_free(bv);
            if (result) goto done;
            char *argv[] = {path, NULL};
            int status;
            char *check = rms_capture(argv, timeout, max, &status);
            int accepted = check && complete_json(check) && (status == 0 || status == 2);
            free(check);
            if (!accepted) {
                unlink(path);
                goto done;
            }
            char current[320], previous[320], link[320], target[64];
            snprintf(current, sizeof(current), "%s/current", dir);
            snprintf(previous, sizeof(previous), "%s/previous", dir);
            snprintf(link, sizeof(link), "%s/next", dir);
            unlink(previous);
            rename(current, previous);
            snprintf(target, sizeof(target), "%d.sh", version);
            unlink(link);
            if (symlink(target, link) || rename(link, current)) goto done;
        } else if (!strcmp(type, "ubus")) {
            if (!readonly_ubus(json_object_get_string(p, "object"), json_object_get_string(p, "method"))) goto done;
        } else if (strcmp(type, "builtin") || !builtin_collector_path(json_object_get_string(p, "collector_id"))) {
            goto done;
        }
    }
    rc = rms_write_atomic(PROFILE_FILE, text, strlen(text), 0600);
done:
    json_value_free(v);
    free(text);
    return rc;
}

static void emit(int status) {
    JSON_Array *a = json_object_get_array(json_value_get_object(profiles), "profiles");
    JSON_Object *p = json_array_get_object(a, index_running);
    if (!p) return;
    buffer[used] = 0;
    JSON_Value *data = complete_json(buffer) ? json_parse_string(buffer) : NULL;
    const char *type = json_object_get_string(p, "type");
    if (data && type && !strcmp(type, "ubus")) data = normalize_ubus_message(data);
    const char *state = "ok", *error = "";
    if (overflow || !WIFEXITED(status) || WEXITSTATUS(status) != 0 || !data) {
        state = WIFEXITED(status) && WEXITSTATUS(status) == 2 ? "unsupported" : "error";
        error = overflow ? "collector timeout or output limit exceeded" : "collector failed or produced invalid JSON";
        json_value_free(data);
        data = json_value_init_object();
    }
    JSON_Value *v = json_value_init_object();
    JSON_Object *o = json_value_get_object(v);
    int64_t seq = telemetry_get_next_sequence();
    const char *source = json_object_get_string(p, "source_id");
    json_object_set_number(o, "schema_version", 1);
    json_object_set_string(o, "device_id", g_cfg.device_id);
    json_object_set_string(o, "source_id", source);
    json_object_set_string(o, "profile_id", json_object_get_string(p, "id"));
    json_object_set_number(o, "profile_version", json_object_get_number(p, "version"));
    json_object_set_string(o, "boot_id", g_cfg.boot_id);
    json_object_set_number(o, "sequence", seq);
    json_object_set_string(o, "observed_at", observed);
    json_object_set_string(o, "status", state);
    json_object_set_string(o, "error", error);
    json_object_set_number(o, "dropped", telemetry_get_dropped_count());
    json_object_set_value(o, "data", data);
    char *payload = json_serialize_to_string(v);
    json_value_free(v);
    if (payload) {
        char topic[128];
        snprintf(topic, sizeof(topic), "rms/v1/devices/%s/snapshots", g_cfg.device_id);
        telemetry_queue_push(topic, payload, strlen(payload), g_cfg.boot_id, source, seq);
        free(payload);
    }
}

static void emit_preview(int status) {
    buffer[used] = 0;
    JSON_Value *data = complete_json(buffer) ? json_parse_string(buffer) : NULL;
    const char *state = "ok", *error = "";
    if (overflow || !WIFEXITED(status) || WEXITSTATUS(status) != 0 || !data) {
        state = WIFEXITED(status) && WEXITSTATUS(status) == 2 ? "unsupported" : "error";
        error = overflow ? "collector timeout or output limit exceeded" : "collector failed or produced invalid JSON";
        json_value_free(data);
        data = json_value_init_object();
    }
    JSON_Value *v = json_value_init_object();
    JSON_Object *o = json_value_get_object(v);
    json_object_set_string(o, "request_id", preview_request);
    json_object_set_string(o, "source_id", preview_source);
    json_object_set_string(o, "observed_at", observed);
    json_object_set_string(o, "status", state);
    json_object_set_string(o, "error", error);
    json_object_set_value(o, "data", data);
    char *payload = json_serialize_to_string(v);
    if (payload && g_mosq) {
        char topic[128];
        snprintf(topic, sizeof(topic), "rms/v1/devices/%s/previews", g_cfg.device_id);
        mosquitto_publish(g_mosq, NULL, topic, strlen(payload), payload, 1, false);
    }
    free(payload);
    json_value_free(v);
}

void rms_collect_stop(void) {
    if (child > 0) {
        kill(-child, SIGKILL);
        waitpid(child, NULL, 0);
        child = 0;
    }
    if (pipefd >= 0) {
        close(pipefd);
        pipefd = -1;
    }
    json_value_free(profiles);
    profiles = NULL;
}

void rms_collect_tick(void) {
    long now = seconds();
    if (child > 0) {
        for (;;) {
            char buf[4096];
            ssize_t n = read(pipefd, buf, sizeof(buf));
            if (n <= 0) break;
            if ((size_t)n > limit - used) {
                overflow = 1;
                break;
            }
            memcpy(buffer + used, buf, n);
            used += n;
        }
        if (now >= deadline || overflow) {
            overflow = 1;
            kill(-child, SIGKILL);
        }
        int status = 0;
        pid_t ended = waitpid(child, &status, WNOHANG);
        if (ended == child || (ended < 0 && errno == ECHILD)) {
            if (ended < 0) status = 127 << 8;
            /* Drain bytes written immediately before exit. */
            for (;;) {
                char b[4096];
                ssize_t n = read(pipefd, b, sizeof(b));
                if (n <= 0) break;
                if ((size_t)n > limit - used) {
                    overflow = 1;
                    break;
                }
                memcpy(buffer + used, b, n);
                used += n;
            }
            kill(-child, SIGKILL);
            close(pipefd);
            pipefd = -1;
            child = 0;
            if (preview_running) {
                emit_preview(status);
                preview_running = 0;
                preview_next++;
                if (preview_next >= preview_count) preview_request[0] = 0;
            } else {
                emit(status);
            }
        }
        return;
    }
    struct stat st;
    if (stat(PROFILE_FILE, &st) == 0 && (!profiles || st.st_mtime != loaded)) {
        JSON_Value *v = json_parse_file(PROFILE_FILE);
        JSON_Array *a = json_object_get_array(json_value_get_object(v), "profiles");
        if (a && json_array_get_count(a) <= 16) {
            json_value_free(profiles);
            profiles = v;
            loaded = st.st_mtime;
            for (size_t i = 0; i < 16; i++) next_run[i] = now + (rand() % 30);
        } else {
            json_value_free(v);
        }
    }
    if (preview_request[0] && preview_next < preview_count) {
        const char *path = builtin_collector_path(preview_sources[preview_next]);
        int fds[2];
        if (!path || pipe(fds)) return;
        child = fork();
        if (child < 0) {
            close(fds[0]);
            close(fds[1]);
            child = 0;
            return;
        }
        if (child == 0) {
            setpgid(0, 0);
            dup2(fds[1], 1);
            int null = open("/dev/null", O_RDWR);
            if (null >= 0) {
                dup2(null, 0);
                dup2(null, 2);
            }
            for (int fd = 3; fd < 1024; fd++) close(fd);
            execl(path, path, (char *)NULL);
            _exit(127);
        }
        setpgid(child, child);
        close(fds[1]);
        pipefd = fds[0];
        fcntl(pipefd, F_SETFL, O_NONBLOCK);
        used = 0;
        overflow = 0;
        limit = 32768;
        deadline = now + 10;
        preview_running = 1;
        snprintf(preview_source, sizeof(preview_source), "%s", preview_sources[preview_next]);
        time_t wall = time(NULL);
        strftime(observed, sizeof(observed), "%Y-%m-%dT%H:%M:%SZ", gmtime(&wall));
        return;
    }
    if (!profiles || !g_cfg.provisioned || time(NULL) < 1577836800) return;
    JSON_Array *a = json_object_get_array(json_value_get_object(profiles), "profiles");
    for (size_t i = 0; i < json_array_get_count(a); i++) {
        if (next_run[i] > now) continue;
        JSON_Object *p = json_array_get_object(a, i);
        int interval = json_object_get_number(p, "interval_seconds");
        int timeout = json_object_get_number(p, "timeout_seconds");
        limit = json_object_get_number(p, "max_output_bytes");
        if (interval < 60 || interval > 300 || timeout < 1 || timeout > 15 || limit > 32768 || limit < 256) {
            next_run[i] = now + 300;
            continue;
        }
        int fds[2];
        if (pipe(fds)) return;
        child = fork();
        if (child < 0) {
            close(fds[0]);
            close(fds[1]);
            child = 0;
            return;
        }
        if (child == 0) {
            setpgid(0, 0);
            dup2(fds[1], 1);
            int null = open("/dev/null", O_RDWR);
            if (null >= 0) {
                dup2(null, 0);
                dup2(null, 2);
            }
            for (int fd = 3; fd < 1024; fd++) close(fd);
            const char *type = json_object_get_string(p, "type");
            if (type && !strcmp(type, "ubus")) {
                const char *obj = json_object_get_string(p, "object");
                const char *method = json_object_get_string(p, "method");
                JSON_Value *args = json_object_get_value(p, "args");
                char *arg = args ? json_serialize_to_string(args) : strdup("{}");
                if (readonly_ubus(obj, method)) execl("/bin/ubus", "ubus", "call", obj, method, arg, (char *)NULL);
            } else if (type && !strcmp(type, "script")) {
                const char *id = json_object_get_string(p, "bundle_id");
                int version = json_object_get_number(p, "bundle_version");
                if (rms_id(id) && version > 0) {
                    char path[320];
                    snprintf(path, sizeof(path), "%s/%s/%d.sh", COLLECTOR_DIR, id, version);
                    execl(path, path, (char *)NULL);
                }
            } else if (type && !strcmp(type, "builtin")) {
                const char *id = json_object_get_string(p, "collector_id");
                const char *path = builtin_collector_path(id);
                if (path) execl(path, path, (char *)NULL);
            }
            _exit(127);
        }
        setpgid(child, child);
        close(fds[1]);
        pipefd = fds[0];
        fcntl(pipefd, F_SETFL, O_NONBLOCK);
        used = 0;
        overflow = 0;
        deadline = now + timeout;
        index_running = i;
        next_run[i] = now + interval;
        time_t wall = time(NULL);
        strftime(observed, sizeof(observed), "%Y-%m-%dT%H:%M:%SZ", gmtime(&wall));
        break;
    }
}
