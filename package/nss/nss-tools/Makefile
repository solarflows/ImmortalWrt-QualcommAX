# SPDX-License-Identifier: GPL-2.0-only
#
# Runtime integration for Qualcomm NSS offloading on the qca_edma/qca_ppe
# (EDMA-rework) driver stack.

include $(TOPDIR)/rules.mk

PKG_NAME:=nss-tools
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/nss-tools
  SECTION:=net
  CATEGORY:=Network
  TITLE:=NSS offload runtime tools (nss-up, nss-status)
  DEPENDS:=@(TARGET_qualcommax) +kmod-qca-ppe-nss +kmod-qca-nss-drv \
	+kmod-qca-nss-ecm +kmod-qca-nss-drv-pppoe +kmod-qca-nss-drv-bridge-mgr \
	+kmod-qca-nss-drv-qdisc +kmod-qca-nss-drv-igs \
	+sqm-scripts-nss +ethtool +ip-bridge
  PKGARCH:=all
endef

define Package/nss-tools/description
 Brings the opt-in NSS data plane up in the required order at boot (the
 'nss' service running /usr/sbin/nss-up: firmware arm, bridge/multicast/
 ECM/PPPoE managers, Wi-Fi offload flip, SQM), reports its health via
 /usr/sbin/nss-status (-j for JSON) and captures EDMA/PPE registers with
 edma-dump (needs a devmem-enabled busybox). nss-wedge-watch dumps the
 firmware, fabric and MAC state behind a port that has stopped
 transmitting - '-1' for a one-shot capture on a box that is wedged now,
 or run it detached to catch the next one; nss-ppe-diff baselines the
 PPE's configuration registers at bring-up and says which of them stopped
 holding the value we wrote. Nothing autoloads: disable
 with "uci set nss.general.enabled='0'" to stay on the plain host stack.
 Pulls in the complete NSS runtime package set.
endef

define Build/Compile
endef

define Package/nss-tools/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/nss-up $(1)/usr/sbin/nss-up
	$(INSTALL_BIN) ./files/nss-status $(1)/usr/sbin/nss-status
	$(INSTALL_BIN) ./files/edma-dump $(1)/usr/sbin/edma-dump
	$(INSTALL_BIN) ./files/nss-wedge-watch $(1)/usr/sbin/nss-wedge-watch
	$(INSTALL_BIN) ./files/nss-ppe-diff $(1)/usr/sbin/nss-ppe-diff
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/nss.init $(1)/etc/init.d/nss
	$(INSTALL_DIR) $(1)/lib/nss
	$(INSTALL_DATA) ./files/functions.sh $(1)/lib/nss/functions.sh
	$(INSTALL_DIR) $(1)/etc/sysctl.d
	$(INSTALL_DATA) ./files/nss.sysctl $(1)/etc/sysctl.d/12-nss-networking.conf
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_DATA) ./files/nss-offload.defaults $(1)/etc/uci-defaults/98-nss-offload
	$(INSTALL_DIR) $(1)/lib/upgrade/keep.d
	$(INSTALL_DATA) ./files/nss-tools.keep $(1)/lib/upgrade/keep.d/nss-tools
endef

$(eval $(call BuildPackage,nss-tools))
