#include "agent.h"
#include "runtime.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <fcntl.h>
#include <errno.h>
#include <time.h>
#include <openssl/rand.h>
#define CONTROL "/var/run/niseva-rms.sock"
#define STATUS "/var/run/niseva-rms-status.json"
#define WORKER_STATUS "/var/run/niseva-rms-worker.json"
#define RETRY_STATE RMS_PKI_DIR "/retry-state.json"
#define SERVER_LOCK RMS_PKI_DIR "/installation-url"
agent_config_t g_cfg={0};
struct ubus_context *g_ubus=NULL;
struct mosquitto *g_mosq=NULL;
static struct uloop_timeout tick,heartbeat;
static pid_t worker;
static int worker_kind,control_fd=-1,connected,connecting,config_ok,auto_standby;
static time_t worker_deadline,next_pki,next_profiles,next_connect,failure_since,last_success,last_status;
static char error_code[96],registration[32]="not_registered";
static time_t seconds(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec;}
static void stopped(int sig){(void)sig;uloop_end();}
static void persist_retry(void){JSON_Value *v=json_value_init_object();JSON_Object *o=json_value_get_object(v);json_object_set_number(o,"failure_since",failure_since);json_object_set_number(o,"last_success",last_success);json_object_set_boolean(o,"automatic_standby",auto_standby);json_object_set_string(o,"mode",g_cfg.mode);char *b=json_serialize_to_string(v);if(b){rms_write_atomic(RETRY_STATE,b,strlen(b),0600);free(b);}json_value_free(v);}
static unsigned retry_delay(void){unsigned delay;if(!strcmp(g_cfg.mode,"standby")||auto_standby)delay=g_cfg.retry_standby;else delay=failure_since&&time(NULL)-failure_since<(time_t)g_cfg.retry_initial_period?g_cfg.retry_initial:g_cfg.retry_regular;return delay+(rand()%(delay/10+1));}
static void disconnected(struct mosquitto *m,void *obj,int rc){(void)m;(void)obj;(void)rc;connected=connecting=0;if(!failure_since){failure_since=time(NULL);persist_retry();}next_connect=seconds()+retry_delay();snprintf(error_code,sizeof(error_code),"mqtt_disconnected");}
static void on_connect(struct mosquitto *m,void *obj,int rc){(void)obj;connecting=0;if(rc){disconnected(m,obj,rc);return;}connected=1;failure_since=0;auto_standby=0;last_success=time(NULL);persist_retry();strcpy(registration,"claimed");error_code[0]=0;char topic[128];snprintf(topic,sizeof(topic),"rms/v1/devices/%s/commands",g_cfg.device_id);mosquitto_subscribe(m,NULL,topic,1);snprintf(topic,sizeof(topic),"rms/v1/devices/%s/acks",g_cfg.device_id);mosquitto_subscribe(m,NULL,topic,1);send_heartbeat(&heartbeat);}
static void on_message(struct mosquitto *m,void *obj,const struct mosquitto_message *message){(void)m;(void)obj;if(!message||message->payloadlen<1||message->payloadlen>65536)return;char *payload=malloc(message->payloadlen+1);if(!payload)return;memcpy(payload,message->payload,message->payloadlen);payload[message->payloadlen]=0;struct mosquitto_message copy=*message;copy.payload=payload;char topic[128];snprintf(topic,sizeof(topic),"rms/v1/devices/%s/acks",g_cfg.device_id);if(!strcmp(topic,message->topic))handle_telemetry_ack(payload);else handle_mqtt_message(&copy);free(payload);}
int init_mqtt(void){
 if(g_mosq){mosquitto_destroy(g_mosq);g_mosq=NULL;}connected=connecting=0;
 if(!g_cfg.provisioned||!rms_id(g_cfg.device_id)||!g_cfg.mqtt_host[0])return -1;
 g_mosq=mosquitto_new(g_cfg.device_id,true,NULL);if(!g_mosq)return -1;
 int rc=mosquitto_tls_set(g_mosq,RMS_CA_CRT,NULL,RMS_CLIENT_CRT,RMS_CLIENT_KEY,NULL);if(rc){strcpy(error_code,"trust_or_clock_failure");return -1;}
 mosquitto_tls_insecure_set(g_mosq,false);mosquitto_tls_opts_set(g_mosq,1,"tlsv1.2",NULL);mosquitto_max_inflight_messages_set(g_mosq,4);
 mosquitto_connect_callback_set(g_mosq,on_connect);mosquitto_disconnect_callback_set(g_mosq,disconnected);mosquitto_message_callback_set(g_mosq,on_message);
 char topic[128];snprintf(topic,sizeof(topic),"rms/v1/devices/%s/heartbeat",g_cfg.device_id);const char *will="{\"status\":\"offline\"}";mosquitto_will_set(g_mosq,topic,strlen(will),will,1,false);
 rc=mosquitto_connect_async(g_mosq,g_cfg.mqtt_host,g_cfg.mqtt_port,30);connecting=rc==0;next_connect=seconds()+retry_delay();return rc;
}
static void run_worker(int kind){
 unlink(WORKER_STATUS);worker=fork();if(worker==0){setpgid(0,0);for(int fd=3;fd<1024;fd++)close(fd);rms_http_error[0]=0;int rc=kind==1?perform_provision_checkin():rms_sync_profiles();
 JSON_Value *v=json_value_init_object();JSON_Object *o=json_value_get_object(v);json_object_set_string(o,"code",rms_http_error);char *b=json_serialize_to_string(v);if(b){rms_write_atomic(WORKER_STATUS,b,strlen(b),0600);free(b);}json_value_free(v);_exit(rc==0?0:rc==1?2:1);}
 if(worker<0){worker=0;strcpy(error_code,"worker_start_failed");next_pki=seconds()+retry_delay();return;}setpgid(worker,worker);worker_kind=kind;worker_deadline=seconds()+(kind==1?60:600);
}
static void write_status(void){
 JSON_Value *v=json_value_init_object();JSON_Object *o=json_value_get_object(v);time_t now=seconds();int disabled=!strcmp(g_cfg.mode,"disabled");
 json_object_set_string(o,"mode",g_cfg.mode);json_object_set_boolean(o,"automatic_standby",auto_standby);json_object_set_string(o,"effective_mode",auto_standby?"standby":g_cfg.mode);
 json_object_set_string(o,"registration_state",registration);json_object_set_string(o,"connection_state",disabled?"disabled":connected?"connected":(connecting||(worker_kind==1&&worker))?"connecting":"disconnected");
 json_object_set_string(o,"last_error",error_code);json_object_set_string(o,"serial_number",g_cfg.serial);json_object_set_string(o,"lan_mac",g_cfg.mac_address);json_object_set_string(o,"model",g_cfg.model);json_object_set_string(o,"firmware_version",g_cfg.firmware_version);json_object_set_string(o,"agent_version",AGENT_VERSION);json_object_set_string(o,"device_id",g_cfg.device_id);json_object_set_string(o,"organization_name",g_cfg.organization);
 json_object_set_number(o,"last_success",last_success);time_t next=g_cfg.provisioned?next_connect:next_pki;json_object_set_number(o,"next_connection_after",disabled||connected||!config_ok?0:next>now?next-now:0);json_object_set_number(o,"updated_at",time(NULL));json_object_set_boolean(o,"token_configured",g_cfg.enrollment_token[0]!=0);
 char *b=json_serialize_to_string(v);if(b){rms_write_atomic(STATUS,b,strlen(b),0600);free(b);}json_value_free(v);
}
static void on_tick(struct uloop_timeout *t){
 time_t now=seconds();char command[32];if(control_fd>=0&&recv(control_fd,command,sizeof(command),MSG_DONTWAIT)>0&&strcmp(g_cfg.mode,"disabled")&&config_ok){next_pki=next_connect=now;}
 if(config_ok&&strcmp(g_cfg.mode,"disabled")){
 if(!connected&&!failure_since){failure_since=time(NULL);persist_retry();}
 if(!connected&&!auto_standby&&!strcmp(g_cfg.mode,"enabled")&&failure_since&&time(NULL)-failure_since>=(time_t)g_cfg.standby_after){auto_standby=1;next_pki=next_connect=now+retry_delay();persist_retry();}
 if(worker){int status=0;if(now>worker_deadline)kill(-worker,SIGKILL);pid_t w=waitpid(worker,&status,WNOHANG);if(w==worker||(w<0&&errno==ECHILD)){
  int ok=w==worker&&WIFEXITED(status)&&WEXITSTATUS(status)==0;worker=0;
  JSON_Value *v=json_parse_file(WORKER_STATUS);const char *code=json_object_get_string(json_value_get_object(v),"code");if(!ok)snprintf(error_code,sizeof(error_code),"%s",code&&*code?code:"worker_failed");json_value_free(v);unlink(WORKER_STATUS);
  if(worker_kind==1){if(!strcmp(error_code,"not_registered")||!strcmp(error_code,"awaiting_claim")||!strcmp(error_code,"revoked"))snprintf(registration,sizeof(registration),"%s",error_code);
   next_pki=now+(ok?3600:retry_delay());if(ok){config_ok=load_config()==0;strcpy(registration,"claimed");error_code[0]=0;if(config_ok)init_mqtt();next_profiles=0;}}
  else next_profiles=now+300;
 }}
 if(!worker){if(now>=next_pki){if(!g_cfg.provisioned||rms_cert_due())run_worker(1);else next_pki=now+3600;}else if(g_cfg.provisioned&&now>=next_profiles)run_worker(2);}
 if(g_mosq){int rc=mosquitto_loop(g_mosq,0,10);if(rc!=MOSQ_ERR_SUCCESS&&connected)disconnected(g_mosq,NULL,rc);
  if(!connected&&now>=next_connect){rc=mosquitto_reconnect_async(g_mosq);connecting=rc==0;next_connect=now+retry_delay();if(rc)strcpy(error_code,"mqtt_connection_failed");}
  if(connected)telemetry_queue_flush_pending();}
 rms_collect_tick();check_reverse_tunnel();
 }
 if(now!=last_status){write_status();last_status=now;}uloop_timeout_set(t,50);
}
static unsigned number(struct uci_context *ctx,struct uci_section *sec,const char *key,unsigned fallback,unsigned minimum,unsigned maximum){const char *v=uci_lookup_option_string(ctx,sec,key);if(!v)return fallback;char *end;unsigned long n=strtoul(v,&end,10);if(!*v||*end||n<minimum||n>maximum){config_ok=0;return fallback;}return n;}
int load_config(void){
 struct uci_context *ctx=uci_alloc_context();struct uci_package *pkg=NULL;if(!ctx||uci_load(ctx,"niseva",&pkg)!=UCI_OK){if(ctx)uci_free_context(ctx);strcpy(error_code,"configuration_unavailable");return -1;}
 struct uci_section *sec=uci_lookup_section(ctx,pkg,"general");if(!sec){uci_free_context(ctx);return -1;}config_ok=1;
 const char *mode=uci_lookup_option_string(ctx,sec,"mode"),*legacy=uci_lookup_option_string(ctx,sec,"enabled");snprintf(g_cfg.mode,sizeof(g_cfg.mode),"%s",mode?mode:legacy&&!strcmp(legacy,"0")?"disabled":"enabled");
 if(strcmp(g_cfg.mode,"disabled")&&strcmp(g_cfg.mode,"enabled")&&strcmp(g_cfg.mode,"standby"))config_ok=0;
 #define GET(field,key) do{const char *v=uci_lookup_option_string(ctx,sec,key);snprintf(g_cfg.field,sizeof(g_cfg.field),"%s",v?v:"");}while(0)
 GET(device_id,"device_id");GET(enrollment_token,"enrollment_token");GET(mqtt_host,"mqtt_host");GET(organization,"organization_name");
 const char *kind=uci_lookup_option_string(ctx,sec,"server"),*old=uci_lookup_option_string(ctx,sec,"server_url");
 if(!kind&&old&&*old)snprintf(g_cfg.server_url,sizeof(g_cfg.server_url),"%s",old);else{
  const char *hostname=uci_lookup_option_string(ctx,sec,kind&&!strcmp(kind,"custom")?"hostname":"hosted_hostname");if(!hostname)hostname="xnet-rms-test.duckdns.org";
  unsigned port=number(ctx,sec,kind&&!strcmp(kind,"custom")?"port":"hosted_port",8445,1,65535);
  if(!*hostname||strspn(hostname,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-")!=strlen(hostname)||strlen(hostname)>100)config_ok=0;
  snprintf(g_cfg.server_url,sizeof(g_cfg.server_url),"https://%s:%u",hostname,port);
 }
 g_cfg.mqtt_port=number(ctx,sec,"mqtt_port",8883,1,65535);g_cfg.heartbeat_interval=number(ctx,sec,"heartbeat_interval",60,10,60);
 g_cfg.retry_initial=number(ctx,sec,"retry_initial",120,10,86400);g_cfg.retry_initial_period=number(ctx,sec,"retry_initial_period",3600,10,2592000);g_cfg.retry_regular=number(ctx,sec,"retry_regular",300,10,86400);g_cfg.retry_standby=number(ctx,sec,"retry_standby",21600,10,2592000);g_cfg.standby_after=number(ctx,sec,"standby_after",1209600,60,31536000);
 int migrate=mode==NULL;uci_free_context(ctx);if(migrate)save_config_option("general","mode",g_cfg.mode);
 if(strncmp(g_cfg.server_url,"https://",8))config_ok=0;
 if(rms_id(g_cfg.device_id)){
  char locked[128]={0};FILE *f=fopen(SERVER_LOCK,"r");if(f){fgets(locked,sizeof(locked),f);fclose(f);if(strcmp(locked,g_cfg.server_url)){strcpy(error_code,"reprovisioning_required");return -1;}}
  else if(rms_write_atomic(SERVER_LOCK,g_cfg.server_url,strlen(g_cfg.server_url),0600)){strcpy(error_code,"installation_lock_failed");return -1;}
 }
 g_cfg.provisioned=rms_id(g_cfg.device_id)&&access(RMS_CLIENT_CRT,F_OK)==0&&rms_cert_due()!=2;
 if(!config_ok){strcpy(error_code,"invalid_configuration");return -1;}return 0;
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

    int rc=uci_set(ctx,&ptr);
    if(rc==UCI_OK)rc=uci_commit(ctx,&ptr.p,false);
    uci_free_context(ctx);
    return rc==UCI_OK?0:-1;
}

int main(int argc,char **argv){
 if(argc==2&&!strcmp(argv[1],"--status")){FILE *f=fopen(STATUS,"r");if(!f){puts("{\"connection_state\":\"disconnected\",\"last_error\":\"agent_not_running\"}");return 0;}char b[4096];size_t n;while((n=fread(b,1,sizeof(b),f)))fwrite(b,1,n,stdout);fclose(f);return 0;}
 if(argc==2&&!strcmp(argv[1],"--connect")){int fd=socket(AF_UNIX,SOCK_DGRAM,0);struct sockaddr_un a={.sun_family=AF_UNIX};strcpy(a.sun_path,CONTROL);int rc=fd<0?-1:sendto(fd,"connect",7,0,(struct sockaddr*)&a,sizeof(a));if(fd>=0)close(fd);return rc<0?1:0;}
 if(argc!=1)return 1;
 umask(0077);signal(SIGPIPE,SIG_IGN);signal(SIGINT,stopped);signal(SIGTERM,stopped);unsigned seed=0;if(RAND_bytes((unsigned char*)&seed,sizeof(seed))!=1)return 1;srand(seed);
 // Application polling owns all child exit statuses, including collectors and tunnel workers.
 uloop_handle_sigchld=false;uloop_init();mosquitto_lib_init();telemetry_queue_init();detect_board_hardware();config_ok=load_config()==0;
 JSON_Value *v=json_parse_file(RETRY_STATE);JSON_Object *o=json_value_get_object(v);const char *saved=json_object_get_string(o,"mode");last_success=json_object_get_number(o,"last_success");if(saved&&!strcmp(saved,g_cfg.mode)){failure_since=json_object_get_number(o,"failure_since");auto_standby=json_object_get_boolean(o,"automatic_standby")==1;}json_value_free(v);
 if(rms_id(g_cfg.device_id))strcpy(registration,"claimed");
 control_fd=socket(AF_UNIX,SOCK_DGRAM,0);if(control_fd<0)return 1;struct sockaddr_un a={.sun_family=AF_UNIX};strcpy(a.sun_path,CONTROL);unlink(CONTROL);if(bind(control_fd,(struct sockaddr*)&a,sizeof(a))<0)return 1;fcntl(control_fd,F_SETFL,O_NONBLOCK);
 heartbeat.cb=send_heartbeat;tick.cb=on_tick;next_pki=seconds()+rand()%15;next_connect=seconds();if(config_ok&&strcmp(g_cfg.mode,"disabled")&&g_cfg.provisioned)init_mqtt();uloop_timeout_set(&tick,100);uloop_timeout_set(&heartbeat,1000);uloop_run();
 if(worker>0){kill(-worker,SIGKILL);waitpid(worker,NULL,0);}rms_collect_stop();close_reverse_tunnel();if(g_mosq){mosquitto_disconnect(g_mosq);mosquitto_destroy(g_mosq);}close(control_fd);unlink(CONTROL);unlink(STATUS);mosquitto_lib_cleanup();uloop_done();return 0;
}
