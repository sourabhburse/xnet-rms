#include "agent.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "parson.h"

static struct uloop_timeout watchdog_timer;
static bool watchdog_active = false;

void check_rollback_watchdog(struct uloop_timeout *t) {
    (void)t;
    if (!watchdog_active) return;

    printf("[WATCHDOG] ⚠️ 180 seconds elapsed without cloud MQTT verification! Triggering rollback...\n");

    // Restore backup
    system("cp -r /tmp/niseva_uci_backup/* /etc/config/ 2>/dev/null");
    system("/etc/init.d/network reload 2>/dev/null");

    watchdog_active = false;
    printf("[WATCHDOG] ✅ Reverted configuration to last working backup.\n");
}

int apply_uci_config_with_watchdog(JSON_Array *commands) {
    if (!commands) return -1;

    printf("[WATCHDOG] Taking backup of /etc/config to /tmp/niseva_uci_backup/...\n");
    system("mkdir -p /tmp/niseva_uci_backup && cp -r /etc/config/* /tmp/niseva_uci_backup/");

    // Apply each UCI command
    size_t count = json_array_get_count(commands);
    for (size_t i = 0; i < count; i++) {
        const char *cmd_str = json_array_get_string(commands, i);
        if (cmd_str && strlen(cmd_str) > 0) {
            char sys_cmd[256];
            snprintf(sys_cmd, sizeof(sys_cmd), "uci %s 2>/dev/null", cmd_str);
            system(sys_cmd);
            printf("[UCI] Executed: %s\n", sys_cmd);
        }
    }

    // Start 180-second countdown
    watchdog_active = true;
    watchdog_timer.cb = check_rollback_watchdog;
    uloop_timeout_set(&watchdog_timer, g_cfg.rollback_timeout * 1000);

    printf("[WATCHDOG] Committing UCI changes and reloading network...\n");
    system("uci commit && /etc/init.d/network reload 2>/dev/null");

    return 0;
}

void cancel_rollback_watchdog(void) {
    if (watchdog_active) {
        printf("[WATCHDOG] ✅ Cloud connection verified! Canceling rollback and deleting backup.\n");
        uloop_timeout_cancel(&watchdog_timer);
        watchdog_active = false;
        system("rm -rf /tmp/niseva_uci_backup");
    }
}
