#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only
# Shared hardware probing and JSON formatting library for luci-app-nss-dashboard

. /usr/share/libubox/jshn.sh

PROFILE_JSON="/tmp/nss_profile.json"
PROFILE_ENV="/tmp/nss_profile.env"
MODULES_CACHE="/tmp/nss_modules.cache"
MODULES_CACHE_TTL=30

probe_soc() {
	local compat=""
	if [ -f /proc/device-tree/compatible ]; then
		compat=$(tr '\0' '\n' < /proc/device-tree/compatible 2>/dev/null)
	elif [ -f /sys/firmware/devicetree/base/compatible ]; then
		compat=$(tr '\0' '\n' < /sys/firmware/devicetree/base/compatible 2>/dev/null)
	fi

	case "$compat" in
		*ipq60*|*qcom,ipq6018*) echo "IPQ6018" ;;
		*ipq50*|*qcom,ipq5018*) echo "IPQ5018" ;;
		*ipq807*)              echo "IPQ8074" ;;
		*)                      echo "IPQ8074" ;;
	esac
}

probe_npu_cores() {
	local soc="$1"
	[ -z "$soc" ] && soc=$(probe_soc)

	case "$soc" in
		IPQ60*|IPQ50*) echo 1 ;;
		*)             echo 2 ;;
	esac
}

probe_nss_freq() {
	local cur_freq=""
	if [ -r /proc/sys/dev/nss/clock/current_freq ]; then
		local hz
		hz=$(cat /proc/sys/dev/nss/clock/current_freq 2>/dev/null | tr -d '[:space:]')
		if [ -n "$hz" ] && [ "$hz" -gt 0 ] 2>/dev/null; then
			cur_freq=$(awk -v h="$hz" 'BEGIN { printf "%.1f MHz", h / 1000000 }')
		fi
	fi
	if [ -z "$cur_freq" ] && [ -r /sys/kernel/debug/clk/nss_core_clk/clk_rate ]; then
		local hz
		read -r hz < /sys/kernel/debug/clk/nss_core_clk/clk_rate 2>/dev/null
		if [ -n "$hz" ] && [ "$hz" -gt 0 ] 2>/dev/null; then
			cur_freq=$(awk -v h="$hz" 'BEGIN { printf "%.1f MHz", h / 1000000 }')
		fi
	fi
	if [ -z "$cur_freq" ] && [ -f /etc/config/nss_dashboard ]; then
		cur_freq=$(uci -q get nss_dashboard.clock.frequency 2>/dev/null)
	fi
	if [ -z "$cur_freq" ]; then
		local cores
		cores=$(probe_npu_cores)
		[ "$cores" -eq 1 ] && cur_freq="1056.0 MHz" || cur_freq="1478.4 MHz"
	fi
	echo "$cur_freq"
}

probe_fw_version() {
	local fw_ver=""
	if [ -s /tmp/.nss_fw_version ]; then
		read -r fw_ver < /tmp/.nss_fw_version 2>/dev/null
	fi
	if [ -z "$fw_ver" ]; then
		for blob in /lib/firmware/qca-nss0.bin /lib/firmware/qca-nss0-retail.bin /lib/firmware/qca-nss-retail.bin; do
			if [ -r "$blob" ]; then
				fw_ver=$(grep -aom1 'NSS\.[A-Z][A-Z]*\.[0-9][0-9A-Za-z.-]*' "$blob" 2>/dev/null)
				[ -n "$fw_ver" ] && break
			fi
		done
	fi
	[ -n "$fw_ver" ] && echo "$fw_ver" > /tmp/.nss_fw_version
	[ -z "$fw_ver" ] && fw_ver="unknown"
	echo "$fw_ver"
}

probe_fw_mask() {
	local fw_mask="0x0"
	if [ -r /sys/kernel/debug/qca-ppe-nss/fw_mask ]; then
		read -r fw_mask < /sys/kernel/debug/qca-ppe-nss/fw_mask 2>/dev/null
	fi
	echo "${fw_mask:-0x0}"
}

