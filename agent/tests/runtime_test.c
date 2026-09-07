#include "agent.h"
#include "runtime.h"
#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <sys/stat.h>

extern size_t telemetry_queue_bytes(void);

struct mosquitto *g_mosq = NULL;
agent_config_t g_cfg = {0};
int rms_tunnel_worker(const char *a, const char *b, const char *c, int d) { (void)a;(void)b;(void)c;(void)d; return 0; }
int uloop_timeout_set(struct uloop_timeout *t, int ms) { (void)t; (void)ms; return 0; }
int uloop_timeout_cancel(struct uloop_timeout *t) { (void)t; return 0; }
void rms_collect_tick(void) {}

static void test_ram_ssh_keys(void) {
    const char *sess_id = "4f039a3e5d91c928936204d11cd3fcca";
    const char *pubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI1234567890 rms-session-4f039a3e5d91c928936204d11cd3fcca";
    assert(rms_ssh_inject_key(sess_id, pubkey) == 0);
    struct stat st;
    assert(stat("/tmp/rms-ssh/authorized_keys", &st) == 0);
    assert((st.st_mode & 0777) == 0600);
    FILE *f = fopen("/tmp/rms-ssh/authorized_keys", "r");
    assert(f != NULL);
    char line[512];
    char *res = fgets(line, sizeof(line), f);
    assert(res != NULL);
    assert(strstr(line, "rms-session-4f039a3e5d91c928936204d11cd3fcca") != NULL);
    fclose(f);
    rms_ssh_cleanup_key();
    assert(access("/tmp/rms-ssh/authorized_keys", F_OK) != 0);
    puts("RAM SSH key injection and cleanup verified");
}

int main(void) {
    telemetry_queue_init();
    char *payload=malloc(65537);memset(payload,'x',65536);payload[65536]=0;
    const char *boot="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    for(int i=1;i<=80;i++) {assert(!telemetry_queue_push("test",payload,65536,boot,"source",i));assert(telemetry_queue_bytes()<=MAX_TELEMETRY_BACKLOG_BYTES);}
    assert(telemetry_get_dropped_count()>0);
    size_t before=telemetry_queue_bytes();telemetry_queue_ack("other","source",80);assert(before==telemetry_queue_bytes());
    telemetry_queue_ack(boot,"source",80);assert(telemetry_queue_bytes()<before);
    assert(!telemetry_queue_push("test","{}",2,boot,"source",81));
    for(int i=1;i<=81;i++)telemetry_queue_ack(boot,"source",i);
    assert(telemetry_queue_bytes()==0);free(payload);
    char *ok[]={"/bin/sh","-c","printf '{\"value\":42}'",NULL};int status;
    char *out=rms_capture(ok,1,1024,&status);assert(out&&status==0&&!strcmp(out,"{\"value\":42}"));free(out);
    char *hung[]={"/bin/sh","-c","sleep 10",NULL};assert(rms_capture(hung,1,1024,&status)==NULL);
    char *large[]={"/bin/sh","-c","printf 123456789",NULL};assert(rms_capture(large,1,4,&status)==NULL);
    char *unsupported[]={"/bin/sh","-c","printf '{}';exit 2",NULL};out=rms_capture(unsupported,1,1024,&status);assert(out&&status==2);free(out);
    assert(!rms_http("http://unverified.example",NULL,0,1024));
    char id[33];rms_random_id(id);assert(rms_id(id));assert(!rms_id("invalid"));
    test_ram_ssh_keys();
    puts("agent queue bounds, exact ACKs, child timeout, output limits and HTTPS-only checks passed");
    return 0;
}
