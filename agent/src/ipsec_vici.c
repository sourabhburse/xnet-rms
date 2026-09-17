/*
 * Optional strongSwan IPsec collector.
 *
 * Only read-only VICI commands are used here: list-conns and list-sas.  The
 * collector is a separate package because libvici/strongSwan are optional on
 * 2S images.  It is deliberately loaded with dlopen() so the base agent can
 * still run on images without those libraries.
 */
#include "libvici_compat.h"
#include "parson.h"

#include <dlfcn.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_TUNNELS 32
#define MAX_TEXT 160
#define MAX_TS 512
#define MAX_OUTPUT 32768

typedef struct {
    char id[MAX_TEXT];
    char name[MAX_TEXT];
    char connection[MAX_TEXT];
    char child[MAX_TEXT];
    char state[32];
    char ike_state[32];
    char child_state[32];
    char ike_version[32];
    char local_host[MAX_TEXT];
    char local_port[16];
    char local_id[MAX_TEXT];
    char remote_host[MAX_TEXT];
    char remote_port[16];
    char remote_id[MAX_TEXT];
    char mode[32];
    char protocol[32];
    char encap[32];
    char encryption[MAX_TEXT];
    char integrity[MAX_TEXT];
    char local_ts[MAX_TS];
    char remote_ts[MAX_TS];
    char uniqueid[32];
    char reqid[32];
    unsigned long long bytes_in;
    unsigned long long bytes_out;
    unsigned long long packets_in;
    unsigned long long packets_out;
    unsigned long long use_in;
    unsigned long long use_out;
    unsigned long long established_seconds;
    unsigned long long installed_seconds;
    unsigned long long rekey_seconds;
    unsigned long long reauth_seconds;
    unsigned long long lifetime_seconds;
    int has_bytes_in;
    int has_bytes_out;
    int has_packets_in;
    int has_packets_out;
    int has_use_in;
    int has_use_out;
    int has_established;
    int has_installed;
    int has_rekey;
    int has_reauth;
    int has_lifetime;
    int configured;
    int active;
} ipsec_tunnel_t;

typedef struct {
    rms_vici_api_t vici;
    ipsec_tunnel_t tunnels[MAX_TUNNELS];
    size_t tunnel_count;
    int parse_error;
} collector_ctx_t;

typedef struct {
    collector_ctx_t *collector;
    char connection[MAX_TEXT];
} config_ctx_t;

typedef struct {
    collector_ctx_t *collector;
    char connection[MAX_TEXT];
    char child_section[MAX_TEXT];
    char name[MAX_TEXT];
    char ike_state[32];
    char child_state[32];
    char ike_version[32];
    char local_host[MAX_TEXT];
    char local_port[16];
    char local_id[MAX_TEXT];
    char remote_host[MAX_TEXT];
    char remote_port[16];
    char remote_id[MAX_TEXT];
    char mode[32];
    char protocol[32];
    char encap[32];
    char encryption[MAX_TEXT];
    char integrity[MAX_TEXT];
    char local_ts[MAX_TS];
    char remote_ts[MAX_TS];
    char uniqueid[32];
    char reqid[32];
    unsigned long long bytes_in;
    unsigned long long bytes_out;
    unsigned long long packets_in;
    unsigned long long packets_out;
    unsigned long long use_in;
    unsigned long long use_out;
    unsigned long long established_seconds;
    unsigned long long installed_seconds;
    unsigned long long rekey_seconds;
    unsigned long long reauth_seconds;
    unsigned long long lifetime_seconds;
    int has_bytes_in;
    int has_bytes_out;
    int has_packets_in;
    int has_packets_out;
    int has_use_in;
    int has_use_out;
    int has_established;
    int has_installed;
    int has_rekey;
    int has_reauth;
    int has_lifetime;
} sa_sample_t;

static void copy_value(char *dst, size_t size, const void *value, int len)
{
    const unsigned char *src = (const unsigned char *)value;
    size_t n;

    if (!dst || !size || !value || len <= 0) {
        if (dst && size) dst[0] = '\0';
        return;
    }
    n = (size_t)len < size - 1 ? (size_t)len : size - 1;
    memcpy(dst, src, n);
    dst[n] = '\0';
}

static unsigned long long value_number(const void *value, int len, int *ok)
{
    char buf[32];
    char *end = NULL;
    unsigned long long number;

    if (!value || len <= 0 || (size_t)len >= sizeof(buf)) {
        if (ok) *ok = 0;
        return 0;
    }
    memcpy(buf, value, (size_t)len);
    buf[len] = '\0';
    errno = 0;
    number = strtoull(buf, &end, 10);
    if (ok) *ok = errno == 0 && end != buf && *end == '\0';
    return number;
}

