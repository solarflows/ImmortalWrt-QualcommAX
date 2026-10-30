# SPDX-License-Identifier: GPL-2.0-only
#
# Standalone LuCI dashboard for Qualcomm NSS Hardware Acceleration
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-nss-dashboard
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-nss-dashboard
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=Standalone LuCI dashboard for Qualcomm NSS Acceleration
  DEPENDS:=@(TARGET_qualcommax) +luci-base +kmod-qca-nss-drv +kmod-qca-nss-ecm
  PKGARCH:=all
endef

define Package/luci-app-nss-dashboard/description
 Standalone LuCI dashboard for Qualcomm NSS acceleration featuring overview
 slot integration (12_nss.js), subviews (status, controls, ports, flows),
 client flow aggregation, and non-invasive state discovery.
endef

define Package/luci-app-nss-dashboard/conffiles
/etc/config/nss_dashboard
endef

define Build/Compile
endef

define Package/luci-app-nss-dashboard/install
	$(CP) ./root/* $(1)/
	chmod 0755 $(1)/usr/libexec/rpcd/luci.nss_dashboard
	chmod 0755 $(1)/usr/libexec/rpcd/nss_dashboard.common.sh
	chmod 0755 $(1)/etc/uci-defaults/98-nss-dashboard-profile
endef

$(eval $(call BuildPackage,luci-app-nss-dashboard))
