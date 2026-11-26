# SPDX-License-Identifier: GPL-2.0-only
#
# LuCI status page for NSS offloading

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-nss
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-nss
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI status page for NSS offloading
  DEPENDS:=+nss-tools +luci-base
  PKGARCH:=all
endef

define Package/luci-app-nss/description
 Status -> NSS Offload: renders 'nss-status -j' (firmware state, cores,
 ports, ECM acceleration counts, SQM/fast-lane health) in LuCI.
endef

define Package/luci-i18n-nss-zh-cn
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=luci-app-nss - zh-cn translation
  DEPENDS:=+luci-app-nss
  PKGARCH:=all
endef

define Build/Compile
	if command -v po2lmo >/dev/null 2>&1; then \
		po2lmo ./po/zh_Hans/nss.po ./files/i18n/nss.zh-cn.lmo; \
	elif [ -x $(STAGING_DIR_HOSTPKG)/bin/po2lmo ]; then \
		$(STAGING_DIR_HOSTPKG)/bin/po2lmo ./po/zh_Hans/nss.po ./files/i18n/nss.zh-cn.lmo; \
	fi
endef

define Package/luci-app-nss/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/nss
	$(INSTALL_DATA) ./files/luci-nss-status.js $(1)/www/luci-static/resources/view/nss/status.js
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./files/luci-app-nss.menu.json $(1)/usr/share/luci/menu.d/luci-app-nss.json
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/luci-app-nss.acl.json $(1)/usr/share/rpcd/acl.d/luci-app-nss.json
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(INSTALL_DATA) ./files/i18n/nss.zh-cn.lmo $(1)/usr/lib/lua/luci/i18n/nss.zh-cn.lmo
endef

define Package/luci-i18n-nss-zh-cn/install
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	echo "uci set luci.languages.zh_cn='中文 (Chinese)'; uci commit luci" > $(1)/etc/uci-defaults/luci-i18n-nss-zh-cn
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(INSTALL_DATA) ./files/i18n/nss.zh-cn.lmo $(1)/usr/lib/lua/luci/i18n/nss.zh-cn.lmo
endef

$(eval $(call BuildPackage,luci-app-nss))
$(eval $(call BuildPackage,luci-i18n-nss-zh-cn))
