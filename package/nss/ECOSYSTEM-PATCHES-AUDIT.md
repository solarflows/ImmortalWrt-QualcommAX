# 高通 IPQ807x / IPQ60xx NSS 生态 Fork 补丁审计与吸收真理源

> **文档状态**：已同步更新（2026-11-18 全量复盘审计）  
> **分支基底**：`nss-edma-julius`（基于 `base/openwrt-upstream` `593608fbda`, 2026-11-11）  
> **核心原则**：本文档记录了对整个高通开源社区及各大活跃 Fork 仓库（Julius、kuncy7、VIKINGYFY、qosmio、sinancetinkaya、77160860 等）的完整技术对齐审计。**列入本清单的项目均已完成原理排查、实地核验与最终裁决，后续迭代严禁重复翻案或无端展开同质化讨论。**

---

## 一、 已全量吸收并落地的补丁清单 (Absorbed & Built Successfully)

以下核心补丁均经实机交叉编译校验（ThinkCentre-M910X），内核、mac80211/ath11k、NSS 驱动全家桶、userspace 包编译 100% 通过：

| 编号 | 资产名称 / 功能 | 涉及文件 | 来源与追溯索引 | 核心原理与解决痛点 | 实机编译验证 |
|---|---|---|---|---|:---:|
| **P-01** | Dnsmasq reload procd/ujail 信号竞态修复 | `package/network/services/dnsmasq/files/dnsmasq.init` | `kuncy7` (`4432bd5460`), OpenWrt Issue [#25409](https://github.com/openwrt/openwrt/issues/25409), PR [#25983](https://github.com/openwrt/openwrt/pull/25983) | 在 reload 时比对实例定义与 md5 指纹，仅对未重启实例发 SIGHUP，根除频繁改配置引发 ujail 崩溃导致 procd crash loop 掐死 DNS。 | ✅ 通过 |
| **P-02** | mac80211 吞吐估算 RCU/wiphy 锁修复 | `package/kernel/mac80211/patches/subsys/361-*.patch` | OpenWrt 上游 `e4d0856463` (Felix Fietkau)，取代早期 `kuncy7` `rcu_read_lock` 方案 | `sta_set_sinfo()` 运行于 wiphy mutex 下，改用 `sdata_dereference()` 读取 `chanctx_conf`，彻底消除 `WARNING: suspicious RCU usage`。 | ✅ 通过 |
| **P-03** | PCIe ath11k DP 环中断散列多核 | `package/kernel/mac80211/patches/ath11k/982-*.patch` | `JuliusBairaktaris` (`49c55225fc`), OpenWrt PR [#26253](https://github.com/openwrt/openwrt/pull/26253) | 将 PCIe 独立无线芯片（如 QCN9074）的 4 个 REO 硬件接收环中断均匀散列到 4 颗 CPU，释放 PCIe 无线网卡多核线速吞吐。 | ✅ 通过 |
| **P-04** | PPPoE lockless xmit 无锁直通发包 | `target/linux/generic/pending-6.18/652-*` & `653-*` | `JuliusBairaktaris` (`0e72354cdf`) | 为 `ppp_generic` 消除 unit/channel 互斥锁，降低 CPU 协议栈在多核大流量并发上传时的锁争用（CPU 占用下降约 3.2%）。 | ✅ 通过 |
| **P-05** | NSS 接管 GMAC 时拦截 ethtool 防死锁 | `target/linux/qualcommax/patches-6.18/0958a-*.patch` | `kuncy7` (`f6afff4714`), Issue [#52](https://github.com/kuncy7/openwrt-nss-edma/issues/52) | 当 IPQ50xx GMAC (`stmmac`) 被 NSS 固件接管时，拦截 `ethtool -G/-L` 返回 `-EBUSY`（IPQ807x/60xx 使用 `qca_edma` 未暴露此接口，天然免疫）。 | ✅ 通过 |
| **P-06** | Spectrum SAX1V1K 专属三级温控风扇配置 | `target/linux/qualcommax/dts/ipq8072-sax1v1k.dts` & `ipq807x/config-default` | `77160860` / `VIKINGYFY` (`754ed2b4f1`) | 启用 `pwm-gpio` 与 `pwm-fan`，并在 cpu0~cpu3 与 cluster 上配置 70°C/80°C/90°C 三级阶梯降温调速。 | ✅ 通过 |
| **P-07** | qca-nss-drv NAPI busy poll 中断使能平衡 | `package/nss/qca-nss-drv/patches/0007-*.patch` | `qosmio/nss-packages` PR [#72](https://github.com/qosmio/nss-packages/pull/72) by Mohamed Radwan | 将 4 处 NAPI 退出出口升级为 `napi_complete_done()`，消除内核在 busy poll 下报出的 `Unbalanced enable for IRQ` 告警。 | ✅ 通过 |
| **P-08** | qca-nss-drv PPE VP proc 写入 `-EFAULT` 修复 | `package/nss/qca-nss-drv/patches/0008-*.patch` | `qosmio/nss-packages` Commit [`dca6e6e880`](https://github.com/qosmio/nss-packages/commit/dca6e6e880) by Sean Khan | 铲除 `proc_dostring` 之后的二次 `copy_from_user`，消除写入虚拟端口时的 `-EFAULT` 拒绝。 | ✅ 通过 |
| **P-09** | qca-nss-ecm 加速黑名单通配符批量清空 | `package/nss/qca-nss-ecm/patches/0003-*.patch` | `qosmio/nss-packages` Commit [`e5831d6123`](https://github.com/qosmio/nss-packages/commit/e5831d6123) by Sean Khan | 支持 `echo del * > /proc/sys/net/ecm/*_denied_ports` 遍历清空所有哈希桶，简化黑名单运维。 | ✅ 通过 |
| **P-10** | qca-nss-clients VxLAN 隧道路由泄露与判空修复 | `package/nss/qca-nss-clients/patches/0004-*.patch` | `qosmio/nss-packages` PR [#77](https://github.com/qosmio/nss-packages/pull/77) by Andrei-Alexandru Bleortu | IPv4 查询后释放 `ip_rt_put(rt)`，IPv6 改用 `IS_ERR()` 判空并配对 `dst_release`，根除路由泄露。 | ✅ 通过 |
| **P-11** | ath11k NSS 初始化失败反注册回滚 | `package/kernel/mac80211/patches/nss/ath11k/999-939-*.patch` | `qosmio/openwrt-ipq` PR [#131](https://github.com/qosmio/openwrt-ipq/pull/131) by Yuen Su | 修复 `ath11k_nss_init()` 状态机未就绪时未执行反注册导致的 NSS 数据平面接口句柄泄漏。 | ✅ 通过 |
| **P-12** | mac80211 HAS_TX_QUEUE 主机发送队列变量初值化 | `package/kernel/mac80211/patches/nss/subsys/999-926-*.patch` | `qosmio/openwrt-ipq` PR [#130](https://github.com/qosmio/openwrt-ipq/pull/130) by Yuen Su | 为跳过软件队列选择的发包局部变量赋初值 `IEEE80211_AC_BE`，杜绝内核栈随机脏数据越界。 | ✅ 通过 |
| **P-13** | wifi-scripts WPA3 FT-SAE 漫游单密钥规范别名 | `package/network/config/wifi-scripts/.../ap.uc` | `qosmio/openwrt-ipq` Commit [`dac2e2868b`](https://github.com/qosmio/openwrt-ipq/commit/dac2e2868b) by Sean Khan | 支持 `auth_server_shared_secret` 别名读取，消除 WPA3 漫游报错 `FT_KEY_CANT_BE_DERIVED`。 | ✅ 通过 |
| **P-14** | mac80211 上游安全/稳定补丁定向恢复 (14 项) | `package/kernel/mac80211/patches/subsys/{007..015,451,454,479..481}` | `base/openwrt-upstream` (`593608fbda`) | 恢复被 `caf712b388` 误删的 encap offload 加密/未授权端口/tainted key 安全修复（`008`–`012`）及 AP_VLAN/TXQ/RCU/ROC 稳定性补丁，同步适配 `nss/subsys/{236,245,999-926}` 并移除 `999-929` 冗余 CE reap 检查。 | ✅ 通过 |
| **P-15** | ath11k 生产稳定性套件 (`911`/`980`/`988`/`989`/`993`/`996`/`997`/`999`) | `package/kernel/mac80211/patches/ath11k/` | `JuliusBairaktaris` / `VIKINGYFY` / `openwrt-arista` | 覆盖固件崩溃恢复所有权、Monitor TB/SIG 速率、PTK 原位替换、QMI 排空、已安装校准优先、国家码带宽截断与直接固件请求。 | ✅ 通过 |
| **P-16** | EDMA/PPE/PCS/时钟双平台加固（IPQ8074 & IPQ6018） | `qca_edma.c`, `qca_ppe_main.c`, `pcs-qca-uniphy.c`, `patches-6.18/{0149,0921..0924}` | `JuliusBairaktaris` / `Chukun Pan` / `VIKINGYFY` + 自研审计扩展 | 补齐 RX 分片丢弃、ARM64 TX 内存屏障、stop IRQ 重屏蔽+`synchronize_irq`、drain BQL 复位；PPE/PCS 双向选源；IPQ8074 & IPQ6018 Port 5 SGMII 速率与 USB `BRANCH_HALT_VOTED` 双平台对称对齐。 | ✅ 通过 |
| **P-17** | CAKE 调度器清理与多核性能套件 (`710`/`737`–`739`) | `target/linux/generic/{hack,pending}-6.18/` | `upstream-openwrt` / `VIKINGYFY` | 卸载清理 debugfs 防 UAF、批处理 watchdog、per-tin rounding dither、多队列活跃流加权共享。 | ✅ 通过 |
| **P-18** | qca-nss-drv (`0009`) & qca-nss-clients (`0005`) 边界安全加固 | `package/nss/qca-nss-{drv,clients}/patches/` | 本仓库全量代码审计 + `qosmio`/`VIKINGYFY` 交叉核验 | 拦截 `dynamic_interface` 越界类型/节点；修复 `match`/`tunipip6` sysctl 二次 `copy_from_user` `-EFAULT`、无符号 `if_num` 与空指针解引用；清理 `pppoe` 孤立 `done:` 标签。 | ✅ 通过 |
| **P-19** | 内核硬件与用户态安全/稳定性批次 | `firewall4`, `hostapd`, `wifi-scripts`, `netifd`, `procd`, `base-files`, `mbedtls`, `odhcpd`, `remoteproc`, `qca807x`/`8081`, `usb` | `upstream-openwrt` / `VIKINGYFY` / `JuliusBairaktaris` | `mbedtls` 3.6.8 (11 CVE)、`odhcpd` (2026-11-16)、`fw4` 原子重启/保活/渲染失败保留旧规则/NAT 防泄露地址族匹配、`hostapd` 6GHz & `set_bss_order`、`netifd` 网桥刷新、`remoteproc` coredump 内存预算、USB VBUS/Fastlock/DWC3-legacy、`pstore-archive` NTP 防跳变。 | ✅ 通过 |
| **P-20** | QCA PPE 多播与 Port 3 PCS 通道守卫 | `target/linux/qualcommax/files/drivers/net/ethernet/qualcomm/qca_ppe_main.c` | OpenWrt PR #26720 (`5c09af5ddf`, `bb9df4fd4f`) | `qca_ppe_port_mdb_del()` 在主机离组但交换机用户端口仍在组内时保留 CPU 端口多播掩码；`ppe_ipq6018_mux_setup()` 读取 `pcs_args.args[0]` 前检查 `args_count` 防未初始化读。 | ✅ 通过 |
| **P-21** | sysupgrade 优雅关闭网络发送 PADT | `package/base-files/files/sbin/sysupgrade` | `JuliusBairaktaris` (`e0991ec1c0`) | 在调用 `ubus call system sysupgrade` 前执行 `/etc/init.d/network shutdown`，确保 PPPoE 发出 LCP Terminate-Request 与 PADT 避免重启重拨卡滞；若升级失败则 `/etc/init.d/network restart` 恢复。 | ✅ 通过 |
| **P-22** | mac80211 监听过滤引用泄漏、fast-rx 统计与安全修复 | `package/kernel/mac80211/patches/subsys/{016,017,501..503,505}` | `upstream-openwrt` (`cb892a547f`, `bdd7b094ac`, `b5c6c2e4c4`, `134fff92d3`, `b06db99cef`, `fc1a637f99`) | `016` 修复 active monitor 关闭后硬件过滤引用计数泄漏；`017` 为 SW crypto 缺失 tailroom 扩容；`501` 64 位 TU 延时防溢出；`502` 拆分 fast-rx A-MSDU 前更新 STA RX 统计；`503` 丢弃 `RX_FLAG_ONLY_MONITOR` 帧防泄露；`505` 无 flush op 时跳过 unauth RCU 等待。 | ✅ 通过 |
| **P-23** | ath11k NSS WDS、RFC 8325 DSCP-TID、Monitor 模式与隔离同步 | `package/kernel/mac80211/patches/nss/{subsys/999-934,ath11k/999-940..999-943}` | `kuncy7` (`686fa9be73`, `5f7db84d4c`, `1d295096c4`), `JuliusBairaktaris` (`1ea004caca`, `8722828b79`) 移植适配 `ab->nss.enabled` | `999-934`/`999-940`/`999-941` 修复 WDS 4addr `AP_VLAN` ext_vdev offload、SA 学习与卸载防 UAF；`999-942` 在 NSS 模式下以 RFC 8325 写入 TCL DSCP-to-TID 表；`999-943` 在并发 monitor 关闭 decap offload 时锁定 WMI/NSS 双向 Ethernet 并在 `add_interface` 重同步 `nss_ap_isolate`。 | ✅ 通过 |
| **P-24** | hostapd / wpa_supplicant ubus 与客户端断连/MFP/CAC/PBC/DPP 加固 | `package/network/services/hostapd/{Makefile,README.md,files/*,patches/{911,912,914,919,923,924}}` | `upstream-openwrt` (`112c9284a9`, `7d8411109f`, `e7295e8438`, `7423e3bd86`, `87be38fd9b`, `f2b27e8544`, `29278064eb`, `3586d40fb1`, `e8e130a85f`, `45ad96f203`, `655fab3f8d`, `68b98b5dce`, `a0cdc009a5`, `ce7623459c`, `e0ee54a38f`, `dcfa993ce4`) | 停机先删 ubus 对象消除 `wpad` 重启 30s netifd 阻塞；修复 ubus ban 释放(`os_free`)与 >71.6 分钟 32 位超时溢出；`del_client` 支持 `ban_only`/`deauth_now` 与先发 Disassoc 并通过 `924` 保留未 ACK 密钥确保 MFP Deauth 生效；`923` 忽略过期 TX status；保留并上报 CAC；`919` 拒绝响应带 Multi-AP IE；`rrm_beacon_req` 支持 `last_indication`；`911` active PBC Beacon 带 UUID-E；`912` DPP 超时重试；校验 `RECONFIGURE == "OK"`。 | ✅ 通过 |
| **P-25** | ubox Git HEAD 与 mbedtls EC-JPAKE 依赖补齐 | `package/system/ubox/Makefile`, `package/libs/mbedtls/Config.in` | `upstream-openwrt` (`7424e2ca30`, `13fc2e4e4b`) | 同步 ubox 至 2026-11-15，并选择 EC-JPAKE 所需 mbedtls 前置依赖。 | ✅ 通过 |
| **P-26** | mac80211 阻断 AP_VLAN 跨接口数据泄露 (CVE-2026-98822) | `package/kernel/mac80211/patches/subsys/018-*.patch` | `upstream-openwrt` (`0e2c2badbe` by Felix Fietkau) 专精适配 NSS | `ieee80211_lookup_ra_sta()` 限制仅在当前接口匹配目标 STA（控制端口/EAPOL 帧除外），根除网桥泛洪时单播帧跨 VLAN 穿透防火墙泄漏漏洞；重构兼容 NSS 补丁 657 EAPOL 硬件封装。 | ✅ 通过 |
| **P-27** | IPQ8074 片上 AHB Wi-Fi DP 环中断多核散列 | `package/kernel/mac80211/patches/ath11k/983-*.patch` | `JuliusBairaktaris` (`539bc14f22`) | 为片上 AHB 无线设备（IPQ8074 内部 Wi-Fi）的 4 个 REO 目的环与 TX 完成环通过 `irq_set_affinity_and_hint()` 自动均匀散列至 CPU0~CPU3，释放 4 流 TCP 上传多核线速吞吐。 | ✅ 通过 |
| **P-28** | ath11k TCL 批处理发送消除原子锁开销 (`684c34518e`) | `package/kernel/mac80211/patches/ath11k/` | `JuliusBairaktaris` (`684c34518e`) | 经过深度源码审计与交叉编译验证，该补丁强耦合了 Julius 上游纯主机 PPE TSO 转发驱动栈（`ath11k_dp_tx_fraglist_tso`），在满血 NSS 硬件协处理器直通架构下无应用场景且会导致 patch reject。 | ❌ 判定免除 |
| **P-29** | uclient HTTP 突破 4KB CSP Header 导致超时挂死 | `package/libs/uclient/Makefile` & `patches/0001,0002` | `JuliusBairaktaris` (`0514ded08c`), PR #20 | 解决 GitHub Release 重定向附带 >4096 字节 CSP 头导致 `uclient-fetch` 解析阻塞挂起（exit 4），支持跨流缓冲区拼装 Header（上限 64KB）。 | ✅ 通过 |

---

## 二、 已讨论并核实：基底早已包含（严禁重复讨论/重复吸收）

以下项目在各大 Fork 中频繁出现，但在实地代码树审查中已证实**当前代码基底中早已具备**：

1. **ath11k 多播描述符指针偏移泄漏 (`ee8ec00e89`)**：
   - 所在文件：`package/kernel/mac80211/patches/nss/ath11k/244a-*`
   - 核查结论：在当前分支基底提交 `56d691c69c` 中已预置完整 patch。
2. **EDMA 短报文硬件校验和填充回落 (`2ed2c210c3`)**：
   - 所在文件：`qca_edma.c` (`EDMA_RXPH_L3_OFFSET_SHIFT`)
   - 核查结论：在当前分支基底提交 `e8ca976eff` 中已包含。
3. **ath11k 160MHz NSS 空间流比率映射 (`953` / `77e1366233`)**：
   - 所在文件：`package/kernel/mac80211/patches/ath11k/953-wifi-ath11k-apply-the-160-MHz-NSS-ratio-to-the-radio.patch`
   - 核查结论：本地基底已自带正式 patch。
4. **USXGMII 速率握手掉速回退重连 (`59f295f58f`) 与 UNIPHY0 SGMII/半双工修复 (`ee6860ee0f`, `53ec2d05a4`)**：
   - 所在文件：`pcs-qca-uniphy.c`、`qca_ppe_main.c`
   - 核查结论：当前分支中已完整具备自协商回退重连、`uniphy_sgmii_mode()` 与 10/100Mbps 半双工支持。
5. **ath11k PTK 原位替换 (`ec9306fa8d` / `992`)、WireGuard p2p sticky (`4d5d291a26`) 与 IPv4 `ipmr` GSO MTU 放行 (`142c6688df`)**：
   - 所在文件：`package/kernel/mac80211/patches/ath11k/992-*`、Linux 6.18.60 `drivers/net/wireguard/socket.c`、`target/linux/generic/pending-6.18/682-*`
   - 核查结论：均已在当前基底生效。
6. **hostapd 802.11k 链路测量报告噪点清除 (`600-ubus_support.patch`)、`ucode` `cb_done_ack` (`ae9276426c`) 与 `wifi-scripts` `reporting_detail` (`3f0f32ac6b`/`8ff015a72b`)**：
   - 所在文件：`600-ubus_support.patch`、`ucode-2026.10.28~dfc64d41/lib/rtnl.c`、`ubus.c`
   - 核查结论：实机源码已内置对应实现（实测在 `ucode 2026-10-28` 叠加 `100-rtnl` 会重定义 `cb_done_ack`）。

---

## 三、 已讨论并裁决：明确不合入或放弃的项 (Evaluated & Discarded)

1. **ath11k AQL v5 调度器套件 (`973..981`)**：
   - 裁决原因：实机交叉编译核验证实，AQL v5 属于非 NSS 架构下由 Linux 主机驱动纯软件处理 Wi-Fi 数据面的调度补丁（来自 Julius 提交给 Linux 上游 wireless-next 的纯通用分支）。在当前 NSS 固件树中，Wi-Fi 数据面与 TX 完成由核心补丁 `199-003-ath11k-add-nss-support.patch` 直接交由高通协处理器固件接管，两者在 `dp_tx_completion_handler` 与 `wake_tx_queue` 发生根本性符号冲突与架构互斥，故坚决放弃。
2. **Netfilter Flowtable Upper Stats 扩展 (`719-01..03`)**：
   - 裁决原因：实机交叉编译核验证实，该补丁强依赖 VIKINGYFY 分支中定制的 MediaTek 专用网桥流表扩展（`bridge_path`、`bridge_vlan` 等），在标准 Linux 6.18 内核不存在。高通方案走 NSS PPE 硬件流表，不走软流表，强行合入会导致通用内核编译失败，故坚决放弃。
3. **QCA8K tag_8021q Upper 过滤补丁 (`0959a..e`)**：
   - 裁决原因：实机交叉编译核验证实，该补丁专为 kuncy7 独立维护的 IPQ50xx（带 an8855/qca8k 重构）分支定制，与当前分支基底中 Julius 原生 `0958`（qca-8021q 支持）的上下文完全脱节，故坚决放弃。
4. **Sinan Cetinkaya 的 USXGMII 临时测试补丁 (`bb32d5b433`)**：
   - 裁决原因：属于早期在 NBG7815 上排查 10G/1G 降速的临时性状态位清理代码，后续已被 Julius 的正式提交 `59f295f58f` 完全取代，合并会导致代码逻辑冗余冲突。
5. **独立 Host-Driven PPE 方案流控套件 (`luci-app-qca-ppe-qos`, `sqm-scripts-ppe`) 与动态 `qca_ppe_scheduler.c` AQM/TBF 补丁 (`a22c8d19d8`, `2bed23026c`, `38f352235b`, `fb5c803e0c`, `63861a1cf2`)**：
   - 裁决原因：该方案专用于**未加载 NSS 固件**的纯 Linux 主机驱动 PPE 架构；本仓库保留原生 824 行静态 `qca_ppe_scheduler.c` 并采用 `package/nss/nssqos` 与 `sqm-scripts-nss` 硬件加速正统方案，两者架构绝缘。
6. **特定机型专用 Extroot、IPQ50xx-only (`qpic-snand`, `qca-nss-pbuf` CPU cap)、Wi-Fi 7 MLO 专属变更与 `ath11k` 纯 `nss-wifi-drv` 补丁 (`e2be2e0fb9`, `bc5465bb2d`, `080cc9200c`+`76d3449fb4`, `95d6512f4f`, `744e537429`)**：
   - 裁决原因：IPQ50xx 专有驱动不影响 IPQ807x/60xx；`nss-wifi-drv` 互斥于本仓库 `qca-nss-drv` + `ath11k/nss.c`（相应 QoS Null/EAPOL/`nss_ap_isolate` 能力已由 `214`/`657`/`199-001..003` + `999-943` 覆盖）；`744e537429` 在 NSS offload 下会跳过 `AP_VLAN` 重建。
7. **`crypto.mk` ARM64 CE 模块化拆包 (`02e70c7548`)**：
   - 裁决原因：本仓库 `target/linux/qualcommax/config-6.18` 已将 `CONFIG_CRYPTO_AES_ARM64_CE*` 与 `CONFIG_CRYPTO_GHASH_ARM64_CE` 设为内置（`=y`），若按外部模块打包会导致 `.ko` 缺失失败。
8. **`qca-nss-ecm` `ppp_is_multilink`/`ppp_hold_channels` 无锁替换 (`e16ba70163`)**：
   - 裁决原因：本仓库内核已应用 `652`/`653` 无锁发包补丁（未携带 QCA `__ppp_*` 导出），且 `qca-nss-ecm/Makefile` 已强制关闭 `PPTP`/`L2TPV2`，PPP 通道识别仅在控制路径建连时触发。
9. **`ath11k` TCL 批处理非原子分段计数 (`684c34518e`)**：
   - 裁决原因：经交叉编译核验证实，该补丁强依赖 Julius 针对非 NSS 纯主机 PPE 路由转发定制的切片合并补丁（`353b6253b0`，引入 `ath11k_dp_tx_fraglist_tso` 与 `qca_ppe_vp_flow_tso` 虚拟端口钩子）。在当前满血 NSS 架构下，Wi-Fi 流量由硬件协处理器直通接管，根本不走主机 PPE TSO 软件切片；脱离其定制 PPE 驱动强行合入会导致 `core.h` 与 `dp_tx.c` 出现 5 处严重 hunk reject，故判定免除。

---

## 四、 架构防摩擦与协作准则

1. 任何涉及内核网络子系统、NSS 驱动层、mac80211/ath11k 的代码审查，必须优先以本文件、`package/nss/NSS-DRIVER-REVIEW-FINDINGS.md` 与 `TROUBLESHOOTING.md` 为真理源；
2. 严禁脱离代码审查与性能压测，盲目从外部 fork 批量 cherry-pick 未经本清单评估的提交。