static void append_list(char *dst, size_t size, const void *value, int len)
{
    size_t used;

    if (!dst || !size || !value || len <= 0) return;
    used = strlen(dst);
    if (used && used + 2 < size) {
        dst[used++] = ',';
        dst[used++] = ' ';
        dst[used] = '\0';
    }
    if (used + 1 < size) {
        size_t remaining = size - used - 1;
        size_t n = (size_t)len < remaining ? (size_t)len : remaining;
        memcpy(dst + used, value, n);
        dst[used + n] = '\0';
    }
}

static int text_is(const char *value, const char *expected)
{
    return value[0] && !strcmp(value, expected);
}

static ipsec_tunnel_t *find_tunnel(collector_ctx_t *ctx,
                                   const char *connection, const char *child)
{
    char id[MAX_TEXT];
    size_t i;

    if (!connection || !child || !connection[0] || !child[0]) return NULL;
    snprintf(id, sizeof(id), "%zu:%s%s", strlen(connection), connection, child);
    for (i = 0; i < ctx->tunnel_count; i++) {
        if (!strcmp(ctx->tunnels[i].id, id)) return &ctx->tunnels[i];
    }
    if (ctx->tunnel_count >= MAX_TUNNELS) return NULL;
    {
        ipsec_tunnel_t *t = &ctx->tunnels[ctx->tunnel_count++];
        memset(t, 0, sizeof(*t));
        snprintf(t->id, sizeof(t->id), "%s", id);
        snprintf(t->connection, sizeof(t->connection), "%s", connection);
        snprintf(t->child, sizeof(t->child), "%s", child);
        snprintf(t->name, sizeof(t->name), "%s / %s", connection, child);
        snprintf(t->state, sizeof(t->state), "DOWN");
        snprintf(t->ike_state, sizeof(t->ike_state), "ABSENT");
        snprintf(t->child_state, sizeof(t->child_state), "ABSENT");
        return t;
    }
}

static void copy_if_present(char *dst, size_t size, const char *src)
{
    if (src && src[0]) snprintf(dst, size, "%s", src);
}

static void copy_sample_to_tunnel(ipsec_tunnel_t *t, const sa_sample_t *ike,
                                  const sa_sample_t *child)
{
    int installed = text_is(child->child_state, "INSTALLED");
    int established = text_is(ike->ike_state, "ESTABLISHED");

    copy_if_present(t->ike_state, sizeof(t->ike_state), ike->ike_state);
    copy_if_present(t->ike_version, sizeof(t->ike_version), ike->ike_version);
    copy_if_present(t->local_host, sizeof(t->local_host), ike->local_host);
    copy_if_present(t->local_port, sizeof(t->local_port), ike->local_port);
    copy_if_present(t->local_id, sizeof(t->local_id), ike->local_id);
    copy_if_present(t->remote_host, sizeof(t->remote_host), ike->remote_host);
    copy_if_present(t->remote_port, sizeof(t->remote_port), ike->remote_port);
    copy_if_present(t->remote_id, sizeof(t->remote_id), ike->remote_id);
    copy_if_present(t->child_state, sizeof(t->child_state), child->child_state);
    copy_if_present(t->mode, sizeof(t->mode), child->mode);
    copy_if_present(t->protocol, sizeof(t->protocol), child->protocol);
    copy_if_present(t->encap, sizeof(t->encap), child->encap);
    copy_if_present(t->encryption, sizeof(t->encryption), child->encryption);
    copy_if_present(t->integrity, sizeof(t->integrity), child->integrity);
    copy_if_present(t->local_ts, sizeof(t->local_ts), child->local_ts);
    copy_if_present(t->remote_ts, sizeof(t->remote_ts), child->remote_ts);
    copy_if_present(t->uniqueid, sizeof(t->uniqueid), ike->uniqueid);
    copy_if_present(t->reqid, sizeof(t->reqid), child->reqid);

    if (child->has_bytes_in) { t->bytes_in = child->bytes_in; t->has_bytes_in = 1; }
    if (child->has_bytes_out) { t->bytes_out = child->bytes_out; t->has_bytes_out = 1; }
    if (child->has_packets_in) { t->packets_in = child->packets_in; t->has_packets_in = 1; }
    if (child->has_packets_out) { t->packets_out = child->packets_out; t->has_packets_out = 1; }
    if (child->has_use_in) { t->use_in = child->use_in; t->has_use_in = 1; }
    if (child->has_use_out) { t->use_out = child->use_out; t->has_use_out = 1; }
    if (child->has_installed) { t->installed_seconds = child->installed_seconds; t->has_installed = 1; }
    if (child->has_rekey) { t->rekey_seconds = child->rekey_seconds; t->has_rekey = 1; }
    if (child->has_lifetime) { t->lifetime_seconds = child->lifetime_seconds; t->has_lifetime = 1; }
    if (ike->has_established) { t->established_seconds = ike->established_seconds; t->has_established = 1; }
    if (ike->has_reauth) { t->reauth_seconds = ike->reauth_seconds; t->has_reauth = 1; }

    snprintf(t->state, sizeof(t->state), "%s", established && installed ? "UP" : "DOWN");
    t->active = 1;
}

