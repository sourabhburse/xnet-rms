include $(TOPDIR)/rules.mk

PKG_NAME:=niseva-agent
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_MAINTAINER:=Niseva Engineering <support@niseva.com>
PKG_LICENSE:=Proprietary

include $(INCLUDE_DIR)/package.mk
include $(INCLUDE_DIR)/cmake.mk

define Package/$(PKG_NAME)
	SECTION:=niseva
	CATEGORY:=xNet
	SUBMENU:=Management
	TITLE:=Niseva Cloud RMS Router Agent
	DEPENDS:=+libubox +libubus +libuci +libblobmsg-json +libmosquitto
	URL:=https://www.niseva.com
endef

define Package/$(PKG_NAME)/description
	Lightweight native C management agent for Niseva 2S routers connecting to Niseva Cloud RMS.
	Supports ubus cellular telemetry, failsafe UCI rollback, and on-demand LuCI/WebSSH tunneling.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/niseva-agent $(1)/usr/sbin/

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/niseva.config $(1)/etc/config/niseva

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/niseva.init $(1)/etc/init.d/niseva-agent
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
