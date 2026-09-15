#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "agent.h"
#include "runtime.h"
#include <openssl/ssl.h>
#include <openssl/sha.h>
#include <openssl/rand.h>
#include <openssl/x509v3.h>
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <errno.h>
#include <signal.h>
#include <netdb.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <sys/prctl.h>
#include <sys/ioctl.h>
#include <termios.h>
static volatile sig_atomic_t stopped;

static void stop(int sig)
{
    (void)sig;
    stopped = 1;
}

static char *encode(const void *data, size_t n)
{
    char *s = malloc(4 * ((n + 2) / 3) + 1);
    if (s)
        s[EVP_EncodeBlock((unsigned char *)s, data, n)] = 0;
    return s;
}

static unsigned char *decode(const char *s, size_t *n)
{
    if (!s)
    {
        *n = 0;
        return calloc(1, 1);
    }
    size_t z = strlen(s);
    if (z % 4 || z > 1500000)
        return NULL;
    unsigned char *b = malloc(z + 1);
    if (!b)
        return NULL;
    int size = EVP_DecodeBlock(b, (const unsigned char *)s, z);
    if (size < 0)
    {
        free(b);
        return NULL;
    }
    if (z && s[z - 1] == '=')
        size--;
    if (z > 1 && s[z - 2] == '=')
        size--;
    *n = size;
    return b;
}

static int tcp(const char *host, const char *port)
{
    struct addrinfo hints = {0}, *list = NULL;
    hints.ai_socktype = SOCK_STREAM;
    if (getaddrinfo(host, port, &hints, &list))
        return -1;
    int fd = -1;
    for (struct addrinfo *p = list; p; p = p->ai_next)
    {
        fd = socket(p->ai_family, p->ai_socktype, p->ai_protocol);
        if (fd < 0)
            continue;
        fcntl(fd, F_SETFL, O_NONBLOCK);
        int rc = connect(fd, p->ai_addr, p->ai_addrlen);
        if (rc && errno == EINPROGRESS)
        {
            struct pollfd f = {fd, POLLOUT, 0};
            rc = poll(&f, 1, 5000) > 0 ? 0 : -1;
            if (rc == 0)
            {
                int error = 0;
                socklen_t size = sizeof(error);
                getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size);
                if (error)
                    rc = -1;
            }
        }
        if (rc == 0)
        {
            fcntl(fd, F_SETFL, 0);
            struct timeval t = {5, 0};
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &t, sizeof(t));
            setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &t, sizeof(t));
            break;
        }
        close(fd);
        fd = -1;
    }
    freeaddrinfo(list);
    return fd;
}

static int transfer(SSL *ssl, void *buf, size_t len, int write_mode)
{
    unsigned char *p = buf;
    while (len && !stopped)
    {
        int n = write_mode ? SSL_write(ssl, p, len > 16384 ? 16384 : len) : SSL_read(ssl, p, len > 16384 ? 16384 : len);
        if (n <= 0)
            return -1;
        p += n;
        len -= n;
    }
    return len ? -1 : 0;
}


static int send_frame(SSL *ssl, const void *data, size_t len, unsigned opcode)
{
    if (len > 2 * 1024 * 1024)
        return -1;
    unsigned char header[14], mask[4];
    size_t n = 2;
    header[0] = 0x80 | opcode;
    if (len < 126)
        header[1] = 0x80 | len;
    else if (len < 65536)
    {
        header[1] = 0xfe;
        header[2] = len >> 8;
        header[3] = len;
        n = 4;
    }
    else
    {
        header[1] = 0xff;
        for (int i = 0; i < 8; i++)
            header[2 + i] = (uint64_t)len >> (56 - i * 8);
        n = 10;
    }
    if (RAND_bytes(mask, 4) != 1)
        return -1;
    memcpy(header + n, mask, 4);
    n += 4;
    if (transfer(ssl, header, n, 1))
        return -1;
    const unsigned char *p = data;
    for (size_t off = 0; off < len;)
    {
        unsigned char b[4096];
        size_t z = len - off < sizeof(b) ? len - off : sizeof(b);
        for (size_t i = 0; i < z; i++)
            b[i] = p[off + i] ^ mask[(off + i) % 4];
        if (transfer(ssl, b, z, 1))
            return -1;
        off += z;
    }
    return 0;
}


