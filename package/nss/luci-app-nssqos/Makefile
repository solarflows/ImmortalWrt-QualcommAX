# SPDX-License-Identifier: GPL-2.0-only
#
# LuCI editor for NSS QoS marking rules and connections

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-nssqos
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-nssqos
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI editor for NSS QoS marking rules
  DEPENDS:=+nssqos +luci-base
  PKGARCH:=all
endef

define Package/luci-app-nssqos/description
 Network -> QoS Marking (NSS): edit the DSCP marking and fast-lane
 prioritization rules of /etc/config/nssqos.
endef

define Package/luci-i18n-nssqos-zh-cn
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=luci-app-nssqos - zh-cn translation
  DEPENDS:=+luci-app-nssqos
  PKGARCH:=all
endef

define Build/Compile
	if command -v po2lmo >/dev/null 2>&1; then \
		po2lmo ./po/zh_Hans/nssqos.po ./files/i18n/nssqos.zh-cn.lmo; \
	elif [ -x $(STAGING_DIR_HOSTPKG)/bin/po2lmo ]; then \
		$(STAGING_DIR_HOSTPKG)/bin/po2lmo ./po/zh_Hans/nssqos.po ./files/i18n/nssqos.zh-cn.lmo; \
	fi
endef

define Package/luci-app-nssqos/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/nss
	$(INSTALL_DATA) ./files/luci-nss-qos.js $(1)/www/luci-static/resources/view/nss/qos.js
	$(INSTALL_DATA) ./files/luci-nss-connections.js $(1)/www/luci-static/resources/view/nss/connections.js
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./files/luci-app-nssqos.menu.json $(1)/usr/share/luci/menu.d/luci-app-nssqos.json
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/luci-app-nssqos.acl.json $(1)/usr/share/rpcd/acl.d/luci-app-nssqos.json
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(INSTALL_DATA) ./files/i18n/nssqos.zh-cn.lmo $(1)/usr/lib/lua/luci/i18n/nssqos.zh-cn.lmo
endef

define Package/luci-i18n-nssqos-zh-cn/install
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	echo "uci set luci.languages.zh_cn='中文 (Chinese)'; uci commit luci" > $(1)/etc/uci-defaults/luci-i18n-nssqos-zh-cn
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(INSTALL_DATA) ./files/i18n/nssqos.zh-cn.lmo $(1)/usr/lib/lua/luci/i18n/nssqos.zh-cn.lmo
endef

$(eval $(call BuildPackage,luci-app-nssqos))
$(eval $(call BuildPackage,luci-i18n-nssqos-zh-cn))
