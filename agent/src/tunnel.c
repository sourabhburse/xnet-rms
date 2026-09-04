#include "agent.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <netdb.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <signal.h>
#include <errno.h>

struct tunnel_bridge {
    struct uloop_fd local_fd;
    struct uloop_fd remote_fd;
    char token[64];
    bool active;
    bool handshake_complete;
    pid_t child_pid;
    bool is_pty;
    uint8_t pending_buf[4096];
    size_t pending_len;
};

static struct tunnel_bridge g_active_tunnel = {0};
static struct uloop_timeout g_tunnel_ttl_timer;

static void tunnel_ttl_expired(struct uloop_timeout *t) {
    (void)t;
    printf("[TUNNEL] ⏰ Tunnel TTL expired. Auto-terminating session on router.\n");
    close_reverse_tunnel();
}

void close_reverse_tunnel(void) {
    uloop_timeout_cancel(&g_tunnel_ttl_timer);

    if (g_active_tunnel.local_fd.fd > 0) {
        uloop_fd_delete(&g_active_tunnel.local_fd);
        close(g_active_tunnel.local_fd.fd);
        g_active_tunnel.local_fd.fd = -1;
    }
    if (g_active_tunnel.remote_fd.fd > 0) {
        uloop_fd_delete(&g_active_tunnel.remote_fd);
        close(g_active_tunnel.remote_fd.fd);
        g_active_tunnel.remote_fd.fd = -1;
    }

    if (g_active_tunnel.is_pty && g_active_tunnel.child_pid > 0) {
        printf("[TUNNEL] Terminating child shell PID %d\n", g_active_tunnel.child_pid);
        kill(g_active_tunnel.child_pid, SIGHUP);
        kill(g_active_tunnel.child_pid, SIGTERM);
        waitpid(g_active_tunnel.child_pid, NULL, WNOHANG);
        g_active_tunnel.child_pid = 0;
        g_active_tunnel.is_pty = false;
    }

    g_active_tunnel.active = false;
    g_active_tunnel.handshake_complete = false;
    g_active_tunnel.pending_len = 0;
    printf("[TUNNEL] Reverse tunnel session terminated on router.\n");
}

// RFC 6455 Client-to-Server Masked WebSocket Frame Transmitter
static void ws_send_frame(int fd, const uint8_t *data, size_t len, uint8_t opcode) {
    if (fd <= 0 || len == 0) return;

    uint8_t header[10];
    size_t header_len = 0;

    // Byte 0: FIN = 1 (0x80) | Opcode
    header[0] = 0x80 | (opcode & 0x0F);

    // Byte 1+: Client frames MUST be masked (0x80 | length)
    if (len <= 125) {
        header[1] = 0x80 | (uint8_t)len;
        header_len = 2;
    } else if (len <= 65535) {
        header[1] = 0x80 | 126;
        header[2] = (uint8_t)((len >> 8) & 0xFF);
        header[3] = (uint8_t)(len & 0xFF);
        header_len = 4;
    } else {
        return; // Buffer size capped at 4096
    }

    // 4-byte random masking key
    uint8_t mask[4];
    mask[0] = (uint8_t)rand();
    mask[1] = (uint8_t)rand();
    mask[2] = (uint8_t)rand();
    mask[3] = (uint8_t)rand();

    memcpy(header + header_len, mask, 4);
    header_len += 4;

    // Send header
    write(fd, header, header_len);

    // Mask payload and send
    uint8_t masked_payload[4096];
    size_t send_len = len > sizeof(masked_payload) ? sizeof(masked_payload) : len;
    for (size_t i = 0; i < send_len; i++) {
        masked_payload[i] = data[i] ^ mask[i % 4];
    }
    write(fd, masked_payload, send_len);
}

