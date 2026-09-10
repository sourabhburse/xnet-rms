#include "agent.h"
#include "runtime.h"
#include <unistd.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <sys/mount.h>

#define RMS_SSH_RAM_DIR "/tmp/rms-ssh"
#define RMS_SSH_RAM_KEYS "/tmp/rms-ssh/authorized_keys"
#define DROPBEAR_AUTH_KEYS "/etc/dropbear/authorized_keys"

int rms_tunnel_worker(const char *,const char *,const char *,int,int);
static pid_t tunnel_pid=0;
static struct uloop_timeout ttl;
static int running;
static int s_mounted=0;
static char active_session_id[33];
static int control_pipe[2]={-1,-1};

static int write_all(int fd, const void *data, size_t len) {
    const char *p = data;
    while (len > 0) {
        ssize_t n = write(fd, p, len);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return -1;
        p += n;
        len -= (size_t)n;
    }
    return 0;
}

int rms_ssh_inject_key(const char *session_id, const char *pubkey) {
    if (!rms_id(session_id) || !pubkey || strlen(pubkey) > 1024) return -1;
    if (mkdir(RMS_SSH_RAM_DIR, 0700) != 0 && errno != EEXIST) return -1;
    if (chmod(RMS_SSH_RAM_DIR, 0700) != 0) return -1;

    char tmp[256];
    snprintf(tmp, sizeof(tmp), "%s/authorized_keys.tmp", RMS_SSH_RAM_DIR);
    int fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) return -1;

    // Preserve existing permanent authorized_keys if present
    int orig_fd = open(DROPBEAR_AUTH_KEYS, O_RDONLY);
    if (orig_fd >= 0) {
        char buf[512];
        ssize_t n;
        while ((n = read(orig_fd, buf, sizeof(buf))) > 0) {
            if (write_all(fd, buf, (size_t)n) != 0) {
                close(orig_fd);
                close(fd);
                unlink(tmp);
                return -1;
            }
        }
        close(orig_fd);
        if (n < 0 || write_all(fd, "\n", 1) != 0) {
            close(fd);
            unlink(tmp);
            return -1;
        }
    }

    size_t len = strlen(pubkey);
    if (write_all(fd, pubkey, len) != 0 || write_all(fd, "\n", 1) != 0) {
        close(fd);
        unlink(tmp);
        return -1;
    }
    fsync(fd);
    close(fd);
    if (rename(tmp, RMS_SSH_RAM_KEYS) != 0) {
        unlink(tmp);
        return -1;
    }

    if (mount(RMS_SSH_RAM_KEYS, DROPBEAR_AUTH_KEYS, NULL, MS_BIND, NULL) != 0) {
        unlink(RMS_SSH_RAM_KEYS);
        rmdir(RMS_SSH_RAM_DIR);
        return -1;
    }
    s_mounted = 1;
    return 0;
}

void rms_ssh_cleanup_key(void) {
    if (s_mounted) {
        umount2(DROPBEAR_AUTH_KEYS, MNT_DETACH);
        s_mounted = 0;
    }
    unlink(RMS_SSH_RAM_KEYS);
    rmdir(RMS_SSH_RAM_DIR);
}

static void expire(struct uloop_timeout *t){
    (void)t;
    rms_ssh_cleanup_key();
    if(running&&tunnel_pid>0)kill(tunnel_pid,SIGTERM);
}

int open_reverse_tunnel(const char *id,const char *protocol,const char *url,int seconds, const char *public_key){
    /* A worker can finish between main-loop iterations. Reap it before
     * deciding whether the router is still busy so the next session can
     * start immediately after the browser closes. */
    check_reverse_tunnel();
    if(running||!rms_id(id)||seconds<1||seconds>900)return -1;
    if(!strcmp(protocol, "TERMINAL_SSH") || !strcmp(protocol, "SSH_LUCI")) {
        if (!public_key || rms_ssh_inject_key(id, public_key) != 0) return -1;
    }
    if (pipe(control_pipe) != 0) {
        rms_ssh_cleanup_key();
        return -1;
    }
    pid_t pid=fork();
    if(pid<0) {
        close(control_pipe[0]);
        close(control_pipe[1]);
        control_pipe[0]=control_pipe[1]=-1;
        rms_ssh_cleanup_key();
        return -1;
    }
    if(pid==0){
        close(control_pipe[1]);
        for(int fd=3;fd<1024;fd++)if(fd!=control_pipe[0])close(fd);
        _exit(rms_tunnel_worker(id,protocol,url,seconds,control_pipe[0])==0?0:1);
    }
    close(control_pipe[0]);
    control_pipe[0]=-1;
    tunnel_pid=pid;
    running=1;
    snprintf(active_session_id,sizeof(active_session_id),"%s",id);
    ttl.cb=expire;
    uloop_timeout_set(&ttl,seconds*1000);
    return 0;
}

int extend_reverse_tunnel_session(const char *id,int seconds){
    if(!running||tunnel_pid<=0||control_pipe[1]<0||!rms_id(id)||strcmp(active_session_id,id)!=0||seconds<1||seconds>3600)return -1;
    /* The worker may have exited between the MQTT callback and the main-loop
     * reap. Do not let a closed control pipe terminate the agent with SIGPIPE. */
    signal(SIGPIPE,SIG_IGN);
    char message[64];
    time_t deadline=time(NULL)+seconds;
    int n=snprintf(message,sizeof(message),"EXTEND %lld\n",(long long)deadline);
    if(n<0||n>=(int)sizeof(message))return -1;
    ssize_t sent;
    do { sent=write(control_pipe[1],message,(size_t)n); } while(sent<0&&errno==EINTR);
    if(sent!=n)return -1;
    uloop_timeout_set(&ttl,seconds*1000);
    return 0;
}

void check_reverse_tunnel(void){
    if(running&&tunnel_pid>0){
        int st;
        pid_t w=waitpid(tunnel_pid,&st,WNOHANG);
        if(w==tunnel_pid||(w<0&&errno==ECHILD)){
            tunnel_pid=0;
            running=0;
            active_session_id[0]=0;
            uloop_timeout_cancel(&ttl);
            if(control_pipe[1]>=0)close(control_pipe[1]);
            control_pipe[0]=control_pipe[1]=-1;
            rms_ssh_cleanup_key();
        }
    }
}

void close_reverse_tunnel(void){
    if(running){
        if(tunnel_pid>0){
            kill(tunnel_pid,SIGTERM);
            waitpid(tunnel_pid,NULL,0);
            tunnel_pid=0;
        }
        running=0;
    }
    if(control_pipe[1]>=0)close(control_pipe[1]);
    if(control_pipe[0]>=0)close(control_pipe[0]);
    control_pipe[0]=control_pipe[1]=-1;
    active_session_id[0]=0;
    uloop_timeout_cancel(&ttl);
    rms_ssh_cleanup_key();
}

int close_reverse_tunnel_session(const char *session_id){
    if (!rms_id(session_id) || !running || strcmp(active_session_id, session_id) != 0)
        return -1;
    close_reverse_tunnel();
    return 0;
}
