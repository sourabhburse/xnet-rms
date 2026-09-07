include $(TOPDIR)/rules.mk

PKG_NAME:=niseva-agent
PKG_VERSION:=2.1.0
PKG_RELEASE:=2

PKG_MAINTAINER:=Niseva Engineering <support@niseva.com>
PKG_LICENSE:=Proprietary

include $(INCLUDE_DIR)/package.mk
include $(INCLUDE_DIR)/cmake.mk

define Package/$(PKG_NAME)
	SECTION:=niseva
	CATEGORY:=xNet
	SUBMENU:=Management
	TITLE:=Niseva Cloud RMS Router Agent
	DEPENDS:=+libubox +libubus +libuci +libblobmsg-json +libmosquitto-ssl +libcurl +libopenssl +ubus
	URL:=https://www.niseva.com
endef

define Package/$(PKG_NAME)/description
	Lightweight native C management agent for Niseva 2S routers connecting to Niseva Cloud RMS.
	Supports certificate enrollment, bounded JSON collection, and authorized LuCI/terminal sessions.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Package/$(PKG_NAME)/conffiles
/etc/config/niseva
/etc/xnet-rms/
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/usr/libexec/xnet-rms
	$(INSTALL_BIN) ./files/ipsec.lua $(1)/usr/libexec/xnet-rms/ipsec.lua
	$(INSTALL_DIR) $(1)/lib/upgrade/keep.d
	$(INSTALL_DATA) ./files/niseva.keep $(1)/lib/upgrade/keep.d/niseva-agent
	$(INSTALL_DIR) $(1)/etc/xnet-rms/collectors
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/niseva-agent $(1)/usr/sbin/

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/niseva.config $(1)/etc/config/niseva

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/niseva.init $(1)/etc/init.d/niseva-agent
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
