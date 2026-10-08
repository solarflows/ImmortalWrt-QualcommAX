include $(TOPDIR)/rules.mk

ARCH:=aarch64
BOARD:=qualcommax
BOARDNAME:=Qualcomm Atheros 802.11ax WiSoC-s
FEATURES:=squashfs ramdisk fpu nand rtc emmc
KERNELNAME:=Image
CPU_TYPE:=cortex-a53
SUBTARGETS:=ipq807x ipq60xx ipq50xx

KERNEL_PATCHVER:=6.18

include $(INCLUDE_DIR)/target.mk
DEFAULT_PACKAGES += \
	kmod-usb3 kmod-usb-dwc3 kmod-usb-dwc3-qcom \
	kmod-leds-gpio kmod-gpio-button-hotplug \
	kmod-ath11k kmod-ath11k-ahb wpad-openssl \
	uboot-envtools e2fsprogs kmod-fs-ext4 losetup kmod-ramoops \
	nss-tools luci-app-nss nssqos luci-app-nssqos \
	sqm-scripts-nss luci-app-sqm \
	fullconenat-sonic luci-app-fullconenat-sonic \
	autocore automount luci-app-cpufreq \
	luci luci-app-firewall luci-i18n-base-zh-cn luci-i18n-firewall-zh-cn

$(eval $(call BuildTarget))
