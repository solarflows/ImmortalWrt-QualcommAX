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

	local matched
	matched=$(echo "$compat" | awk -F, '/qcom,ipq/ { print toupper($2); exit }')
	if [ -n "$matched" ]; then
		echo "$matched"
		return
	fi

	case "$compat" in
		*ipq60*) echo "IPQ6018" ;;
		*ipq50*) echo "IPQ5018" ;;
		*ipq807*) echo "IPQ8074" ;;
		*) echo "" ;;
	esac
}

probe_npu_cores() {
	local dt_base=""
	[ -d /proc/device-tree ] && dt_base=/proc/device-tree || dt_base=/sys/firmware/devicetree/base
	local dt_cores
	dt_cores=$(ls -d "$dt_base"/soc*/nss@* 2>/dev/null | wc -l)
	if [ -n "$dt_cores" ] && [ "$dt_cores" -gt 0 ] 2>/dev/null; then
		echo "$dt_cores"
		return
	fi

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
			cur_freq="$(( hz / 1000000 )).$(( (hz % 1000000) / 100000 )) MHz"
		fi
	fi
	if [ -z "$cur_freq" ] && [ -s /tmp/nss_freq ]; then
		local tf
		read -r tf < /tmp/nss_freq 2>/dev/null
		tf=$(echo "$tf" | tr -d '[:space:]')
		tf="${tf%MHz}"
		tf="${tf%mhz}"
		[ -n "$tf" ] && cur_freq="$tf MHz"
	fi
	if [ -z "$cur_freq" ] && [ -r /sys/kernel/debug/clk/nss_core_clk/clk_rate ]; then
		local hz
		hz=$(cat /sys/kernel/debug/clk/nss_core_clk/clk_rate 2>/dev/null | tr -d '[:space:]')
		if [ -n "$hz" ] && [ "$hz" -gt 0 ] 2>/dev/null; then
			cur_freq="$(( hz / 1000000 )).$(( (hz % 1000000) / 100000 )) MHz"
		fi
	fi
	if [ -z "$cur_freq" ]; then
		local dt_max_file="/proc/device-tree/soc@0/nss@40000000/qcom,max-frequency"
		[ ! -f "$dt_max_file" ] && dt_max_file=$(find /proc/device-tree/soc* -name "qcom,max-frequency" 2>/dev/null | head -n 1)
		if [ -f "$dt_max_file" ]; then
			local dt_hz
			dt_hz=$(printf "%d" 0x$(hexdump -e '4/1 "%02x"' "$dt_max_file" 2>/dev/null))
			if [ -n "$dt_hz" ] && [ "$dt_hz" -gt 0 ] 2>/dev/null; then
				cur_freq="$(( dt_hz / 1000000 )).$(( (dt_hz % 1000000) / 100000 )) MHz"
			fi
		fi
	fi
	echo "$cur_freq"
}

probe_nss_frequencies() {
	local dt_node=""
	local dt_base=""
	[ -d /proc/device-tree ] && dt_base=/proc/device-tree || dt_base=/sys/firmware/devicetree/base
	for n in "$dt_base"/soc*/nss*; do
		if [ -r "$n/qcom,max-frequency" ]; then
			dt_node="$n"
			break
		fi
	done

	local low_hz mid_hz max_hz
	if [ -n "$dt_node" ]; then
		[ -r "$dt_node/qcom,low-frequency" ] && low_hz=$(printf "%d" 0x$(hexdump -e '4/1 "%02x"' "$dt_node/qcom,low-frequency" 2>/dev/null))
		[ -r "$dt_node/qcom,mid-frequency" ] && mid_hz=$(printf "%d" 0x$(hexdump -e '4/1 "%02x"' "$dt_node/qcom,mid-frequency" 2>/dev/null))
		[ -r "$dt_node/qcom,max-frequency" ] && max_hz=$(printf "%d" 0x$(hexdump -e '4/1 "%02x"' "$dt_node/qcom,max-frequency" 2>/dev/null))
	fi

	json_add_array "frequencies"
	for hz in "$low_hz" "$mid_hz" "$max_hz"; do
		if [ -n "$hz" ] && [ "$hz" -gt 0 ] 2>/dev/null; then
			json_add_string "" "$(awk -v h="$hz" 'BEGIN { printf "%.1f MHz", h / 1000000 }')"
		fi
	done
	json_close_array
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
	# 模块加载状态与冲突配置不属于秒级遥测：30s TTL 缓存，避免每次 getMetrics
	# 都对未加载模块执行 /lib/modules glob，以及 fork uci 读 flow_offloading。
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

	# 软件分载冲突检测：读全局段（LuCI「网络→接口→全局网络选项」的实际写入处）；
	# 兼容旧版本误写入 @device[0] 的残留值
	conflict=0
	flow_off=$(uci -q get network.globals.flow_offloading 2>/dev/null)
	[ -z "$flow_off" ] && flow_off=$(uci -q get network.@device[0].flow_offloading 2>/dev/null)
	[ "$flow_off" = "1" ] && conflict=1

	printf 'ts=%s\nmod_pppoe=%s\nmod_vlan=%s\nmod_bridge=%s\nmod_qdisc=%s\nmod_crypto=%s\nconflict=%s\n' \
		"$now" "$mod_pppoe" "$mod_vlan" "$mod_bridge" "$mod_qdisc" "$mod_crypto" "$conflict" \
		> "$MODULES_CACHE.$$" 2>/dev/null && mv "$MODULES_CACHE.$$" "$MODULES_CACHE" 2>/dev/null
}

