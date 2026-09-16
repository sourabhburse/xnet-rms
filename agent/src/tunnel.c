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
#include <syslog.h>
#include <sys/mount.h>

#define RMS_SSH_RAM_DIR "/tmp/rms-ssh"
#define RMS_SSH_RAM_KEYS "/tmp/rms-ssh/authorized_keys"
#define DROPBEAR_AUTH_KEYS "/etc/dropbear/authorized_keys"

int rms_tunnel_worker(const char *,const char *,const char *,int,int);
static pid_t tunnel_pid=0;
static struct uloop_timeout ttl;
static int running;
static int s_mounted=0;
static int s_created_dropbear_keys=0;
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
    if (mkdir(RMS_SSH_RAM_DIR, 0700) != 0 && errno != EEXIST) {
        syslog(LOG_ERR, "niseva tunnel: cannot create temporary key directory: %s", strerror(errno));
        return -1;
    }
    if (chmod(RMS_SSH_RAM_DIR, 0700) != 0) {
        syslog(LOG_ERR, "niseva tunnel: cannot protect temporary key directory: %s", strerror(errno));
        return -1;
    }

    /* mount(2) requires the bind target to exist. Dropbear does not create
     * authorized_keys on images that use password-only login, which used to
     * make every SSH_LUCI/TERMINAL_SSH command fail before the worker could
     * even reach the gateway. Remember whether the target exists, then create
     * only an empty temporary target immediately before the bind; this keeps
     * all earlier failure paths free of filesystem leftovers. */
    struct stat target;
    int target_exists = 1;
    if (lstat(DROPBEAR_AUTH_KEYS, &target) != 0) {
        if (errno != ENOENT) {
            syslog(LOG_ERR, "niseva tunnel: cannot inspect %s: %s", DROPBEAR_AUTH_KEYS, strerror(errno));
            rms_ssh_cleanup_key();
            return -1;
        }
        target_exists = 0;
    } else if (!S_ISREG(target.st_mode)) {
        syslog(LOG_ERR, "niseva tunnel: refusing non-regular %s", DROPBEAR_AUTH_KEYS);
        rms_ssh_cleanup_key();
        return -1;
    }

    char tmp[256];
    snprintf(tmp, sizeof(tmp), "%s/authorized_keys.tmp", RMS_SSH_RAM_DIR);
    int fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) {
        syslog(LOG_ERR, "niseva tunnel: cannot open temporary authorized_keys: %s", strerror(errno));
        return -1;
    }

    // Preserve existing permanent authorized_keys if present
    int orig_fd = target_exists ? open(DROPBEAR_AUTH_KEYS, O_RDONLY) : -1;
    if (orig_fd >= 0) {
        char buf[512];
        ssize_t n;
        while ((n = read(orig_fd, buf, sizeof(buf))) > 0) {
            if (write_all(fd, buf, (size_t)n) != 0) {
                syslog(LOG_ERR, "niseva tunnel: cannot copy permanent authorized_keys: %s", strerror(errno));
                close(orig_fd);
                close(fd);
                unlink(tmp);
                return -1;
            }
        }
        close(orig_fd);
        if (n < 0 || write_all(fd, "\n", 1) != 0) {
            syslog(LOG_ERR, "niseva tunnel: cannot finish permanent authorized_keys copy: %s", strerror(errno));
            close(fd);
            unlink(tmp);
            return -1;
        }
    }

    size_t len = strlen(pubkey);
    if (write_all(fd, pubkey, len) != 0 || write_all(fd, "\n", 1) != 0) {
        syslog(LOG_ERR, "niseva tunnel: cannot write session authorized_keys: %s", strerror(errno));
        close(fd);
        unlink(tmp);
        return -1;
    }
    fsync(fd);
    close(fd);
    if (rename(tmp, RMS_SSH_RAM_KEYS) != 0) {
        syslog(LOG_ERR, "niseva tunnel: cannot publish temporary authorized_keys: %s", strerror(errno));
        unlink(tmp);
        return -1;
    }

    if (!target_exists) {
        int target_fd = open(DROPBEAR_AUTH_KEYS, O_WRONLY | O_CREAT | O_EXCL, 0600);
        if (target_fd < 0) {
            syslog(LOG_ERR, "niseva tunnel: cannot create %s: %s", DROPBEAR_AUTH_KEYS, strerror(errno));
            rms_ssh_cleanup_key();
            return -1;
        }
        close(target_fd);
        s_created_dropbear_keys = 1;
    }

    if (mount(RMS_SSH_RAM_KEYS, DROPBEAR_AUTH_KEYS, NULL, MS_BIND, NULL) != 0) {
        syslog(LOG_ERR, "niseva tunnel: cannot bind temporary authorized_keys over %s: %s", DROPBEAR_AUTH_KEYS, strerror(errno));
        rms_ssh_cleanup_key();
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
    if (s_created_dropbear_keys) {
        if (unlink(DROPBEAR_AUTH_KEYS) != 0 && errno != ENOENT)
            syslog(LOG_ERR, "niseva tunnel: cannot remove temporary %s: %s", DROPBEAR_AUTH_KEYS, strerror(errno));
        s_created_dropbear_keys = 0;
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
        syslog(LOG_ERR, "niseva tunnel: cannot create worker control pipe: %s", strerror(errno));
        rms_ssh_cleanup_key();
        return -1;
    }
    pid_t pid=fork();
    if(pid<0) {
        syslog(LOG_ERR, "niseva tunnel: cannot start worker: %s", strerror(errno));
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
    if(!running||tunnel_pid<=0||control_pipe[1]<0||!rms_id(id)||strcmp(active_session_id,id)!=0||seconds<1||seconds>RMS_SESSION_EXTEND_MAX_SECS)return -1;
    /* The worker may have exited between the MQTT callback and the main-loop
     * reap. Do not let a closed control pipe terminate the agent with SIGPIPE. */
    signal(SIGPIPE,SIG_IGN);
    /* Control pipe carries a single fixed-width payload: the new deadline as
     * a raw int64_t, so the worker never has to buffer/parse a text line. */
    int64_t deadline=(int64_t)(time(NULL)+seconds);
    ssize_t sent;
    do { sent=write(control_pipe[1],&deadline,sizeof(deadline)); } while(sent<0&&errno==EINTR);
    if(sent!=(ssize_t)sizeof(deadline))return -1;
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
