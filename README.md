# ImmortalWrt QualcommAX (NSS-EDMA) 固件编译工程

本项目基于官方 OpenWrt / ImmortalWrt Master 最新基线，深度整合高通 IPQ807x / IPQ60xx 原生 NSS 硬件加速体系（NSS-EDMA / ECM 直通架构），为 Netgear Orbi RBR750、小米 AX3600、红米 AX6、Linksys MX4300/MR7350 等机型提供工业级性能加速、全套已知硬件缺陷修复与现代化生态适配。

---

## 一、 核心特性与架构定位

- **原生 NSS-EDMA / PPE 驱动架构**：运行在 Linux 6.6/6.18 内核之上，基于官方原生 `qca_edma` 与 `qca_ppe` 驱动；**完全摒弃了旧时代破坏网络栈规范的 `qca-nss-dp` 与闭源 `qca-ssdk`**；
- **全栈硬件分载 (NSS Hardware Offload)**：支持 IPv4 NAT、IPv6 路由、PPPoE、802.1Q VLAN、Bridge 桥接、Multicast IGMP/MLD Snooping、用于 SQM 的 NSS Qdisc 硬件队列、以及 `ath11k` Wi-Fi 无线硬件卸载；
- **四层分支解耦流水线**：底盘纯净追踪官方 Master，中间层解耦承载驱动与调优，顶层生产发布与主控调度分离，便于后续维护者无损变基（Rebase）与定期安全合入；
- **自研工件与体验优化**：
  - **Netgear Orbi RBR750 原生分区**：采用官方 `CI_DATA_UBIPART="reserved2"`，彻底废弃易碎的 preinit 胶水脚本，并销毁废弃卷永久释放 34.5MB SquashFS 空间；
  - **`luci-app-nss-dashboard` 工业级重构**：后端 RPC 纯无状态化、前端 V8 动态渲染、33% 栅格对齐、Native Hover 体验优化；
  - **网络加速与出海生态**：集成 SONiC FullCone NAT1 套件与 `zapret2` 种子。

---

## 二、 四层分支架构说明 (Branch Architecture)

仓库采用严格的解耦堆叠模型，任何层级的改动清晰可追溯：

```text
[base/openwrt-upstream]  ── 官方 OpenWrt Master 纯净镜像 (零私有侵入，随时快进同步)
         │
         ▼ (rebase)
[layer/julius-nss-base]  ── Vendor NSS-EDMA 协处理器驱动、内核桥接与核心补丁基盘
         │
         ▼ (rebase)
[layer/community-tuning] ── 本土化基础包 (autocore、nss_freq 动态调频、cpufreq、国内镜像源)
         │
         ▼ (rebase)
[nss-edma-julius]        ── 生产发版基底 (业务特性、高通无线栈修复、NSS Dashboard、机型原生适配)
         ▲
         │ (dispatch)
[main]                   ── 主控分支：流水线调度、Seeds 种子生态配置与 openwrt.sha 追踪锚点
```

---

## 三、 上游与参考源吸收总账 (Ecosystem Absorption Ledger)

为便于后续维护者快速审计、追踪演进并在新版本中持续吸收上游成果，现将当前工程吸收的全部核心上游仓库、分支及贡献者资产归档如下：

### 1. 官方 OpenWrt Master (`upstream-openwrt`)
- **关联远程**：`https://github.com/openwrt/openwrt.git`
- **对应层级**：`base/openwrt-upstream`（当前锚点：`593608fbda`, 2026-11-11）
- **吸收内容**：
  - Linux 6.18.60 内核通用安全补丁与网络子系统更新（含 `sch_cake` debugfs 卸载清理、批处理 watchdog、per-tin dither、多队列活跃流加权带宽共享）；
  - `mac80211` 无线协议栈子系统（含 `airtime` 吞吐估算 `WARN_ON_ONCE` 修复、`361` `sdata_dereference()` 修复，以及定向恢复/合入的上游安全与稳定补丁 `007`–`012`/`014`×2/`015`/`016`/`017`/`451`/`454`/`479`–`481`/`501`–`503`/`505`，修复 encap offload 加密/未授权端口/tainted key、monitor 引用计数泄漏、SW crypto tailroom、fast-rx A-MSDU 统计、仅 monitor 帧过滤、`AP_VLAN`/RCU/ROC 与 64-bit TU 延时）；
  - `firewall4` 原子重启、保活状态匹配、渲染失败保留旧规则及 NAT 防泄露地址族匹配（`003`/`005`/`006`/`007`）；
  - `mbedtls` 3.6.8（11 CVE + EC-JPAKE 依赖）、`ubox` (2026-11-15)、`odhcpd` (2026-11-16)、`hostapd`/`wpa_supplicant`（6GHz `op_class=132`、`set_bss_order` 防崩溃、停机先注销 ubus 防 30s 阻塞、长封禁防溢出、`ban_only`/`deauth_now`/先 Disassoc+`924` 保密钥防 MFP 丢包、`911`/`912`/`914`/`919`/`923`）、`wifi-scripts`、`netifd`、`procd`、`base-files`（LED 重置/空格名 + `sysupgrade` 优雅关闭网络发 PADT）、`dnsmasq` 上游同步。

