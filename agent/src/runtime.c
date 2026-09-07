#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "agent.h"
#include "runtime.h"
#include <curl/curl.h>
#include <openssl/rand.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <poll.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <time.h>
struct response {char *data;size_t len,limit;};
static size_t receive(void *p,size_t a,size_t b,void *arg){struct response *r=arg;size_t n=a*b;if(n>r->limit-r->len)return 0;char *next=realloc(r->data,r->len+n+1);if(!next)return 0;r->data=next;memcpy(r->data+r->len,p,n);r->len+=n;r->data[r->len]=0;return n;}
char rms_http_error[96];
char *rms_http(const char *url,const char *body,int client,size_t limit){rms_http_error[0]=0;if(strncmp(url,"https://",8)){strcpy(rms_http_error,"invalid_server");return NULL;}CURL *c=curl_easy_init();if(!c)return NULL;struct response r={NULL,0,limit};struct curl_slist *h=curl_slist_append(NULL,"Content-Type: application/json");curl_easy_setopt(c,CURLOPT_URL,url);curl_easy_setopt(c,CURLOPT_PROTOCOLS,CURLPROTO_HTTPS);curl_easy_setopt(c,CURLOPT_SSL_VERIFYPEER,1L);curl_easy_setopt(c,CURLOPT_SSL_VERIFYHOST,2L);curl_easy_setopt(c,CURLOPT_CAINFO,RMS_CA_CRT);curl_easy_setopt(c,CURLOPT_NOSIGNAL,1L);curl_easy_setopt(c,CURLOPT_CONNECTTIMEOUT,5L);curl_easy_setopt(c,CURLOPT_TIMEOUT,15L);curl_easy_setopt(c,CURLOPT_WRITEFUNCTION,receive);curl_easy_setopt(c,CURLOPT_WRITEDATA,&r);curl_easy_setopt(c,CURLOPT_HTTPHEADER,h);if(client){curl_easy_setopt(c,CURLOPT_SSLCERT,RMS_CLIENT_CRT);curl_easy_setopt(c,CURLOPT_SSLKEY,RMS_CLIENT_KEY);}if(body)curl_easy_setopt(c,CURLOPT_POSTFIELDS,body);CURLcode rc=curl_easy_perform(c);long status=0;curl_easy_getinfo(c,CURLINFO_RESPONSE_CODE,&status);curl_easy_cleanup(c);curl_slist_free_all(h);if(rc!=CURLE_OK||status<200||status>=300){
const char *code=rc==CURLE_PEER_FAILED_VERIFICATION?"trust_or_clock_failure":rc!=CURLE_OK?"network_failure":"temporarily_unavailable";
JSON_Value *v=r.data?json_parse_string(r.data):NULL;const char *remote=json_object_get_string(json_value_get_object(v),"code");
if(rc==CURLE_OK&&remote&&strlen(remote)<sizeof(rms_http_error))code=remote;
snprintf(rms_http_error,sizeof(rms_http_error),"%s",code);json_value_free(v);free(r.data);return NULL;}return r.data?r.data:strdup("");}
int rms_write_atomic(const char *path,const void *data,size_t len,mode_t mode){char tmp[512];if(snprintf(tmp,sizeof(tmp),"%s.XXXXXX",path)>=(int)sizeof(tmp))return -1;int fd=mkstemp(tmp);if(fd<0)return -1;int rc=fchmod(fd,mode);const char *p=data;while(rc==0&&len){ssize_t n=write(fd,p,len);if(n<0&&errno==EINTR)continue;if(n<=0){rc=-1;break;}p+=n;len-=n;}if(rc==0)rc=fsync(fd);if(close(fd)&&rc==0)rc=-1;if(rc==0)rc=rename(tmp,path);if(rc)unlink(tmp);return rc;}
static int64_t milliseconds(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (int64_t)t.tv_sec*1000+t.tv_nsec/1000000;}
char *rms_capture(char *const argv[],int timeout,size_t limit,int *status){*status=-1;int fds[2];if(pipe(fds))return NULL;pid_t pid=fork();if(pid<0){close(fds[0]);close(fds[1]);return NULL;}if(pid==0){setpgid(0,0);dup2(fds[1],1);int null=open("/dev/null",O_RDWR);if(null>=0){dup2(null,0);dup2(null,2);}for(int i=3;i<1024;i++)close(i);execv(argv[0],argv);_exit(127);}setpgid(pid,pid);close(fds[1]);fcntl(fds[0],F_SETFL,O_NONBLOCK);char *buf=malloc(limit+1);if(!buf){kill(-pid,SIGKILL);waitpid(pid,NULL,0);close(fds[0]);return NULL;}size_t used=0;int64_t deadline=milliseconds()+timeout*1000;int exitcode=0,ended=0,failed=0;for(;;){char chunk[4096];ssize_t n=read(fds[0],chunk,sizeof(chunk));if(n>0){if((size_t)n>limit-used){failed=1;break;}memcpy(buf+used,chunk,n);used+=n;continue;}if(n==0)break;if(errno!=EAGAIN&&errno!=EINTR){failed=1;break;}if(milliseconds()>=deadline){failed=1;break;}struct pollfd f={fds[0],POLLIN,0};poll(&f,1,50);}close(fds[0]);while(!failed){pid_t w=waitpid(pid,&exitcode,WNOHANG);if(w==pid){ended=1;break;}if(w<0&&errno==ECHILD){ended=1;exitcode=0;break;}if(w<0||milliseconds()>=deadline){failed=1;break;}usleep(10000);}kill(-pid,SIGKILL);if(!ended)while(waitpid(pid,&exitcode,0)<0&&errno==EINTR){}if(failed){free(buf);return NULL;}*status=WIFEXITED(exitcode)?WEXITSTATUS(exitcode):-1;buf[used]=0;return buf;}
int rms_id(const char *s){if(!s||strlen(s)!=32)return 0;for(int i=0;i<32;i++)if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return 0;return 1;}
void rms_random_id(char out[33]){unsigned char b[16];if(RAND_bytes(b,16)!=1)abort();for(int i=0;i<16;i++)sprintf(out+i*2,"%02x",b[i]);out[32]=0;}