// RFC 6455 Server-to-Client WebSocket Frame Parser
static void ws_parse_server_data(int local_fd, const uint8_t *buf, size_t len) {
    size_t offset = 0;
    while (offset + 2 <= len) {
        uint8_t b0 = buf[offset];
        uint8_t b1 = buf[offset + 1];
        uint8_t opcode = b0 & 0x0F;
        bool masked = (b1 & 0x80) != 0;
        size_t payload_len = b1 & 0x7F;
        size_t hdr_size = 2;

        if (payload_len == 126) {
            if (offset + 4 > len) break;
            payload_len = ((size_t)buf[offset + 2] << 8) | buf[offset + 3];
            hdr_size = 4;
        } else if (payload_len == 127) {
            if (offset + 10 > len) break;
            hdr_size = 10;
            payload_len = ((size_t)buf[offset + 6] << 24) |
                          ((size_t)buf[offset + 7] << 16) |
                          ((size_t)buf[offset + 8] << 8) |
                          buf[offset + 9];
        }

        uint8_t mask[4] = {0};
        if (masked) {
            if (offset + hdr_size + 4 > len) break;
            memcpy(mask, buf + offset + hdr_size, 4);
            hdr_size += 4;
        }

        if (offset + hdr_size + payload_len > len) {
            payload_len = len - (offset + hdr_size);
        }

        const uint8_t *payload = buf + offset + hdr_size;

        if (opcode == 0x08) {
            // Close frame
            printf("[TUNNEL] Received WebSocket Close frame from Cloud.\n");
            close_reverse_tunnel();
            return;
        } else if (opcode == 0x09) {
            // Ping frame -> reply with Pong (0x8A)
            uint8_t pong[2] = {0x8A, 0x00};
            write(g_active_tunnel.remote_fd.fd, pong, 2);
        } else if (opcode == 0x01 || opcode == 0x02 || opcode == 0x00) {
            // Binary or Text data payload
            if (local_fd > 0 && payload_len > 0) {
                if (masked) {
                    uint8_t unmasked[4096];
                    for (size_t i = 0; i < payload_len && i < sizeof(unmasked); i++) {
                        unmasked[i] = payload[i] ^ mask[i % 4];
                    }
                    write(local_fd, unmasked, payload_len);
                } else {
                    write(local_fd, payload, payload_len);
                }
            }
        }

        offset += hdr_size + payload_len;
        if (offset >= len) break;
    }
}

static void local_read_cb(struct uloop_fd *u, unsigned int events) {
    (void)events;
    uint8_t buf[4096];
    ssize_t n = read(u->fd, buf, sizeof(buf));
    if (n > 0) {
        if (g_active_tunnel.remote_fd.fd > 0 && g_active_tunnel.handshake_complete) {
            // Frame local data into WebSocket binary frame (0x02)
            ws_send_frame(g_active_tunnel.remote_fd.fd, buf, (size_t)n, 0x02);
        } else if (g_active_tunnel.remote_fd.fd > 0 && !g_active_tunnel.handshake_complete) {
            // Buffer early output until cloud handshake completes
            size_t available = sizeof(g_active_tunnel.pending_buf) - g_active_tunnel.pending_len;
            size_t to_copy = (size_t)n < available ? (size_t)n : available;
            if (to_copy > 0) {
                memcpy(g_active_tunnel.pending_buf + g_active_tunnel.pending_len, buf, to_copy);
                g_active_tunnel.pending_len += to_copy;
            }
        }
    } else if (n < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) {
            return;
        }
        printf("[TUNNEL] Local fd error (%s). Closing tunnel.\n", strerror(errno));
        close_reverse_tunnel();
    } else {
        printf("[TUNNEL] Local fd closed (EOF). Closing tunnel.\n");
        close_reverse_tunnel();
    }
}

