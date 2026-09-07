#include "agent.h"
#include "runtime.h"
#include <string.h>
#include <time.h>
#include <stdio.h>
void handle_mqtt_message(const struct mosquitto_message *msg){
 char topic[128];snprintf(topic,sizeof(topic),"rms/v1/devices/%s/commands",g_cfg.device_id);
 if(strcmp(topic,msg->topic))return;
 JSON_Value *v=json_parse_string(msg->payload);JSON_Object *o=json_value_get_object(v);
 const char *action=json_object_get_string(o,"action");
  if(action&&!strcmp(action,"open_session")){
   const char *id=json_object_get_string(o,"session_id"),*protocol=json_object_get_string(o,"protocol"),*url=json_object_get_string(o,"gateway_url");
   const char *pubkey=json_object_get_string(o,"public_key");
   double exp=json_object_get_number(o,"expires_at");time_t now=time(NULL);
   if(rms_id(id)&&protocol&&url&&!strncmp(url,"https://",8)&&exp>now&&exp<=now+900&&(strcmp(protocol,"HTTP_LUCI")==0||strcmp(protocol,"TERMINAL_SSH")==0))open_reverse_tunnel(id,protocol,url,(int)(exp-now),pubkey);
  }
 json_value_free(v);
}
