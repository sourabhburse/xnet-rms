/*
 * The public libvici declarations used by the optional IPsec collector.
 *
 * This is intentionally a small ABI-compatible subset of the MIT-licensed
 * strongSwan 5.8.0 src/libcharon/plugins/vici/libvici.h header.  The agent
 * loads libvici at runtime, so the base package does not need strongSwan
 * development headers or a link-time dependency on libstrongswan.
 */
#ifndef NISEVA_LIBVICI_COMPAT_H
#define NISEVA_LIBVICI_COMPAT_H

typedef struct vici_conn_t vici_conn_t;
typedef struct vici_req_t vici_req_t;
typedef struct vici_res_t vici_res_t;

typedef void (*vici_event_cb_t)(void *user, char *name, vici_res_t *msg);
typedef int (*vici_parse_value_cb_t)(void *user, vici_res_t *res,
                                     char *name, void *value, int len);
typedef int (*vici_parse_section_cb_t)(void *user, vici_res_t *res,
                                       char *name);

typedef struct {
    void *strong_handle;
    void *vici_handle;
    void (*init)(void);
    void (*deinit)(void);
    vici_conn_t *(*connect)(char *uri);
    void (*disconnect)(vici_conn_t *conn);
    int (*register_event)(vici_conn_t *conn, char *name,
                          vici_event_cb_t cb, void *user);
    vici_req_t *(*begin)(char *name);
    vici_res_t *(*submit)(vici_req_t *req, vici_conn_t *conn);
    void (*free_res)(vici_res_t *res);
    int (*parse_cb)(vici_res_t *res, vici_parse_section_cb_t section,
                    vici_parse_value_cb_t kv, vici_parse_value_cb_t li,
                    void *user);
} rms_vici_api_t;

#endif
