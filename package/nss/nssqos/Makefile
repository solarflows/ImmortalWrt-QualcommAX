# SPDX-License-Identifier: GPL-2.0-only
#
# DSCP marking and NSS fast-lane prioritization service

include $(TOPDIR)/rules.mk

PKG_NAME:=nssqos
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/nssqos
  SECTION:=net
  CATEGORY:=Network
  TITLE:=DSCP marking and NSS fast-lane prioritization
  DEPENDS:=@(TARGET_qualcommax) +nftables-json
  PKGARCH:=all
endef

define Package/nssqos/description
 Renders /etc/config/nssqos into a standalone nftables table that
 DSCP-marks matching connections and steers them into the strict-priority
 fast lane of the NSS SQM script (nss-edma.qos). Marking and steering
 apply to NSS-accelerated flows in both directions.
endef

define Package/nssqos/conffiles
/etc/config/nssqos
endef

define Build/Compile
endef

define Package/nssqos/install
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/nssqos.init $(1)/etc/init.d/nssqos
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/nssqos.config $(1)/etc/config/nssqos
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/nssqos-conns $(1)/usr/sbin/nssqos-conns
	$(INSTALL_BIN) ./files/nssqos-resolve $(1)/usr/sbin/nssqos-resolve
endef

$(eval $(call BuildPackage,nssqos))
