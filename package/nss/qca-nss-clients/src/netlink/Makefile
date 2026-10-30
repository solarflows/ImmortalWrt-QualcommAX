CAPWAP_ENABLED := $(strip $(if $(filter $(capwapmgr), y), 1 , 0))
IPSEC_ENABLED := $(strip $(if $(filter $(ipsecmgr), y), 1 , 0))
DTLS_ENABLED := $(strip $(if $(filter $(dtlsmgr), y), 1 , 0))

ccflags-y := -Wall
ccflags-y += -I$(obj)/include
ccflags-y += -I$(obj)/../exports
ccflags-y += -DNSS_NL_DEBUG_LEVEL=4
ccflags-y += -DNSS_CLIENT_BUILD_ID="$(BUILD_ID)"

ccflags-y += -DCONFIG_NSS_NLIPV4=1
ccflags-y += -DCONFIG_NSS_NLIPV6=1
ccflags-y += -DCONFIG_NSS_NLOAM=$(strip $(if $(filter $(oam), y), 1 , 0))
ccflags-y += -DCONFIG_NSS_NLGRE_REDIR_FAMILY=$(strip $(if $(filter $(CONFIG_NSS_NLGRE_REDIR_FAMILY), y), 1 , 0))
ccflags-y += -DCONFIG_NSS_NLETHRX=1
ccflags-y += -DCONFIG_NSS_NLDYNAMIC_INTERFACE=1
ccflags-y += -DCONFIG_NSS_NLN2H=1
ccflags-y += -DCONFIG_NSS_NLIPV4_REASM=$(strip $(if $(filter $(CONFIG_NSS_NLIPV4_REASM), y), 1 , 0))
ccflags-y += -DCONFIG_NSS_NLIPV6_REASM=$(strip $(if $(filter $(CONFIG_NSS_NLIPV6_REASM), y), 1 , 0))
ccflags-y += -DCONFIG_NSS_NLWIFILI=1
ccflags-y += -DCONFIG_NSS_NLLSO_RX=$(strip $(if $(filter $(lso), y), 1 , 0))
ccflags-y += -DCONFIG_NSS_NLMAP_T=$(strip $(if $(filter $(map-t), y), 1 , 0))
ccflags-y += -DCONFIG_NSS_NLPPPOE=$(strip $(if $(filter $(pppoe), y), 1 , 0))
ccflags-y += -DCONFIG_NSS_NLL2TPV2=$(strip $(if $(filter $(l2tp), y), 1 , 0))
ccflags-y += -DCONFIG_NSS_NLQRFS=$(strip $(if $(filter $(CONFIG_NSS_NLQRFS), y), 1 , 0))
ccflags-y += -DCONFIG_NSS_NLPPTP=$(strip $(if $(filter $(pptp), y), 1 , 0))
ccflags-y += -DCONFIG_NSS_NLCAPWAP=${CAPWAP_ENABLED}
ccflags-y += -DCONFIG_NSS_NLIPSEC=${IPSEC_ENABLED}
ccflags-y += -DCONFIG_NSS_NLDTLS=${DTLS_ENABLED}
ccflags-y += -DCONFIG_NSS_NLUDP_ST=$(strip $(if $(filter $(CONFIG_NSS_NLUDP_ST), y), 1 , 0))

qca-nss-netlink-objs := nss_nl.o

ifneq (,$(filter $(gre), y))
qca-nss-netlink-objs += nss_nlgre_redir_family.o
qca-nss-netlink-objs += nss_nlgre_redir_cmd.o
qca-nss-netlink-objs += nss_nlgre_redir_cmn.o
qca-nss-netlink-objs += nss_nlgre_redir.o
qca-nss-netlink-objs += nss_nlgre_redir_lag.o
endif

qca-nss-netlink-objs += nss_nlipv4.o
qca-nss-netlink-objs += nss_nlipv6.o

ifneq (,$(filter $(oam), y))
qca-nss-netlink-objs += nss_nloam.o
endif

qca-nss-netlink-objs += nss_nlethrx.o
qca-nss-netlink-objs += nss_nldynamic_interface.o
qca-nss-netlink-objs += nss_nln2h.o

ifneq (,$(filter $(CONFIG_NSS_NLIPV4_REASM), y))
qca-nss-netlink-objs += nss_nlipv4_reasm.o
endif
ifneq (,$(filter $(CONFIG_NSS_NLIPV6_REASM), y))
qca-nss-netlink-objs += nss_nlipv6_reasm.o
endif

qca-nss-netlink-objs += nss_nlwifili.o

ifneq (,$(filter $(lso), y))
qca-nss-netlink-objs += nss_nllso_rx.o
endif

ifneq (,$(filter $(map-t), y))
qca-nss-netlink-objs += nss_nlmap_t.o
endif
ifneq (,$(filter $(pppoe), y))
qca-nss-netlink-objs += nss_nlpppoe.o
endif

ifneq (,$(filter $(l2tp), y))
qca-nss-netlink-objs += nss_nll2tpv2.o
endif

ifneq (,$(filter $(pptp), y))
qca-nss-netlink-objs += nss_nlpptp.o
endif

ifeq ($(SoC),$(filter $(SoC),ipq95xx ipq50xx ipq807x_64))
ifneq (,$(filter $(CONFIG_NSS_NLUDP_ST), y))
qca-nss-netlink-objs += nss_nludp_st.o
endif
endif

ifneq (,$(filter $(CONFIG_NSS_NLQRFS), y))
qca-nss-netlink-objs += nss_nlqrfs.o
endif

ifneq (,$(filter $(capwapmgr), y))
qca-nss-netlink-objs += nss_nlcapwap.o
endif

ifneq (,$(filter $(dtlsmgr), y))
qca-nss-netlink-objs += nss_nldtls.o
endif

ifneq (,$(filter $(ipsecmgr), y))
qca-nss-netlink-objs += nss_nlipsec.o
endif

ccflags-y += -DCONFIG_NSS_NLC2C_TX=$(strip $(if $(filter $(CONFIG_NSS_NLC2C), y), 1 , 0))
ccflags-y += -DCONFIG_NSS_NLC2C_RX=$(strip $(if $(filter $(CONFIG_NSS_NLC2C), y), 1 , 0))
ifeq ($(SoC),$(filter $(SoC),ipq807x ipq807x_64))
qca-nss-netlink-objs += $(strip $(if $(filter $(CONFIG_NSS_NLC2C), y), nss_nlc2c_tx.o,))
qca-nss-netlink-objs += $(strip $(if $(filter $(CONFIG_NSS_NLC2C), y), nss_nlc2c_rx.o,))
endif

ifeq ($(SoC),$(filter $(SoC),ipq60xx ipq60xx_64 ipq807x ipq807x_64))
ccflags-y += -DCONFIG_NSS_NLEDMA=1
qca-nss-netlink-objs += nss_nledma.o
else
ccflags-y += -DCONFIG_NSS_NLEDMA=0
endif

obj-m += qca-nss-netlink.o
