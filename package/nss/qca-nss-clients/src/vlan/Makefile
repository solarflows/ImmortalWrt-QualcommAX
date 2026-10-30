ccflags-y := -I$(obj)/../exports -I$(obj)/..  -I$(obj)/nss_hal/include
ccflags-y += -DNSS_CLIENT_BUILD_ID="$(BUILD_ID)"

obj-m += qca-nss-vlan.o
qca-nss-vlan-objs := nss_vlan_mgr.o

ccflags-y += -DNSS_VLAN_MGR_QCA_PPE

ccflags-y += -DNSS_VLAN_MGR_DEBUG_LEVEL=0
ccflags-y += -Wall -Werror