static void remote_read_cb(struct uloop_fd *u, unsigned int events) {
    (void)events;
    uint8_t buf[4096];
    ssize_t n = read(u->fd, buf, sizeof(buf));
    if (n <= 0) {
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR)) {
            return;
        }
        close_reverse_tunnel();
        return;
    }

    // 1. If handshake is pending, verify HTTP/1.1 101 Switching Protocols
    if (!g_active_tunnel.handshake_complete) {
        buf[n < (ssize_t)sizeof(buf) ? n : (ssize_t)sizeof(buf) - 1] = '\0';
        char *end_of_header = strstr((char *)buf, "\r\n\r\n");
        if (end_of_header) {
            g_active_tunnel.handshake_complete = true;
            printf("[TUNNEL] ✅ WebSocket handshake confirmed (HTTP 101 Switching Protocols).\n");

            // Flush any buffered pending local data
            if (g_active_tunnel.pending_len > 0) {
                ws_send_frame(g_active_tunnel.remote_fd.fd, g_active_tunnel.pending_buf, g_active_tunnel.pending_len, 0x02);
                g_active_tunnel.pending_len = 0;
            }

            size_t header_len = (size_t)(end_of_header + 4 - (char *)buf);
            if ((size_t)n > header_len) {
                // Forward any trailing data frame
                ws_parse_server_data(g_active_tunnel.local_fd.fd, buf + header_len, (size_t)n - header_len);
            }
            return;
        }
        return;
    }

    // 2. Parse WebSocket frames and write payload to local service
    ws_parse_server_data(g_active_tunnel.local_fd.fd, buf, (size_t)n);
}

static int connect_tcp(const char *host, int port) {
    struct hostent *he = gethostbyname(host);
    if (!he) return -1;

    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s < 0) return -1;

    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    memcpy(&addr.sin_addr, he->h_addr_list[0], he->h_length);

    if (connect(s, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        close(s);
        return -1;
    }
    return s;
}

static int spawn_pty_shell(pid_t *out_pid) {
    int master_fd = posix_openpt(O_RDWR | O_NOCTTY);
    if (master_fd < 0) {
        fprintf(stderr, "[TUNNEL] posix_openpt failed: %s\n", strerror(errno));
        return -1;
    }

    if (grantpt(master_fd) != 0) {
        fprintf(stderr, "[TUNNEL] grantpt failed: %s\n", strerror(errno));
        close(master_fd);
        return -1;
    }

    if (unlockpt(master_fd) != 0) {
        fprintf(stderr, "[TUNNEL] unlockpt failed: %s\n", strerror(errno));
        close(master_fd);
        return -1;
    }

    char *pts_name = ptsname(master_fd);
    if (!pts_name) {
        fprintf(stderr, "[TUNNEL] ptsname failed: %s\n", strerror(errno));
        close(master_fd);
        return -1;
    }

    struct winsize ws;
    memset(&ws, 0, sizeof(ws));
    ws.ws_col = 120;
    ws.ws_row = 30;
    ioctl(master_fd, TIOCSWINSZ, &ws);

    pid_t pid = fork();
    if (pid < 0) {
        fprintf(stderr, "[TUNNEL] fork failed: %s\n", strerror(errno));
        close(master_fd);
        return -1;
    }

    if (pid == 0) {
        // In child process
        close(master_fd);
        setsid();

        int slave_fd = open(pts_name, O_RDWR);
        if (slave_fd < 0) {
            _exit(1);
        }

#ifdef TIOCSCTTY
        ioctl(slave_fd, TIOCSCTTY, 0);
#endif

        dup2(slave_fd, STDIN_FILENO);
        dup2(slave_fd, STDOUT_FILENO);
        dup2(slave_fd, STDERR_FILENO);
        if (slave_fd > STDERR_FILENO) {
            close(slave_fd);
        }

        if (g_active_tunnel.remote_fd.fd > 0) {
            close(g_active_tunnel.remote_fd.fd);
        }

        setenv("TERM", "xterm-256color", 1);
        setenv("HOME", "/root", 1);
        setenv("USER", "root", 1);
        setenv("SHELL", "/bin/ash", 1);
        setenv("PATH", "/usr/sbin:/usr/bin:/sbin:/bin", 1);
        if (chdir("/root") != 0) {
            chdir("/");
        }

        execl("/bin/ash", "-ash", (char *)NULL);
        execl("/bin/ash", "ash", "-l", (char *)NULL);
        execl("/bin/sh", "-sh", (char *)NULL);
        _exit(1);
    }

    *out_pid = pid;

    int flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    return master_fd;
}

