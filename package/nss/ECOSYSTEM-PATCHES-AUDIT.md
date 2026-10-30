# 高通 IPQ807x / IPQ60xx NSS 生态 Fork 补丁审计与吸收真理源

> **文档状态**：已固化（2026-10-29 讨论决议）  
> **分支基底**：`nss-edma-julius`  
> **核心原则**：本文档记录了对整个高通开源社区及各大活跃 Fork 仓库（Julius、kuncy7、VIKINGYFY、sinancetinkaya、77160860 等）的完整技术对齐审计。**列入本清单的项目均已完成原理排查、实地核验与最终裁决，后续迭代严禁重复翻案或无端展开同质化讨论。**

---

## 一、 已全量吸收并落地的补丁清单 (Absorbed & Built Successfully)

以下 6 大核心补丁经实机交叉编译校验（ThinkCentre-M910X），内核、NSS 驱动全家桶、设备镜像编译 100% 通过（0 错误 0 警告）：

| 编号 | 资产名称 / 功能 | 涉及文件 | 来源与追溯索引 | 核心原理与解决痛点 | 实机编译验证 |
|---|---|---|---|---|:---:|
| **P-01** | Dnsmasq reload procd/ujail 信号竞态修复 | `package/network/services/dnsmasq/files/dnsmasq.init` | `kuncy7` (`4432bd5460`), OpenWrt Issue [#25409](https://github.com/openwrt/openwrt/issues/25409), PR [#25983](https://github.com/openwrt/openwrt/pull/25983) | 在 reload 时比对实例定义与 md5 指纹，仅对未重启实例发 SIGHUP，根除频繁改配置引发 ujail 崩溃导致 procd crash loop 掐死 DNS。 | ✅ 通过 |
| **P-02** | mac80211 吞吐估算 RCU 读保护锁 | `package/kernel/mac80211/patches/subsys/361-*.patch` | `kuncy7` (`8d87ab6164`), branch `mac80211-361-rcu` | 在 `sta_estimate_expected_throughput()` 读取 `chanctx_conf` 外层补充 RCU 读锁，消除 `iw station dump` 或 Usteer 轮询时内核报出的 `WARNING: suspicious RCU usage`。 | ✅ 通过 |
| **P-03** | PCIe ath11k DP 环中断散列多核 | `package/kernel/mac80211/patches/ath11k/959-*.patch` | `JuliusBairaktaris` (`49c55225fc`), OpenWrt Issue [#26242](https://github.com/openwrt/openwrt/issues/26242), PR [#26253](https://github.com/openwrt/openwrt/pull/26253) | 将 PCIe 独立无线芯片（如 QCN9074）的 4 个 REO 硬件接收环中断均匀散列到 4 颗 CPU，释放 PCIe 无线网卡多核线速吞吐。 | ✅ 通过 |
| **P-04** | PPPoE lockless xmit 无锁直通发包 | `target/linux/generic/pending-6.18/652-*` & `653-*` | `JuliusBairaktaris` (`0e72354cdf`) | 为 `ppp_generic` 消除 unit/channel 互斥锁，降低 CPU 协议栈在多核大流量并发上传时的锁争用（CPU 占用下降约 3.2%）。 | ✅ 通过 |
| **P-05** | NSS 接管 GMAC 时拦截 ethtool 防死锁 | `target/linux/qualcommax/patches-6.18/0958a-*.patch` | `kuncy7` (`f6afff4714`), Issue [#52](https://github.com/kuncy7/openwrt-nss-edma/issues/52) | 当 GMAC 被 NSS 固件接管时，拦截 `ethtool -G/-L` 变更并返回 `-EBUSY`，根除驱动因对已禁用队列调用 `napi_disable` 造成的 `rtnl_lock` 永久死锁。 | ✅ 通过 |
| **P-06** | Spectrum SAX1V1K 专属三级温控风扇配置 | `target/linux/qualcommax/dts/ipq8072-sax1v1k.dts` & `ipq807x/config-default` | `77160860` / `VIKINGYFY` (`754ed2b4f1`) | 启用 `pwm-gpio` 与 `pwm-fan`，并在 cpu0~cpu3 与 cluster 上配置 70°C/80°C/90°C 三级阶梯降温调速。 | ✅ 通过 |

---

## 二、 已讨论并核实：基底早已包含（严禁重复讨论/重复吸收）

以下项目在各大 Fork 中频繁出现，但在实地代码树审查中已证实**当前代码基底中早已具备**：

1. **ath11k 多播描述符指针偏移泄漏 (`ee8ec00e89`)**：
   - 所在文件：`package/kernel/mac80211/patches/nss/ath11k/244a-*`
   - 核查结论：在当前分支基底提交 `56d691c69c` 中已预置完整 patch。
2. **EDMA 短报文硬件校验和填充回落 (`2ed2c210c3`)**：
   - 所在文件：`qca_edma.c` (`EDMA_RXPH_L3_OFFSET_SHIFT`)
   - 核查结论：在当前分支基底提交 `e8ca976eff` 中已包含。
3. **ath11k 160MHz NSS 空间流比率映射 (`953` 补丁)**：
   - 所在文件：`package/kernel/mac80211/patches/ath11k/953-wifi-ath11k-apply-the-160-MHz-NSS-ratio-to-the-radio.patch`
   - 核查结论：本地基底已自带正式 patch。
4. **USXGMII 速率握手掉速回退重连 (`59f295f58f`)**：
   - 所在文件：`target/linux/qualcommax/files/drivers/net/pcs/pcs-qca-uniphy.c`
   - 核查结论：基底提交 `145821ae50` 中已完整合并 Julius 的最终版自协商回退重连逻辑。
5. **sysupgrade 刷机断网发 PADT 报文 (`a9931386ea`)**：
   - 所在文件：`package/base-files/files/sbin/sysupgrade`
   - 核查结论：基底提交 `a1cf78f741` 中已预置 `/etc/init.d/network shutdown` 优雅下线。
6. **hostapd 802.11k 链路测量报告噪点清除 (`600-ubus_support.patch`)**：
   - 所在文件：`package/network/services/hostapd/patches/600-ubus_support.patch`
   - 核查结论：已在基底提交 `c4ca49f0c6` 中通过 `if (hapd->link_mesr_req_active)` 守卫根治。

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
5. **独立 Host-Driven PPE 方案流控套件 (`luci-app-qca-ppe-qos`, `sqm-scripts-ppe`)**：
   - 裁决原因：该方案专用于**未加载 NSS 固件**的纯 Linux 主机驱动 PPE 架构，深度依赖 `/sys/module/qca_ppe` 节点；在我们的 NSS 固件与 ECM 加速体系下无法挂载。当前固件采用的原生 `package/nss/nssqos` 与 `sqm-scripts-nss` 为芯片级加速正统方案，两者架构绝缘。
6. **特定机型专用 Extroot 与分区覆盖脚本 (如 NBG7815 分区魔改)**：
   - 裁决原因：极度特化于单一特定硬件机型，包含破坏通用升级规范的非标准分区逻辑，不合入通用生产基底。

---

## 四、 架构防摩擦与协作准则

1. 任何涉及内核网络子系统、NSS 驱动层、mac80211/ath11k 的代码审查，必须优先以本文件、`package/nss/NSS-DRIVER-REVIEW-FINDINGS.md` 与 `TROUBLESHOOTING.md` 为真理源；
2. 严禁脱离代码审查与性能压测，盲目从外部 fork 批量 cherry-pick 未经本清单评估的提交。
