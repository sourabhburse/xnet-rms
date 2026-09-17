cmake_minimum_required(VERSION 3.13)
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
    tunnel.c
    tunnel_worker.c
    runtime.c
    collectors.c
)

# Optional strongSwan VICI collector.  It is packaged separately and loads
# libvici/libstrongswan at runtime, so the base agent remains independent of
# the IPsec stack.
add_executable(niseva-ipsec-collector
    ipsec_vici.c
    parson.c
)

target_link_libraries(niseva-agent
    ubox
    uci
    mosquitto
    ssl
    crypto
    curl
)

target_link_libraries(niseva-ipsec-collector dl)

if(CMAKE_CROSSCOMPILING)
 set_target_properties(niseva-agent PROPERTIES SKIP_BUILD_RPATH TRUE INSTALL_RPATH "")
 set_target_properties(niseva-ipsec-collector PROPERTIES SKIP_BUILD_RPATH TRUE INSTALL_RPATH "")
endif()

install(TARGETS niseva-agent DESTINATION /usr/sbin)

if(RMS_HOST_INCLUDE)
 target_include_directories(niseva-agent PRIVATE ${RMS_HOST_INCLUDE})
 target_link_directories(niseva-agent PRIVATE ${RMS_HOST_LIB})
endif()