int open_reverse_tunnel(const char *token, const char *target_host, int target_port, const char *protocol, int ttl_seconds) {
    if (g_active_tunnel.active) {
        close_reverse_tunnel();
    }

    int cloud_port = 8090;
    char *port_ptr = strrchr(g_cfg.server_url, ':');
    if (port_ptr && atoi(port_ptr + 1) > 0) {
        cloud_port = atoi(port_ptr + 1);
    }

    bool is_pty = (strcmp(protocol, "TERMINAL_SSH") == 0 ||
                   strcmp(protocol, "TERMINAL") == 0 ||
                   strcmp(protocol, "SHELL") == 0);

    printf("[TUNNEL] Opening on-demand reverse tunnel for token %s\n", token);
    printf("[TUNNEL] Protocol: %s (PTY=%s) | Target: %s:%d | Cloud: %s:%d | TTL: %d seconds\n",
           protocol, is_pty ? "YES" : "NO", target_host, target_port, g_cfg.mqtt_host, cloud_port, ttl_seconds > 0 ? ttl_seconds : 1800);

    // 1. Connect or spawn local target
    int local_sock = -1;
    pid_t child_pid = 0;

    if (is_pty) {
        local_sock = spawn_pty_shell(&child_pid);
        if (local_sock < 0) {
            fprintf(stderr, "[TUNNEL] Failed to spawn pseudo-terminal shell\n");
            return -1;
        }
        printf("[TUNNEL] ✅ PTY shell spawned (PID %d)\n", child_pid);
    } else {
        local_sock = connect_tcp(target_host, target_port);
        if (local_sock < 0) {
            fprintf(stderr, "[TUNNEL] Failed to connect to local target %s:%d\n", target_host, target_port);
            return -1;
        }
    }

    // 2. Connect outbound to cloud tunnel inlet
    int remote_sock = connect_tcp(g_cfg.mqtt_host, cloud_port);
    if (remote_sock < 0) {
        fprintf(stderr, "[TUNNEL] Failed to connect to cloud gateway %s:%d\n", g_cfg.mqtt_host, cloud_port);
        close(local_sock);
        if (is_pty && child_pid > 0) {
            kill(child_pid, SIGTERM);
            waitpid(child_pid, NULL, WNOHANG);
        }
        return -1;
    }

    // 3. Send WebSocket handshake HTTP header
    char handshake[512];
    snprintf(handshake, sizeof(handshake),
        "GET /tunnel-inlet/%s HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n",
        token, g_cfg.mqtt_host, cloud_port
    );
    write(remote_sock, handshake, strlen(handshake));

    // 4. Register file descriptors in OpenWrt uloop
    g_active_tunnel.local_fd.fd = local_sock;
    g_active_tunnel.local_fd.cb = local_read_cb;
    uloop_fd_add(&g_active_tunnel.local_fd, ULOOP_READ);

    g_active_tunnel.remote_fd.fd = remote_sock;
    g_active_tunnel.remote_fd.cb = remote_read_cb;
    uloop_fd_add(&g_active_tunnel.remote_fd, ULOOP_READ);

    g_active_tunnel.active = true;
    g_active_tunnel.handshake_complete = false;
    g_active_tunnel.child_pid = child_pid;
    g_active_tunnel.is_pty = is_pty;
    g_active_tunnel.pending_len = 0;
    strncpy(g_active_tunnel.token, token, sizeof(g_active_tunnel.token) - 1);

    // 5. Arm On-Demand TTL Auto-Close Watchdog
    g_tunnel_ttl_timer.cb = tunnel_ttl_expired;
    int timeout_sec = (ttl_seconds > 0) ? ttl_seconds : 1800; // default 30 min
    uloop_timeout_set(&g_tunnel_ttl_timer, timeout_sec * 1000);

    printf("[TUNNEL] ✅ Reverse tunnel established non-blockingly via OpenWrt uloop. Auto-close watchdog armed for %ds.\n", timeout_sec);
    return 0;
}