static void merge_sample(collector_ctx_t *ctx, const sa_sample_t *ike,
                         const sa_sample_t *child)
{
    ipsec_tunnel_t *t;
    int candidate_up;

    t = find_tunnel(ctx, ike->connection,
                    child->name[0] ? child->name : child->child_section);
    if (!t) return;
    candidate_up = text_is(ike->ike_state, "ESTABLISHED") &&
                  text_is(child->child_state, "INSTALLED");
    /* A rekey can expose two SAs briefly.  Keep an already-installed SA when
     * the second event is not usable, so one transient response cannot turn
     * a healthy tunnel into DOWN. */
    if (t->active && text_is(t->state, "UP") && !candidate_up) return;
    copy_sample_to_tunnel(t, ike, child);
}

static int config_child_section(void *user, vici_res_t *res, char *name)
{
    config_ctx_t *config = (config_ctx_t *)user;
    ipsec_tunnel_t *t = find_tunnel(config->collector, config->connection, name);
    if (t) t->configured = 1;
    /* The child configuration body is not needed for monitoring.  Asking the
     * parser to consume it keeps the VICI response cursor well-defined. */
    return config->collector->vici.parse_cb(res, NULL, NULL, NULL, config);
}

static int config_section(void *user, vici_res_t *res, char *name)
{
    config_ctx_t *config = (config_ctx_t *)user;
    if (!strcmp(name, "children")) {
        return config->collector->vici.parse_cb(res, config_child_section,
                                                NULL, NULL, config);
    }
    return 0;
}

static int config_connection_section(void *user, vici_res_t *res, char *name)
{
    config_ctx_t *config = (config_ctx_t *)user;
    snprintf(config->connection, sizeof(config->connection), "%s", name ? name : "");
    return config->collector->vici.parse_cb(res, config_section, NULL, NULL,
                                            config);
}

static void on_connection(void *user, char *name, vici_res_t *res)
{
    collector_ctx_t *ctx = (collector_ctx_t *)user;
    config_ctx_t config;

    (void)name;
    memset(&config, 0, sizeof(config));
    config.collector = ctx;
    if (ctx->vici.parse_cb(res, config_connection_section, NULL, NULL, &config) != 0)
        ctx->parse_error = 1;
}

static int set_numeric(unsigned long long *dst, int *present,
                       const void *value, int len)
{
    int ok = 0;
    unsigned long long number = value_number(value, len, &ok);
    if (ok) {
        *dst = number;
        *present = 1;
    }
    return 0;
}