static char *read_message(SSL *ssl, size_t *length)
{
    char *out = NULL;
    size_t used = 0;
    int started = 0;
    for (;;)
    {
        unsigned char h[10];
        if (transfer(ssl, h, 2, 0))
            break;
        int fin = h[0] & 0x80, op = h[0] & 15;
        if ((h[0] & 0x70) || (h[1] & 0x80))
            break;
        uint64_t n = h[1] & 127;
        if (n == 126)
        {
            if (transfer(ssl, h + 2, 2, 0))
                break;
            n = ((uint64_t)h[2] << 8) | h[3];
        }
        else if (n == 127)
        {
            if (transfer(ssl, h + 2, 8, 0))
                break;
            n = 0;
            for (int i = 2; i < 10; i++)
                n = (n << 8) | h[i];
        }
        if (op >= 8)
        {
            if (!fin || n > 125)
                break;
            unsigned char control[125];
            if (transfer(ssl, control, n, 0))
                break;
            if (op == 8)
                break;
            if (op == 9 && send_frame(ssl, control, n, 10))
                break;
            if (op != 9 && op != 10)
                break;
            continue;
        }
        if (n > 512 * 1024 - used || (!started && op != 1 && op != 2) || (started && op != 0))
            break;
        char *next = realloc(out, used + n + 1);
        if (!next)
            break;
        out = next;
        if (transfer(ssl, out + used, n, 0))
            break;
        used += n;
        out[used] = 0;
        started = 1;
        if (fin)
        {
            *length = used;
            return out;
        }
    }
    free(out);
    return NULL;
}
struct http_result
{
    unsigned char *data;
    size_t size;
    JSON_Object *headers;
};
static size_t receive_body(void *data, size_t a, size_t b, void *arg)
{
    size_t n = a * b;
    struct http_result *r = arg;
    if (n > 1024 * 1024 - r->size)
        return 0;
    unsigned char *p = realloc(r->data, r->size + n + 1);
    if (!p)
        return 0;
    r->data = p;
    memcpy(p + r->size, data, n);
    r->size += n;
    return n;
}
static size_t receive_header(void *data, size_t a, size_t b, void *arg)
{
    size_t n = a * b;
    struct http_result *r = arg;
    if (n > 4096)
        return 0;
    char line[4097];
    memcpy(line, data, n);
    line[n] = 0;
    char *colon = strchr(line, ':');
    if (colon)
    {
        *colon++ = 0;
        while (*colon == ' ')
            colon++;
        colon[strcspn(colon, "\r\n")] = 0;
        if (!strcasecmp(line, "Content-Type") || !strcasecmp(line, "Location") || !strcasecmp(line, "Set-Cookie") || !strcasecmp(line, "Cache-Control") || !strcasecmp(line, "Content-Disposition"))
            json_object_set_string(r->headers, line, colon);
    }
    return n;
}
static int proxy(SSL *ssl, const char *text)
{
    JSON_Value *request = json_parse_string(text);
    JSON_Object *o = json_value_get_object(request);
    const char *path = json_object_get_string(o, "path"), *method = json_object_get_string(o, "method");
    if (!path || path[0] != '/' || path[1] == '/' || strchr(path, '\r') || strchr(path, '\n') || strlen(path) > 4096 || !method || strspn(method, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") != strlen(method) || strlen(method) > 16)
    {
        json_value_free(request);
        return -1;
    }
    size_t bodylen;
    unsigned char *body = decode(json_object_get_string(o, "body"), &bodylen);
    if (!body)
    {
        json_value_free(request);
        return -1;
    }
    CURL *c = curl_easy_init();
    if (!c)
    {
        free(body);
        json_value_free(request);
        return -1;
    }
    JSON_Value *response = json_value_init_object(), *headers = json_value_init_object();
    struct http_result result = {NULL, 0, json_value_get_object(headers)};
    char url[4352];
    snprintf(url, sizeof(url), "http://127.0.0.1%s", path);
    curl_easy_setopt(c, CURLOPT_URL, url);
    curl_easy_setopt(c, CURLOPT_CUSTOMREQUEST, method);
    curl_easy_setopt(c, CURLOPT_PROXY, "");
    curl_easy_setopt(c, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(c, CURLOPT_TIMEOUT, 10L);
    curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT, 2L);
    curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(c, CURLOPT_PROTOCOLS, CURLPROTO_HTTP);
    curl_easy_setopt(c, CURLOPT_POSTFIELDS, body);
    curl_easy_setopt(c, CURLOPT_POSTFIELDSIZE, (long)bodylen);
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, receive_body);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &result);
    curl_easy_setopt(c, CURLOPT_HEADERFUNCTION, receive_header);
    curl_easy_setopt(c, CURLOPT_HEADERDATA, &result);
    JSON_Object *input_headers = json_object_get_object(o, "headers");
    const char *request_cookie = json_object_get_string(input_headers, "Cookie");
    if (!request_cookie)
        request_cookie = json_object_get_string(input_headers, "cookie");
    if (request_cookie && strlen(request_cookie) < 4096 && !strpbrk(request_cookie, "\r\n"))
        curl_easy_setopt(c, CURLOPT_COOKIE, request_cookie);
    const char *allowed[] = {"Content-Type", "Accept", "Accept-Language", "User-Agent", "Referer", "Origin", "X-Requested-With", "X-CSRF-Token"};
    struct curl_slist *list = NULL;
    for (int i = 0; i < 8; i++)
    {
        const char *value = json_object_get_string(input_headers, allowed[i]);
        if (value && strlen(value) < 2048 && !strchr(value, '\r') && !strchr(value, '\n'))
        {
            char line[2112];
            snprintf(line, sizeof(line), "%s: %s", allowed[i], value);
            list = curl_slist_append(list, line);
        }
    }
    curl_easy_setopt(c, CURLOPT_HTTPHEADER, list);
    CURLcode rc = curl_easy_perform(c);
    long status = 502;
    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &status);
    if (rc != CURLE_OK)
        status = 502;
    curl_easy_cleanup(c);
    curl_slist_free_all(list);
    free(body);
    json_value_free(request);
    char *b64 = encode(result.data ? result.data : (unsigned char *)"", result.size);
    free(result.data);
    o = json_value_get_object(response);
    json_object_set_number(o, "status", status);
    json_object_set_value(o, "headers", headers);
    json_object_set_string(o, "body", b64 ? b64 : "");
    free(b64);
    char *payload = json_serialize_to_string(response);
    json_value_free(response);
    int sent = payload ? send_frame(ssl, payload, strlen(payload), 1) : -1;
    free(payload);
    return sent;
}
int rms_tunnel_worker(const char *id, const char *protocol, const char *url, int ttl, int control_fd)
{
    signal(SIGTERM, stop);
    signal(SIGINT, stop);
    signal(SIGHUP, stop);
    prctl(PR_SET_PDEATHSIG, SIGTERM);
    if (getppid() == 1)
        return -1;
    stopped = 0;
    char host[256], port[8] = "9443";
    if (strncmp(url, "https://", 8) || strlen(url + 8) >= sizeof(host))
        return -1;
    strcpy(host, url + 8);
    char *colon = strrchr(host, ':');
    if (colon)
    {
        *colon++ = 0;
        if (!*colon || strspn(colon, "0123456789") != strlen(colon) || strlen(colon) >= sizeof(port))
            return -1;
        strcpy(port, colon);
    }
    if (!*host || strpbrk(host, "/\\@ \r\n"))
        return -1;
    int fd = tcp(host, port), dropbear_fd = -1, result = -1;
    SSL_CTX *ctx = NULL;
    SSL *ssl = NULL;
    if (fd < 0)
        return -1;
    ctx = SSL_CTX_new(TLS_client_method());
    if (!ctx)
        goto done;
    SSL_CTX_set_min_proto_version(ctx, TLS1_2_VERSION);
    SSL_CTX_set_verify(ctx, SSL_VERIFY_PEER, NULL);
    if (SSL_CTX_load_verify_locations(ctx, RMS_CA_CRT, NULL) != 1 || SSL_CTX_use_certificate_file(ctx, RMS_CLIENT_CRT, SSL_FILETYPE_PEM) != 1 || SSL_CTX_use_PrivateKey_file(ctx, RMS_CLIENT_KEY, SSL_FILETYPE_PEM) != 1 || SSL_CTX_check_private_key(ctx) != 1)
        goto done;
    ssl = SSL_new(ctx);
    if (!ssl)
        goto done;
    SSL_set_fd(ssl, fd);
    SSL_set_tlsext_host_name(ssl, host);
    unsigned char ip[16];
    X509_VERIFY_PARAM *param = SSL_get0_param(ssl);
    if (inet_pton(AF_INET, host, ip) == 1)
    {
        if (X509_VERIFY_PARAM_set1_ip_asc(param, host) != 1)
            goto done;
    }
    else if (X509_VERIFY_PARAM_set1_host(param, host, 0) != 1)
        goto done;
    if (SSL_connect(ssl) != 1 || SSL_get_verify_result(ssl) != X509_V_OK)
        goto done;
    unsigned char nonce[16], hash[20];
    if (RAND_bytes(nonce, sizeof(nonce)) != 1)
        goto done;
    char *key = encode(nonce, sizeof(nonce));
    char handshake[1024], combined[128];
    snprintf(handshake, sizeof(handshake), "GET /router/%s HTTP/1.1\r\nHost: %s:%s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n", id, host, port, key);
    snprintf(combined, sizeof(combined), "%s258EAFA5-E914-47DA-95CA-C5AB0DC85B11", key);
    free(key);
    SHA1((unsigned char *)combined, strlen(combined), hash);
    char *accept = encode(hash, sizeof(hash));
    if (transfer(ssl, handshake, strlen(handshake), 1))
    {
        free(accept);
        goto done;
    }
    char response[4096] = {0};
    size_t n = 0;
    while (n < sizeof(response) - 1)
    {
        if (transfer(ssl, response + n, 1, 0))
        {
            free(accept);
            goto done;
        }
        n++;
        response[n] = 0;
        if (n >= 4 && !strcmp(response + n - 4, "\r\n\r\n"))
            break;
    }
    char expected[128];
    snprintf(expected, sizeof(expected), "Sec-WebSocket-Accept: %s\r\n", accept);
    free(accept);
    if (strncmp(response, "HTTP/1.1 101 ", 13) || !strcasestr(response, expected))
        goto done;
    int terminal = !strcmp(protocol, "TERMINAL_SSH") || !strcmp(protocol, "SSH_LUCI");
    if (terminal)
    {
        dropbear_fd = tcp("127.0.0.1", "22");
        if (dropbear_fd < 0)
            goto done;
    }
    time_t end = time(NULL) + ttl;
    char control[128];
    size_t control_used = 0;
    while (!stopped && time(NULL) < end)
    {
        struct pollfd f[3] = {{fd, POLLIN, 0}, {dropbear_fd, POLLIN, 0}, {control_fd, POLLIN, 0}};
        int count = control_fd >= 0 ? 3 : (terminal ? 2 : 1);
        int ready = SSL_pending(ssl) ? 1 : poll(f, count, 1000);
        if (ready < 0)
        {
            if (errno == EINTR)
                continue;
            break;
        }
        if (control_fd >= 0 && f[2].revents)
        {
            ssize_t n = read(control_fd, control + control_used, sizeof(control) - control_used - 1);
            if (n <= 0)
            {
                stopped = 1;
                continue;
            }
            control_used += (size_t)n;
            control[control_used] = 0;
            char *line = control, *nl;
            while ((nl = strchr(line, '\n')) != NULL)
            {
                *nl = 0;
                if (!strncmp(line, "EXTEND ", 7))
                {
                    char *endptr = NULL;
                    long long next = strtoll(line + 7, &endptr, 10);
                    time_t now = time(NULL);
                    if (endptr != line + 7 && *endptr == 0 && next > now && next <= now + 3600)
                        end = (time_t)next;
                }
                line = nl + 1;
            }
            if (line != control)
            {
                size_t remaining = control + control_used - line;
                memmove(control, line, remaining);
                control_used = remaining;
            }
        }
        if (SSL_pending(ssl) || f[0].revents)
        {
            size_t size = 0;
            char *message = read_message(ssl, &size);
            if (!message)
                break;
            int rc = 0;
            if (terminal)
            {
                size_t off = 0;
                while (off < size)
                {
                    ssize_t z = write(dropbear_fd, message + off, size - off);
                    if (z <= 0)
                    {
                        rc = -1;
                        break;
                    }
                    off += z;
                }
            }
            else
                rc = proxy(ssl, message);
            free(message);
            if (rc)
                break;
        }
        if (terminal && f[1].revents)
        {
            unsigned char b[4096];
            ssize_t size = read(dropbear_fd, b, sizeof(b));
            if (size <= 0 || send_frame(ssl, b, size, 2))
                break;
        }
    }
    result = 0;
done:
    if (control_fd >= 0)
        close(control_fd);
    if (dropbear_fd >= 0)
        close(dropbear_fd);
    if (ssl)
        SSL_free(ssl);
    if (ctx)
        SSL_CTX_free(ctx);
    close(fd);
    return result;
}
