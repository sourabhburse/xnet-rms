#ifndef RMS_RUNTIME_H
#define RMS_RUNTIME_H
#include <stddef.h>
#include <sys/types.h>
char *rms_http(const char *url, const char *body, int client, size_t limit);
int rms_write_atomic(const char *path, const void *data, size_t len, mode_t mode);
char *rms_capture(char *const argv[], int timeout, size_t limit, int *status);
int rms_id(const char *s);
void rms_random_id(char out[33]);
int rms_cert_due(void);
int rms_refresh_certificate(void);
void rms_collect_tick(void);
void rms_collect_stop(void);
int rms_sync_profiles(void);
int rms_worker(const char *kind);
extern char rms_http_error[96];
#endif