static int ike_value(void *user, vici_res_t *res, char *name,
                     void *value, int len)
{
    sa_sample_t *sample = (sa_sample_t *)user;
    (void)res;
    if (!strcmp(name, "state")) copy_value(sample->ike_state, sizeof(sample->ike_state), value, len);
    else if (!strcmp(name, "version")) copy_value(sample->ike_version, sizeof(sample->ike_version), value, len);
    else if (!strcmp(name, "local-host")) copy_value(sample->local_host, sizeof(sample->local_host), value, len);
    else if (!strcmp(name, "local-port")) copy_value(sample->local_port, sizeof(sample->local_port), value, len);
    else if (!strcmp(name, "local-id")) copy_value(sample->local_id, sizeof(sample->local_id), value, len);
    else if (!strcmp(name, "remote-host")) copy_value(sample->remote_host, sizeof(sample->remote_host), value, len);
    else if (!strcmp(name, "remote-port")) copy_value(sample->remote_port, sizeof(sample->remote_port), value, len);
    else if (!strcmp(name, "remote-id")) copy_value(sample->remote_id, sizeof(sample->remote_id), value, len);
    else if (!strcmp(name, "encr-alg")) copy_value(sample->encryption, sizeof(sample->encryption), value, len);
    else if (!strcmp(name, "integ-alg")) copy_value(sample->integrity, sizeof(sample->integrity), value, len);
    else if (!strcmp(name, "uniqueid")) copy_value(sample->uniqueid, sizeof(sample->uniqueid), value, len);
    else if (!strcmp(name, "established")) set_numeric(&sample->established_seconds, &sample->has_established, value, len);
    else if (!strcmp(name, "rekey-time")) set_numeric(&sample->rekey_seconds, &sample->has_rekey, value, len);
    else if (!strcmp(name, "reauth-time")) set_numeric(&sample->reauth_seconds, &sample->has_reauth, value, len);
    else if (!strcmp(name, "life-time")) set_numeric(&sample->lifetime_seconds, &sample->has_lifetime, value, len);
    return 0;
}

static int child_value(void *user, vici_res_t *res, char *name,
                       void *value, int len)
{
    sa_sample_t *sample = (sa_sample_t *)user;
    (void)res;
    if (!strcmp(name, "name")) copy_value(sample->name, sizeof(sample->name), value, len);
    else if (!strcmp(name, "state")) copy_value(sample->child_state, sizeof(sample->child_state), value, len);
    else if (!strcmp(name, "mode")) copy_value(sample->mode, sizeof(sample->mode), value, len);
    else if (!strcmp(name, "protocol")) copy_value(sample->protocol, sizeof(sample->protocol), value, len);
    else if (!strcmp(name, "encap")) copy_value(sample->encap, sizeof(sample->encap), value, len);
    else if (!strcmp(name, "encr-alg")) copy_value(sample->encryption, sizeof(sample->encryption), value, len);
    else if (!strcmp(name, "integ-alg")) copy_value(sample->integrity, sizeof(sample->integrity), value, len);
    else if (!strcmp(name, "uniqueid")) copy_value(sample->uniqueid, sizeof(sample->uniqueid), value, len);
    else if (!strcmp(name, "reqid")) copy_value(sample->reqid, sizeof(sample->reqid), value, len);
    else if (!strcmp(name, "bytes-in")) set_numeric(&sample->bytes_in, &sample->has_bytes_in, value, len);
    else if (!strcmp(name, "bytes-out")) set_numeric(&sample->bytes_out, &sample->has_bytes_out, value, len);
    else if (!strcmp(name, "packets-in")) set_numeric(&sample->packets_in, &sample->has_packets_in, value, len);
    else if (!strcmp(name, "packets-out")) set_numeric(&sample->packets_out, &sample->has_packets_out, value, len);
    else if (!strcmp(name, "use-in")) set_numeric(&sample->use_in, &sample->has_use_in, value, len);
    else if (!strcmp(name, "use-out")) set_numeric(&sample->use_out, &sample->has_use_out, value, len);
    else if (!strcmp(name, "install-time")) set_numeric(&sample->installed_seconds, &sample->has_installed, value, len);
    else if (!strcmp(name, "rekey-time")) set_numeric(&sample->rekey_seconds, &sample->has_rekey, value, len);
    else if (!strcmp(name, "life-time")) set_numeric(&sample->lifetime_seconds, &sample->has_lifetime, value, len);
    return 0;
}

static int child_list(void *user, vici_res_t *res, char *name,
                      void *value, int len)
{
    sa_sample_t *sample = (sa_sample_t *)user;
    (void)res;
    if (!strcmp(name, "local-ts")) append_list(sample->local_ts, sizeof(sample->local_ts), value, len);
    else if (!strcmp(name, "remote-ts")) append_list(sample->remote_ts, sizeof(sample->remote_ts), value, len);
    return 0;
}

static int child_sa_section(void *user, vici_res_t *res, char *name)
{
    sa_sample_t *ike = (sa_sample_t *)user;
    sa_sample_t child;

    memset(&child, 0, sizeof(child));
    child.collector = ike->collector;
    snprintf(child.connection, sizeof(child.connection), "%s", ike->connection);
    snprintf(child.child_section, sizeof(child.child_section), "%s", name ? name : "");
    /* A child-sas section contains each child SA as a nested section. */
    {
        int rc = ike->collector->vici.parse_cb(res, NULL, child_value,
                                               child_list, &child);
        if (rc == 0) merge_sample(ike->collector, ike, &child);
        return rc;
    }
}

