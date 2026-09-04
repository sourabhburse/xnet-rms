cmake_minimum_required(VERSION 3.10)
project(niseva-agent C)

set(CMAKE_C_STANDARD 99)
add_definitions(-D_GNU_SOURCE)

# Optimization flags for MIPS OpenWrt (ultra small footprint)
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wall -Wextra -Os -fomit-frame-pointer")

add_executable(niseva-agent
    main.c
    bootstrap.c
    parson.c
    telemetry.c
    commands.c
    rollback.c
    tunnel.c
)

target_link_libraries(niseva-agent
    ubox
    ubus
    uci
    blobmsg_json
    mosquitto
)

install(TARGETS niseva-agent DESTINATION /usr/sbin)