---

### 2. Julius Bairaktaris 原生 NSS-EDMA 树 (`openwrt-nss-edma`)
- **关联上游**：`https://github.com/JuliusBairaktaris/openwrt-nss-edma.git`
- **对应层级**：`layer/julius-nss-base`
- **吸收关键成果**：
  - **原生 NSS-EDMA / ECM 驱动体系**：去除了破坏网络吞吐与公平性调度的主机软分载；
  - **Flowtable 截断守卫** (`714-netfilter-...`)：解决硬件分载下探真实物理设备时穿透 VLAN/PPPoE 上的 SQM/Cake 队列整形问题；
  - **`ath11k` Monitor 监听抓包修复**：`988` 补丁（从 TLV uplink OFDMA info 提取 Trigger-based 帧的 NSS/MCS 速率）与 `989` 补丁（Radiotap/L-SIG 速率误报修复）；
  - **pstore 崩溃转储守卫** (`c3c7c4745a`)：防止早期开机时 NTP 授时跳变将 RAMOOPS 崩溃日志作为过期日志丢弃；
  - **ARMv8 CE 硬件加速** (`aa4eab97fb`)：补齐 AES-CCM 硬件指令集加速；
  - **`ath11k` 生产级稳定性与 NSS 协同加固**：PTK 原位替换、国家码管制域信道限制适配、QMI 队列移除保护、WDS 4addr `AP_VLAN` 学习与卸载防 UAF（`999-934`/`999-940`/`999-941`）、RFC 8325 (`dscp_tid_map_rfc8325`) NSS TCL 队列映射（`999-942`）及并发 Monitor 下 WMI/NSS 双向 Ethernet 锁定与 `nss_ap_isolate` 恢复同步（`999-943`）；
  - **PPE 队列、时钟与 EDMA 驱动加固**：多队列 TDM 锁步、DRR 调度、multicast 队列防丢包与 `qca_ppe_port_mdb_del` CPU 端口守卫、Port 3 `pcs_args` 长度校验；`qca_edma` 分片 RX 丢弃、ARM64 `smp_store_release`/`smp_load_acquire` TX 环序、`edma_ndo_stop` IRQ 重屏蔽 + `synchronize_irq` 与 `edma_rings_drain` BQL 复位；`qca_ppe` + `pcs-qca-uniphy` 双向时钟选源，以及 IPQ8074/IPQ6018 Port 5 SGMII 速率与 USB Master `BRANCH_HALT_VOTED` 双平台对齐（`0921`/`0922`/`0923`/`0924`）；
  - **NSS 驱动边界安全审计加固**：`qca-nss-drv` `0009`（`dynamic_interface` 发送路径类型与节点越界校验）、`qca-nss-clients` `0005`（`match` 与 `tunipip6` sysctl `copy_from_user` `-EFAULT`、无符号 `if_num` 与空指针守卫）。

---

### 3. qosmio (Robert Marko) 生态树与分支 PR 成果
- **关联上游**：`https://github.com/qosmio/nss-packages.git` 与 `https://github.com/qosmio/openwrt-ipq.git`
- **吸收关键成果与社区贡献者**：
  - **Mohamed Radwan** (`nss-packages#72`)：`qca-nss-drv` 引入 `napi_complete_done`，彻底消除 NAPI busy-poll 模式下的 IRQ 平衡报警；
  - **Sean Khan**：
    - `qca-nss-drv` (`nss-packages@dca6e6e880`)：移除 `nss_ppe_vp` 中冗余的 `copy_from_user`，防止写操作触发 `-EFAULT`；
    - `qca-nss-ecm` (`nss-packages@e5831d6123`)：增加 `'del *'` 通配符指令，支持一键清空拒绝端口列表；
    - `wifi-scripts` (`openwrt-ipq@dac2e2868b`)：WPA3 FT-SAE 快速漫游支持 `auth_server_shared_secret` 别名；
  - **Yuen Su**：
    - `ath11k` (`openwrt-ipq#131`)：将未就绪的 NSS 上下文失败重定向至注销流程，防止无线接口泄露；
    - `mac80211` (`openwrt-ipq#130`)：为 `HAS_TX_QUEUE` 驱动将主机队列初始化为 `IEEE80211_AC_BE`；
  - **Andrei-Alexandru Bleortu** (`nss-packages#77`)：`qca-nss-clients` vxlanmgr 释放隧道路由查找并增加 IPv6 `IS_ERR` 守卫；
  - **ZyPulse** (`nss-packages#79`)：`qca-nss-drv` 追加 `CONFIG_NSS_FIRMWARE_VERSION_12_5` 编译依赖。

---

