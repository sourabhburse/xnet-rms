include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-niseva-rms
PKG_RELEASE:=5

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-niseva-rms
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=XNET RMS management settings
  DEPENDS:=+luci-base +luci-compat +niseva-agent
endef

define Package/luci-app-niseva-rms/description
 LuCI settings and status page for the XNET RMS router agent.
endef

define Package/luci-app-niseva-rms/install
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(INSTALL_DATA) ./root/usr/lib/lua/luci/controller/niseva_rms.lua $(1)/usr/lib/lua/luci/controller/
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/model/cbi/niseva_rms
	$(INSTALL_DATA) ./root/usr/lib/lua/luci/model/cbi/niseva_rms/settings.lua $(1)/usr/lib/lua/luci/model/cbi/niseva_rms/
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/view/niseva_rms
	$(INSTALL_DATA) ./root/usr/lib/lua/luci/view/niseva_rms/status.htm $(1)/usr/lib/lua/luci/view/niseva_rms/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-niseva-rms.json $(1)/usr/share/rpcd/acl.d/
endef

$(eval $(call BuildPackage,luci-app-niseva-rms))