check_mod() {
	local sys_mods="$1"
	local ko_names="$2"

	for sm in $sys_mods; do
		if [ -d "/sys/module/$sm" ]; then
			echo 2
			return
		fi
	done

	local cur_kver
	cur_kver=$(uname -r 2>/dev/null)
	for kn in $ko_names; do
		if ls /lib/modules/"$cur_kver"/$kn >/dev/null 2>&1 || ls /lib/modules/*/$kn >/dev/null 2>&1; then
			echo 1
			return
		fi
	done

	echo 0
}

probe_modules_state() {
	# 模块加载状态不属于秒级遥测：30s TTL 缓存，避免每次 getMetrics 都对
	# 未加载模块执行 /lib/modules glob（每个 check_mod 最多两次 ls，共 5 个模块）。
	local now ts
	now=$(date +%s)
	if [ -s "$MODULES_CACHE" ]; then
		. "$MODULES_CACHE" 2>/dev/null
		if [ -n "$ts" ] && [ "$((now - ts))" -ge 0 ] 2>/dev/null && [ "$((now - ts))" -lt "$MODULES_CACHE_TTL" ] 2>/dev/null; then
			return
		fi
	fi

	mod_pppoe=$(check_mod "qca_nss_pppoe nss_connmgr_pppoe" "qca-nss-pppoe.ko nss-connmgr-pppoe.ko")
	mod_vlan=$(check_mod "qca_nss_vlan qca_nss_vlan_mgr nss_vlan_mgr" "qca-nss-vlan.ko qca-nss-vlan-mgr.ko nss-vlan-mgr.ko")
	mod_bridge=$(check_mod "qca_nss_bridge_mgr nss_bridge_mgr" "qca-nss-bridge-mgr.ko nss-bridge-mgr.ko")
	mod_qdisc=$(check_mod "qca_nss_qdisc" "qca-nss-qdisc.ko")
	mod_crypto=$(check_mod "qca_nss_crypto qca_nss_eip197 eip197" "qca-nss-crypto.ko qca-nss-eip197.ko eip197.ko")

	printf 'ts=%s\nmod_pppoe=%s\nmod_vlan=%s\nmod_bridge=%s\nmod_qdisc=%s\nmod_crypto=%s\n' \
		"$now" "$mod_pppoe" "$mod_vlan" "$mod_bridge" "$mod_qdisc" "$mod_crypto" \
		> "$MODULES_CACHE.$$" 2>/dev/null && mv "$MODULES_CACHE.$$" "$MODULES_CACHE" 2>/dev/null
}

probe_sqm() {
	local qdisc_mod="${1:-0}"
	local sqm_state=-1
	if [ -x /etc/init.d/sqm ]; then
		if [ "$(uci -q get sqm.@queue[0].enabled 2>/dev/null || echo 0)" = "1" ]; then
			[ "$qdisc_mod" -ge 1 ] && sqm_state=2 || sqm_state=1
		else
			sqm_state=0
		fi
	fi
	echo "$sqm_state"
}

add_modules_object() {
	probe_modules_state
	json_add_object "modules"
	json_add_int "pppoe" "$mod_pppoe"
	json_add_int "vlan" "$mod_vlan"
	json_add_int "bridge" "$mod_bridge"
	json_add_int "qdisc" "$mod_qdisc"
	json_add_int "crypto" "$mod_crypto"
	json_close_object
}

add_dynamic_metrics() {
	local core0_load=0 core1_load=""
	if [ -r /sys/kernel/debug/qca-nss-drv/stats/cpu_load_ubi ]; then
		eval "$(awk '/^Core [0-9]+:/ { c=$2; sub(":","",c) } /%/ { gsub("%",""); print "core" c "_load=" $2 }' /sys/kernel/debug/qca-nss-drv/stats/cpu_load_ubi 2>/dev/null)"
	fi

	local heartbeat=0
	if [ -r /sys/kernel/debug/qca-nss-drv/stats/n2h ]; then
		local now_ts cur_pkts
		now_ts=$(date +%s)
		cur_pkts=$(awk '$1 == "n2h_rx_pkts" { s += $3 } END { print s + 0 }' /sys/kernel/debug/qca-nss-drv/stats/n2h 2>/dev/null || echo 0)
		if [ -f /tmp/nss_heartbeat.tmp ]; then
			local last_ts last_pkts last_rate
			read -r last_ts last_pkts last_rate < /tmp/nss_heartbeat.tmp 2>/dev/null
			local dt=$(( now_ts - ${last_ts:-0} ))
			if [ "$dt" -gt 0 ] && [ "$cur_pkts" -ge "${last_pkts:-0}" ]; then
				heartbeat=$(( (cur_pkts - last_pkts) / dt ))
				echo "$now_ts $cur_pkts $heartbeat" > /tmp/nss_heartbeat.tmp 2>/dev/null
			elif [ "$dt" -eq 0 ] && [ "${last_rate:-0}" -gt 0 ]; then
				heartbeat="$last_rate"
			else
				echo "$now_ts $cur_pkts 0" > /tmp/nss_heartbeat.tmp 2>/dev/null
			fi
		else
			echo "$now_ts $cur_pkts 0" > /tmp/nss_heartbeat.tmp 2>/dev/null
		fi
	fi

	local cpu_temp="0.0"
	if [ -r /sys/class/thermal/thermal_zone0/temp ]; then
		local raw_temp
		read -r raw_temp < /sys/class/thermal/thermal_zone0/temp 2>/dev/null
		if [ -n "$raw_temp" ] && [ "$raw_temp" -gt 0 ] 2>/dev/null; then
			cpu_temp="$(( raw_temp / 1000 )).$(( (raw_temp % 1000) / 100 ))"
		fi
	fi

	local nss_bytes=0
	if [ -r /sys/kernel/debug/qca-nss-drv/stats/ipv4 ]; then
		nss_bytes=$(awk '$1 == "ipv4_tx_bytes" || $1 == "ipv6_tx_bytes" { s += $3 } END { printf "%.0f", s + 0 }' \
			/sys/kernel/debug/qca-nss-drv/stats/ipv4 /sys/kernel/debug/qca-nss-drv/stats/ipv6 2>/dev/null || echo 0)
	fi

	local cur_freq=""
	if [ -f /tmp/nss_profile.env ]; then
		cur_freq=$(grep '^nss_freq=' /tmp/nss_profile.env 2>/dev/null | cut -d"'" -f2)
	fi
	[ -z "$cur_freq" ] && cur_freq=$(probe_nss_freq)

	local ecm_v4=0 ecm_v6=0 ecm_total=0
	for f in /sys/kernel/debug/ecm/ecm_*_ipv4/accelerated_count; do
		if [ -r "$f" ]; then
			read -r ecm_v4 < "$f" 2>/dev/null
			break
		fi
	done
	for f in /sys/kernel/debug/ecm/ecm_*_ipv6/accelerated_count; do
		if [ -r "$f" ]; then
			read -r ecm_v6 < "$f" 2>/dev/null
			break
		fi
	done

	local ecm_tcp=0 ecm_udp=0 ecm_other=0 ecm_simple_total=0
	if [ -r /sys/kernel/debug/ecm/ecm_db/connection_count_simple ]; then
		read -r _ ecm_tcp _ ecm_udp _ ecm_other _ ecm_simple_total < /sys/kernel/debug/ecm/ecm_db/connection_count_simple 2>/dev/null
	fi

	ecm_total=$(( ${ecm_v4:-0} + ${ecm_v6:-0} ))
	[ "$ecm_total" -eq 0 ] && [ "${ecm_simple_total:-0}" -gt 0 ] && ecm_total="$ecm_simple_total"

	local wifi_offload=0
	[ -d /sys/kernel/debug/ath11k ] && wifi_offload=1

	local conflict=0
	local flow_off=$(uci -q get network.@device[0].flow_offloading 2>/dev/null || echo 0)
	[ "$flow_off" = "1" ] && conflict=1

	json_add_int "heartbeat" "${heartbeat:-0}"
	json_add_double "nss_bytes" "${nss_bytes:-0}"
	json_add_string "nss_freq" "${cur_freq:-1478.4 MHz}"
	json_add_int "core0_load" "${core0_load:-0}"
	if [ -n "$core1_load" ]; then
		json_add_int "core1_load" "$core1_load"
	else
		json_add_null "core1_load"
	fi
	json_add_double "cpu_temp" "${cpu_temp:-0.0}"

	json_add_array "cpu_ticks"
	if [ -r /proc/stat ]; then
		local _cpu u n s id io irq sirq st
		read -r _cpu u n s id io irq sirq st _ < /proc/stat 2>/dev/null
		for t in "${u:-0}" "${n:-0}" "${s:-0}" "${id:-0}" "${io:-0}" "${irq:-0}" "${sirq:-0}" "${st:-0}"; do
			json_add_int "" "$t"
		done
	fi
	json_close_array

	json_add_array "radios"
	for p in /sys/class/ieee80211/phy*; do
		[ -d "$p" ] || continue
		local phy_name=$(basename "$p")
		local hwmon_temp="0.0"
		for tfile in "$p"/hwmon*/temp1_input "$p"/device/hwmon/hwmon*/temp1_input; do
			if [ -r "$tfile" ]; then
				local raw_wtemp
				read -r raw_wtemp < "$tfile" 2>/dev/null
				if [ -n "$raw_wtemp" ] && [ "$raw_wtemp" -gt 0 ] 2>/dev/null; then
					hwmon_temp="$(( raw_wtemp / 1000 )).$(( (raw_wtemp % 1000) / 100 ))"
				fi
				break
			fi
		done
		json_add_object
		json_add_string "id" "$phy_name"
		json_add_double "temp" "$hwmon_temp"
		json_close_object
	done
	json_close_array

	json_add_int "ecm_total" "${ecm_total:-0}"
	json_add_int "ecm_v4" "${ecm_v4:-0}"
	json_add_int "ecm_v6" "${ecm_v6:-0}"
	json_add_int "ecm_tcp" "${ecm_tcp:-0}"
	json_add_int "ecm_udp" "${ecm_udp:-0}"
	json_add_int "ecm_other" "${ecm_other:-0}"
	json_add_int "wifi_offload" "$wifi_offload"
	json_add_int "conflict_detected" "$conflict"

	add_modules_object
}