static int ike_section(void *user, vici_res_t *res, char *name)
{
    sa_sample_t *ike = (sa_sample_t *)user;
    if (!strcmp(name, "child-sas")) {
        return ike->collector->vici.parse_cb(res, child_sa_section,
                                             NULL, NULL, ike);
    }
    return 0;
}

static int sa_connection_section(void *user, vici_res_t *res, char *name)
{
    collector_ctx_t *ctx = (collector_ctx_t *)user;
    sa_sample_t ike;

    memset(&ike, 0, sizeof(ike));
    ike.collector = ctx;
    snprintf(ike.connection, sizeof(ike.connection), "%s", name ? name : "");
    return ctx->vici.parse_cb(res, ike_section, ike_value, NULL, &ike);
}

static void on_sa(void *user, char *name, vici_res_t *res)
{
    collector_ctx_t *ctx = (collector_ctx_t *)user;

    (void)name;
    if (ctx->vici.parse_cb(res, sa_connection_section, NULL, NULL, ctx) != 0)
        ctx->parse_error = 1;
}

static int load_symbol(void *handle, void **target, const char *name)
{
    void *symbol;
    if (!handle) return -1;
    dlerror();
    symbol = dlsym(handle, name);
    if (!symbol || dlerror()) return -1;
    memcpy(target, &symbol, sizeof(symbol));
    return 0;
}

static void unload_vici(rms_vici_api_t *api);

static int load_vici(rms_vici_api_t *api)
{
    memset(api, 0, sizeof(*api));
    api->strong_handle = dlopen("/usr/lib/ipsec/libstrongswan.so.0",
                                RTLD_NOW | RTLD_GLOBAL);
    api->vici_handle = dlopen("/usr/lib/ipsec/libvici.so.0",
                              RTLD_NOW | RTLD_LOCAL);
    if (!api->vici_handle) return -1;
#define LOAD(member, symbol) \
    if (load_symbol(api->vici_handle, (void **)&api->member, symbol) != 0) { \
        unload_vici(api); \
        return -1; \
    }
    LOAD(init, "vici_init");
    LOAD(deinit, "vici_deinit");
    LOAD(connect, "vici_connect");
    LOAD(disconnect, "vici_disconnect");
    LOAD(register_event, "vici_register");
    LOAD(begin, "vici_begin");
    LOAD(submit, "vici_submit");
    LOAD(free_res, "vici_free_res");
    LOAD(parse_cb, "vici_parse_cb");
#undef LOAD
    return 0;
}

static void unload_vici(rms_vici_api_t *api)
{
    if (api->vici_handle) dlclose(api->vici_handle);
    if (api->strong_handle) dlclose(api->strong_handle);
    memset(api, 0, sizeof(*api));
}

static int emit_error(const char *message)
{
    JSON_Value *value = json_value_init_object();
    JSON_Object *object = json_value_get_object(value);
    char *text;

    json_object_set_string(object, "error", message ? message : "VICI query failed");
    text = json_serialize_to_string(value);
    if (text) {
        puts(text);
        json_free_serialized_string(text);
    }
    json_value_free(value);
    return 2;
}

static void set_text(JSON_Object *object, const char *name, const char *value)
{
    if (value && value[0]) json_object_set_string(object, name, value);
}

static void set_number(JSON_Object *object, const char *name,
                       unsigned long long value, int present)
{
    if (present) json_object_set_number(object, name, (double)value);
}