### 4. VIKINGYFY / 社区调优分支 (`vikingyfy`)
- **关联上游**：`https://github.com/VIKINGYFY/immortalwrt.git`
- **对应层级**：`layer/community-tuning`
- **吸收内容**：
  - **`nss_freq`**：纯净直接 PLL 寄存器时钟控制工具（NPU 动态调频与真实运行频率侦测）；
  - **`autocore`**：多核 ARM64 负载均衡与状态监测；
  - **`cpufreq`**：默认 Schedutil 调度器调优；
  - 中国本土化软件源、APK 镜像与 NTP Pool 适配。

---

### 5. 潘楚琨 (Chukun Pan / LKML) 硬件补丁
- **作者信息**：`amadeus@jmu.edu.cn` (Linux Kernel Mailing List)
- **吸收内容**：
  - **USB Master 时钟挂起修复** (`0924-clk-qcom-gcc-ipq8074-set-BRANCH_HALT_VOTED-...` & `0923-clk-qcom-gcc-ipq6018-set-BRANCH_HALT_VOTED-...`)：原厂闭源 U-Boot (如 Netgear RBR750 / Linksys MX5300) 未注销时钟，Linux 启动期关断未使用时钟时因缺少 `BRANCH_HALT_VOTED` 导致轮询 200 次超时挂起并产生内核 `Tainted: [W]` 污点；双平台打入此补丁后彻底根除报警；
  - **IPQ USB Fastlock 增益校准** (`1ec7bc0a57`)：在 RX bank 正确配置 USB fastlock gain；
  - **Qualcomm USB Host 供电归属修正** (`5e48121d93`)；
  - **IPQ6018 PHY PIPE 时钟绑定** (`9ef5d4c1e7`)。

---

### 6. Canary233 / LibWrt
- **来源引用**：`references/LibWrt` (commit `6667298b2d`)
- **吸收内容**：
  - **ECM 期望连接空指针崩溃守卫** (`0972-netfilter-nf_conntrack-null-check-expect-event.patch`)：修复高通 Vendor ECM 驱动注册通知结构体时未实现 `.exp_event`，导致处理 FTP 被动模式、SIP、H.323 等 ALG 期望连接时无条件调用造成 `pc: 0x0` 空指针宕机（Kernel Panic）。

---

### 7. 本地自研与专项工程集成 (Solarflows)
- **Netgear Orbi RBR750 架构原生化**：
  - 实现基于官方标准的 `CI_DATA_UBIPART="reserved2"`；
  - 销毁旧版本残留的 `rootfs_data_old` 卷，释放 34.5MB SquashFS 空间；
  - 彻底移除 `lib/preinit/79_netgear_rbr750_overlay` 易碎胶水脚本。
- **`luci-app-nss-dashboard` 工业级重构**：
  - 后端 RPC 完全去除展示用中文，移交前端 V8 与 LuCI `_()` 原生国际化；
  - 严格采用官方 33% 栅格对齐；
  - 消除点状下划线污染，改用 Native Hover；
  - 展开态独立全宽子行（Accordion Sub-Row）杜绝浮层抽搐。
- **出海代理与网络优化**：
  - 集成 SONiC FullCone NAT1 套件；
  - 集成 `damocjwj/openwrt-zapret2` 种子配置。

---

## 四、 编译与构建说明

### 1. 本地编译
```bash
git clone -b nss-edma-julius https://github.com/solarflows/ImmortalWrt-QualcommAX.git
cd ImmortalWrt-QualcommAX

# 更新并安装 Feeds
./scripts/feeds update -a && ./scripts/feeds install -a

# 导入种子配置 (例如 Netgear RBR750 / IPQ807x)
cp configs/ipq807x/10-proxy.seed .config
make defconfig

# 启动多核编译
make -j$(nproc)
```

### 2. 云端 CI 自动化流水线
仓库根目录包含 `.github/workflows/firmware-builder.yml`，支持多矩阵自动化构建，由 `main` 分支的调度器和 `configs/` 种子矩阵驱动。

---

## 五、 致谢与引用 (Acknowledgements)

- [Julius Bairaktaris](https://github.com/JuliusBairaktaris) 提供革命性的原生 NSS-EDMA / PPE 驱动融合架构；
- [Robert Marko (robimarko / qosmio)](https://github.com/robimarko) 为 OpenWrt qualcommax 目标与 NSS 打包付出的长期努力；
- [Christian Marangi (Ansuel)](https://github.com/Ansuel) 提供上游 EDMA 与 PPE 驱动基石；
- [VIKINGYFY](https://github.com/VIKINGYFY) 提供本土化与调优实践；
- [Chukun Pan (潘楚琨)](https://github.com/ChukunPan) 提供精准的内核时钟与硬件补丁；
- [Canary233](https://github.com/Canary233) 提供 ECM 期望连接空指针修复。

---

## 六、 许可证

GPL-2.0 许可证，详见 [LICENSE](LICENSE)。所有 NSS 组件保留其上游许可证。
