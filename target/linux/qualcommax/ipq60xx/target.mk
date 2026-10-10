SUBTARGET:=ipq60xx
BOARDNAME:=Qualcomm Atheros IPQ60xx
DEFAULT_PACKAGES += \
	ath11k-firmware-ipq6018 cpufreq \
	kmod-qca-nss-drv kmod-qca-ppe-nss kmod-qca-nss-ecm \
	kmod-qca-nss-drv-pppoe kmod-qca-nss-drv-bridge-mgr kmod-qca-nss-drv-vlan-mgr \
	kmod-qca-mcs kmod-qca-nss-drv-qdisc kmod-qca-nss-drv-igs \
	kmod-qca-nss-drv-mirror kmod-qca-nss-drv-netlink \
	nss-tools luci-app-nss nssqos luci-app-nssqos sqm-scripts-nss nssinfo

define Target/Description
	Build firmware images for Qualcomm Atheros IPQ60xx based boards.
endef
