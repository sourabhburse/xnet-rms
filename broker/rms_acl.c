#include <mosquitto.h>
#include <mosquitto_broker.h>
#include <mosquitto_plugin.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

static mosquitto_plugin_id_t *plugin;
static char revoked_dir[1024];
static int identity(const char *id) {
    if (!id || strlen(id) != 32) return 0;
    return strspn(id, "0123456789abcdef") == 32;
}
/* Username comes exclusively from the verified certificate, never client ID. */
static int check(int event, void *data, void *unused) {
    (void)event; (void)unused;
    struct mosquitto_evt_acl_check *e = data;
    const char *id = mosquitto_client_username(e->client);
    if (!id || !e->topic) return MOSQ_ERR_ACL_DENIED;
    if (!strcmp(id,"rms-core"))
        return !strncmp(e->topic,"rms/v1/devices/",15) ? MOSQ_ERR_SUCCESS : MOSQ_ERR_ACL_DENIED;
    if (!identity(id)) return MOSQ_ERR_ACL_DENIED;
    char path[1100], prefix[64]; struct stat st;
    snprintf(path,sizeof(path),"%s/%s",revoked_dir,id);
    if (!stat(path,&st) || errno != ENOENT) return MOSQ_ERR_ACL_DENIED;
    snprintf(prefix,sizeof(prefix),"rms/v1/devices/%s/",id);
    if (strncmp(e->topic,prefix,strlen(prefix))) return MOSQ_ERR_ACL_DENIED;
    const char *leaf=e->topic+strlen(prefix);
    if (e->access == MOSQ_ACL_WRITE && !e->retain && e->payloadlen<=65536 &&
        (!strcmp(leaf,"snapshots") || !strcmp(leaf,"heartbeat"))) return MOSQ_ERR_SUCCESS;
    if ((e->access == MOSQ_ACL_READ || e->access == MOSQ_ACL_SUBSCRIBE) &&
        (!strcmp(leaf,"acks") || !strcmp(leaf,"commands"))) return MOSQ_ERR_SUCCESS;
    return MOSQ_ERR_ACL_DENIED;
}
int mosquitto_plugin_version(int n, const int *versions) {
    for(int i=0;i<n;i++) if(versions[i]==5) return 5;
    return -1;
}
int mosquitto_plugin_init(mosquitto_plugin_id_t *id, void **user, struct mosquitto_opt *opts,int n) {
    (void)user;
    for(int i=0;i<n;i++) if(!strcmp(opts[i].key,"revoked_dir")) {
        if(strlen(opts[i].value)>=sizeof(revoked_dir)) return MOSQ_ERR_INVAL;
        strcpy(revoked_dir,opts[i].value);
    }
    struct stat st;
    if(revoked_dir[0]!='/' || stat(revoked_dir,&st) || !S_ISDIR(st.st_mode)) return MOSQ_ERR_INVAL;
    plugin=id;
    return mosquitto_callback_register(id,MOSQ_EVT_ACL_CHECK,check,NULL,NULL);
}
int mosquitto_plugin_cleanup(void *u,struct mosquitto_opt *o,int n) {
    (void)u;(void)o;(void)n;
    return mosquitto_callback_unregister(plugin,MOSQ_EVT_ACL_CHECK,check,NULL);
}