static JSON_Value *tunnel_json(const ipsec_tunnel_t *t)
{
    JSON_Value *value = json_value_init_object();
    JSON_Object *object = json_value_get_object(value);

    set_text(object, "id", t->id);
    set_text(object, "name", t->name);
    set_text(object, "connection", t->connection);
    set_text(object, "child", t->child);
    set_text(object, "state", t->state);
    set_text(object, "ike_state", t->ike_state);
    set_text(object, "child_state", t->child_state);
    set_text(object, "ike_version", t->ike_version);
    set_text(object, "local_host", t->local_host);
    set_text(object, "local_port", t->local_port);
    set_text(object, "local_id", t->local_id);
    set_text(object, "remote_host", t->remote_host);
    set_text(object, "remote_port", t->remote_port);
    set_text(object, "remote_id", t->remote_id);
    set_text(object, "mode", t->mode);
    set_text(object, "protocol", t->protocol);
    set_text(object, "encap", t->encap);
    set_text(object, "encryption", t->encryption);
    set_text(object, "integrity", t->integrity);
    set_text(object, "local_ts", t->local_ts);
    set_text(object, "remote_ts", t->remote_ts);
    set_text(object, "uniqueid", t->uniqueid);
    set_text(object, "reqid", t->reqid);
    set_number(object, "bytes_in", t->bytes_in, t->has_bytes_in);
    set_number(object, "bytes_out", t->bytes_out, t->has_bytes_out);
    set_number(object, "packets_in", t->packets_in, t->has_packets_in);
    set_number(object, "packets_out", t->packets_out, t->has_packets_out);
    set_number(object, "use_in_seconds", t->use_in, t->has_use_in);
    set_number(object, "use_out_seconds", t->use_out, t->has_use_out);
    set_number(object, "established_seconds", t->established_seconds, t->has_established);
    set_number(object, "installed_seconds", t->installed_seconds, t->has_installed);
    set_number(object, "rekey_seconds", t->rekey_seconds, t->has_rekey);
    set_number(object, "reauth_seconds", t->reauth_seconds, t->has_reauth);
    set_number(object, "lifetime_seconds", t->lifetime_seconds, t->has_lifetime);
    return value;
}

static int collect(void)
{
    collector_ctx_t ctx;
    vici_conn_t *connection;
    vici_req_t *request;
    vici_res_t *response;
    JSON_Value *root;
    JSON_Object *root_object;
    JSON_Array *tunnels;
    char *text;
    size_t i;
    size_t active = 0;

    memset(&ctx, 0, sizeof(ctx));
    if (load_vici(&ctx.vici) != 0) return emit_error("libvici unavailable");
    ctx.vici.init();
    connection = ctx.vici.connect(NULL);
    if (!connection) {
        ctx.vici.deinit();
        unload_vici(&ctx.vici);
        return emit_error("strongSwan VICI socket unavailable");
    }

    if (ctx.vici.register_event(connection, "list-conn", on_connection, &ctx) != 0 ||
        ctx.vici.register_event(connection, "list-sa", on_sa, &ctx) != 0) {
        ctx.vici.disconnect(connection);
        ctx.vici.deinit();
        unload_vici(&ctx.vici);
        return emit_error("strongSwan VICI event registration failed");
    }

    request = ctx.vici.begin("list-conns");
    response = ctx.vici.submit(request, connection);
    if (response) ctx.vici.free_res(response);
    if (!response) {
        ctx.vici.disconnect(connection);
        ctx.vici.deinit();
        unload_vici(&ctx.vici);
        return emit_error("strongSwan list-conns query failed");
    }

    request = ctx.vici.begin("list-sas");
    response = ctx.vici.submit(request, connection);
    if (response) ctx.vici.free_res(response);
    if (!response || ctx.parse_error) {
        ctx.vici.disconnect(connection);
        ctx.vici.deinit();
        unload_vici(&ctx.vici);
        return emit_error("strongSwan list-sas response invalid");
    }

    root = json_value_init_object();
    root_object = json_value_get_object(root);
    json_object_set_string(root_object, "implementation", "strongswan-vici");
    json_object_set_string(root_object, "daemon_state", "running");
    json_object_set_number(root_object, "tunnel_count", (double)ctx.tunnel_count);
    tunnels = json_value_get_array(json_object_get_value(root_object, "tunnels"));
    if (!tunnels) {
        JSON_Value *array = json_value_init_array();
        json_object_set_value(root_object, "tunnels", array);
        tunnels = json_value_get_array(array);
    }
    for (i = 0; i < ctx.tunnel_count; i++) {
        if (ctx.tunnels[i].active && text_is(ctx.tunnels[i].state, "UP")) active++;
        json_array_append_value(tunnels, tunnel_json(&ctx.tunnels[i]));
    }
    json_object_set_number(root_object, "active_tunnel_count", (double)active);
    text = json_serialize_to_string(root);
    if (!text || strlen(text) >= MAX_OUTPUT) {
        if (text) json_free_serialized_string(text);
        json_value_free(root);
        ctx.vici.disconnect(connection);
        ctx.vici.deinit();
        unload_vici(&ctx.vici);
        return emit_error("IPsec collector output exceeded limit");
    }
    puts(text);
    json_free_serialized_string(text);
    json_value_free(root);
    ctx.vici.disconnect(connection);
    ctx.vici.deinit();
    unload_vici(&ctx.vici);
    return 0;
}

int main(void)
{
    return collect();
}