probe_sqm() {
	local qdisc_mod="$1"
	if [ -z "$qdisc_mod" ]; then
		[ -n "$mod_qdisc" ] && qdisc_mod="$mod_qdisc"
		[ -z "$qdisc_mod" ] && [ -f "$MODULES_CACHE" ] && qdisc_mod=$(grep '^mod_qdisc=' "$MODULES_CACHE" 2>/dev/null | cut -d= -f2)
		qdisc_mod="${qdisc_mod:-0}"
	fi
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

	local cur_freq
	cur_freq=$(probe_nss_freq)

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

	local pbuf_def_free=0 pbuf_def_total=0 pbuf_ocm_free=0 pbuf_ocm_total=0
	local ipv4_hits=0 ipv6_hits=0 pppoe_pkts=0 ppe_v4_flows=0 ppe_v6_flows=0
	local queue_drops=0 alloc_errors=0
	local sqm_hw=0 sqm_eg_rate="" sqm_eg_fast=0 sqm_eg_codel=0 sqm_eg_drops=0
	local sqm_ig_rate="" sqm_ig_fast=0 sqm_ig_codel=0 sqm_ig_drops=0
	eval "$(lua -e '
		local function parse_kv(path, keys)
			local f = io.open(path, "r")
			if not f then return end
			for line in f:lines() do
				local k, v = line:match("^%s*([%w_%[%]]+)%s*=%s*(%d+)")
				if k and keys[k] then
					keys[k] = (keys[k] or 0) + (tonumber(v) or 0)
				end
			end
			f:close()
		end

		local n2h = {
			n2h_pbuf_def_free_count = 0, n2h_pbuf_def_total_count = 0,
			n2h_pbuf_ocm_free_count = 0, n2h_pbuf_ocm_total_count = 0,
			n2h_queue_drops = 0,
			["n2h_rx_queue[0]_drops"] = 0, ["n2h_rx_queue[1]_drops"] = 0,
			["n2h_rx_queue[2]_drops"] = 0, ["n2h_rx_queue[3]_drops"] = 0
		}
		parse_kv("/sys/kernel/debug/qca-nss-drv/stats/n2h", n2h)

		local drv = {
			drv_nbuf_alloc_errors = 0, drv_paged_buf_alloc_errors = 0,
			["drv_tx_queue_full[0]"] = 0, ["drv_tx_queue_full[1]"] = 0,
			drv_rx_bad_desciptor = 0
		}
		parse_kv("/sys/kernel/debug/qca-nss-drv/stats/drv", drv)

		local eth_rx = {
			["eth_rx_rx_queue[0]_drops"] = 0, ["eth_rx_rx_queue[1]_drops"] = 0,
			["eth_rx_rx_queue[2]_drops"] = 0, ["eth_rx_rx_queue[3]_drops"] = 0
		}
		parse_kv("/sys/kernel/debug/qca-nss-drv/stats/eth_rx", eth_rx)

		local ip4 = {
			ipv4_hash_hits = 0,
			["ipv4_rx_queue[0]_drops"] = 0, ["ipv4_rx_queue[1]_drops"] = 0,
			["ipv4_rx_queue[2]_drops"] = 0, ["ipv4_rx_queue[3]_drops"] = 0
		}
		parse_kv("/sys/kernel/debug/qca-nss-drv/stats/ipv4", ip4)

		local ip6 = {
			ipv6_hash_hits = 0,
			["ipv6_rx_queue[0]_drops"] = 0, ["ipv6_rx_queue[1]_drops"] = 0,
			["ipv6_rx_queue[2]_drops"] = 0, ["ipv6_rx_queue[3]_drops"] = 0
		}
		parse_kv("/sys/kernel/debug/qca-nss-drv/stats/ipv6", ip6)

		local ppp = {
			pppoe_rx_packets = 0, pppoe_tx_packets = 0,
			["pppoe_rx_dropped[0]"] = 0, ["pppoe_rx_dropped[1]"] = 0,
			["pppoe_rx_dropped[2]"] = 0, ["pppoe_rx_dropped[3]"] = 0
		}
		parse_kv("/sys/kernel/debug/qca-nss-drv/stats/pppoe", ppp)

		local ppe_v4, ppe_v6 = 0, 0
		local pf = io.open("/sys/kernel/debug/qca-nss-drv/stats/ppe/connection", "r")
		if pf then
			for line in pf:lines() do
				local v4 = line:match("ppe_v4 routed flows%s*=%s*(%d+)")
				if v4 then ppe_v4 = tonumber(v4) or 0 end
				local v6 = line:match("ppe_v6 routed flows%s*=%s*(%d+)")
				if v6 then ppe_v6 = tonumber(v6) or 0 end
			end
			pf:close()
		end

		local qdrops = n2h.n2h_queue_drops
			+ n2h["n2h_rx_queue[0]_drops"] + n2h["n2h_rx_queue[1]_drops"]
			+ n2h["n2h_rx_queue[2]_drops"] + n2h["n2h_rx_queue[3]_drops"]
			+ eth_rx["eth_rx_rx_queue[0]_drops"] + eth_rx["eth_rx_rx_queue[1]_drops"]
			+ eth_rx["eth_rx_rx_queue[2]_drops"] + eth_rx["eth_rx_rx_queue[3]_drops"]
			+ ip4["ipv4_rx_queue[0]_drops"] + ip4["ipv4_rx_queue[1]_drops"]
			+ ip4["ipv4_rx_queue[2]_drops"] + ip4["ipv4_rx_queue[3]_drops"]
			+ ip6["ipv6_rx_queue[0]_drops"] + ip6["ipv6_rx_queue[1]_drops"]
			+ ip6["ipv6_rx_queue[2]_drops"] + ip6["ipv6_rx_queue[3]_drops"]
			+ ppp["pppoe_rx_dropped[0]"] + ppp["pppoe_rx_dropped[1]"]
			+ ppp["pppoe_rx_dropped[2]"] + ppp["pppoe_rx_dropped[3]"]

		local aerrs = drv.drv_nbuf_alloc_errors + drv.drv_paged_buf_alloc_errors
			+ drv["drv_tx_queue_full[0]"] + drv["drv_tx_queue_full[1]"]
			+ drv.drv_rx_bad_desciptor

		local sqm_hw = 0
		local eg_rate, eg_fast, eg_codel, eg_drops = "", 0, 0, 0
		local ig_rate, ig_fast, ig_codel, ig_drops = "", 0, 0, 0
		local qf = io.open("/sys/module/qca_nss_qdisc/refcnt", "r")
		if qf then
			local rc = tonumber(qf:read("*l") or "0") or 0
			qf:close()
			if rc > 0 then
				local p = io.popen("tc -s qdisc show 2>/dev/null")
				if p then
					local cur_dir, cur_q = nil, nil
					for line in p:lines() do
						if line:match("^qdisc ") then
							local dev = line:match(" dev (%S+) ") or "default"
							cur_dir = dev:match("^ifb") and "ig" or "eg"
							if line:match("^qdisc nsstbl ") then
								cur_q = "tbl"
								local rate = line:match(" rate (%S+) ") or ""
								if rate ~= "" then
									sqm_hw = 1
									if cur_dir == "ig" then ig_rate = rate else eg_rate = rate end
								end
							elseif line:match("^qdisc nsspfifo ") then
								cur_q = "fast"
							elseif line:match("^qdisc nssfq_codel ") then
								cur_q = "codel"
								sqm_hw = 1
							else
								cur_q = nil
							end
						elseif cur_q then
							local pkts, drp = line:match("Sent %d+ bytes (%d+) pkt %(dropped (%d+)")
							if pkts then
								local n_pkts, n_drp = tonumber(pkts) or 0, tonumber(drp) or 0
								if cur_q == "fast" then
									if cur_dir == "ig" then ig_fast = ig_fast + n_pkts else eg_fast = eg_fast + n_pkts end
								elseif cur_q == "codel" then
									if cur_dir == "ig" then
										ig_codel = ig_codel + n_pkts
										ig_drops = ig_drops + n_drp
									else
										eg_codel = eg_codel + n_pkts
										eg_drops = eg_drops + n_drp
									end
								end
							end
						end
					end
					p:close()
				end
			end
		end

		print(string.format(
			"pbuf_def_free=%d pbuf_def_total=%d pbuf_ocm_free=%d pbuf_ocm_total=%d " ..
			"ipv4_hits=%.0f ipv6_hits=%.0f pppoe_pkts=%.0f ppe_v4_flows=%d ppe_v6_flows=%d " ..
			"queue_drops=%d alloc_errors=%d sqm_hw=%d " ..
			"sqm_eg_rate=%q sqm_eg_fast=%d sqm_eg_codel=%d sqm_eg_drops=%d " ..
			"sqm_ig_rate=%q sqm_ig_fast=%d sqm_ig_codel=%d sqm_ig_drops=%d",
			n2h.n2h_pbuf_def_free_count, n2h.n2h_pbuf_def_total_count,
			n2h.n2h_pbuf_ocm_free_count, n2h.n2h_pbuf_ocm_total_count,
			ip4.ipv4_hash_hits, ip6.ipv6_hash_hits,
			ppp.pppoe_rx_packets + ppp.pppoe_tx_packets,
			ppe_v4, ppe_v6, qdrops, aerrs, sqm_hw,
			eg_rate, eg_fast, eg_codel, eg_drops,
			ig_rate, ig_fast, ig_codel, ig_drops
		))
	' 2>/dev/null)"

	# 冲突标志随模块探测走 30s TTL 缓存（见 probe_modules_state），
	# 此处只需确保已探测——add_modules_object 末尾的调用会命中缓存
	probe_modules_state

	json_add_int "heartbeat" "${heartbeat:-0}"
	json_add_double "nss_bytes" "${nss_bytes:-0}"
	json_add_string "nss_freq" "$cur_freq"
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

	json_add_int "pbuf_def_free" "${pbuf_def_free:-0}"
	json_add_int "pbuf_def_total" "${pbuf_def_total:-0}"
	json_add_int "pbuf_ocm_free" "${pbuf_ocm_free:-0}"
	json_add_int "pbuf_ocm_total" "${pbuf_ocm_total:-0}"
	json_add_double "ipv4_hits" "${ipv4_hits:-0}"
	json_add_double "ipv6_hits" "${ipv6_hits:-0}"
	json_add_double "pppoe_pkts" "${pppoe_pkts:-0}"
	json_add_int "ppe_v4_flows" "${ppe_v4_flows:-0}"
	json_add_int "ppe_v6_flows" "${ppe_v6_flows:-0}"
	json_add_int "queue_drops" "${queue_drops:-0}"
	json_add_int "alloc_errors" "${alloc_errors:-0}"
	json_add_int "sqm_hw" "${sqm_hw:-0}"
	json_add_string "sqm_eg_rate" "${sqm_eg_rate:-}"
	json_add_int "sqm_eg_fast" "${sqm_eg_fast:-0}"
	json_add_int "sqm_eg_codel" "${sqm_eg_codel:-0}"
	json_add_int "sqm_eg_drops" "${sqm_eg_drops:-0}"
	json_add_string "sqm_ig_rate" "${sqm_ig_rate:-}"
	json_add_int "sqm_ig_fast" "${sqm_ig_fast:-0}"
	json_add_int "sqm_ig_codel" "${sqm_ig_codel:-0}"
	json_add_int "sqm_ig_drops" "${sqm_ig_drops:-0}"

	add_modules_object
}
