# ImmortalWrt-QualcommAX 仓库四层资产全景总台账 (REPOSITORY-ASSETS-LEDGER.md)

> **生效分支**：`nss-edma-julius`（生产基底分支）  
> **制定日期**：2026-10-30  
> **文档定位**：本文档为本仓库面向多源上游协同（OpenWrt 官方 master、Julius 原生 NSS-EDMA、开源生态社区）的**核心资产确权与架构真理源**。明确定义 Layer 1 至 Layer 4 的职责边界、物理分支、锚点 Commit 与防护红线，从根本上杜绝版本同步过程中的代码覆盖、混淆视听与误判。

---

## 一、 顶层架构与四层梯形堆栈模型

本仓库采用单向递进的**梯形堆栈架构（Stacked Layer Architecture）**。上层物理依赖并继承下层，下层保持纯净独立；所有层级基于统一的 OpenWrt 官方基座顺序向上叠加，确保编译上下文完备与数学级等价。

```text
Default Project / ImmortalWrt-QualcommAX
│
├── [Layer 4: 自研特性与生态加固生产层] ──> 分支: nss-edma-julius (HEAD, 58 Commits)
│   ├── luci-app-nss-dashboard (自研工业级大盘组件, SPA架构, 微秒手风琴, 102px布局)
│   ├── SONiC FullCone NAT1 套件 (内核 984~986 模块, firewall4 适配补丁, WebUI 与控制前端)
│   ├── 7 大生态高价值缺陷修复 (dnsmasq, 361 RCU, PCIe IRQ, lockless ppp, stmmac, SAX1V1K, monitor trim)
│   ├── P1/P2 编译与内核稳定性加固 (Conntrack RCU 解耦、PPPoE 无锁、Qdisc 逆序注销)
│   └── 自动化双轨流水线与动态质量门禁 (sync-upstream.yml, verify-canary-health.sh)
│
├── [Layer 3: 开源社区调优层] ────────────> 分支: layer/community-tuning (4 Commits)
│   ├── import(immortalwrt): 中国区本地化配置 (NTP 授时池, APK 软件源镜像)
│   ├── import(immortalwrt): cpufreq 频率调节服务与 schedutil 默认调度
│   ├── import(vikingyfy): ARMv8 Crypto Extensions 加密指令集加速与默认启用 ATH11K_NSS_SUPPORT
│   └── import(vikingyfy): nss_freq 芯片与协处理器底层锁频工具
│
├── [Layer 2: 高通 NSS-EDMA 协处理器内联基盘] ──> 分支: layer/julius-nss-base (48 Commits)
│   ├── package/nss/ (全套自包含内联驱动与微码固件: drv, ecm, clients, userspace, sqm, firmware)
│   ├── target/linux/qualcommax/files/drivers/net/ (qca_edma, qca_ppe_main, pcs-qca-uniphy 协同驱动)
│   ├── package/kernel/mac80211/patches/nss/ath11k/ (全套 30+ Wi-Fi NSS 直通卸载驱动补丁)
│   └── target/linux/qualcommax/dts/ (IPQ807x / IPQ60xx NSS 协处理器设备树节点与 reserved-memory 拓扑)
│
└── [Layer 1: OpenWrt 官方通用代码底座] ───> 分支: base/openwrt-upstream (基准快照)
    ├── 官方历史快照锚点: Commit 53ec2d05a4 (2026-10-09)
    ├── Toolchain 工具链 (GCC 14, musl libc, autotools, cmake)
    ├── target/linux/generic/ (Linux 6.18 通用内核基准、pending 补丁集)
    └── 通用系统与服务包 (procd, uci, ubus, netifd, hostapd, dnsmasq, nftables 等)
```

---

## 二、 资产详细确权清单

### 1. Layer 1：OpenWrt 官方通用代码底座 (Upstream Common OS Baseline)

*   **对应分支**：`base/openwrt-upstream`
*   **官方同步锚点 (Baseline Anchor)**：
    *   **Commit SHA**：`53ec2d05a487e6011cfa096de9211d15197c501b`
    *   **日期**：`2026-10-09 08:59:45 +0200`
    *   **标题**：`qualcommax: qca_ppe: add 10 and 100 Mbps half duplex`
*   **资产范围**：
    *   OpenWrt 官方原生构建体系：`include/`、`scripts/`、`tools/`、`toolchain/`；
    *   Linux 6.18 通用内核基础树：`target/linux/generic/`；
    *   通用网络与系统服务包：`package/base-files/`、`package/system/`、`package/network/services/`；
    *   非高通目标平台（bcm27xx, mediatek, x86, ramips 等）。
*   **演进契约**：
    *   该层级作为通用底座，允许通过更新锚点拉取官方 master/release 演进，吸收安全更新与通用包升级。

---

### 2. Layer 2：高通 NSS-EDMA 协处理器内联基盘 (Vendor Drivers & Firmware)

*   **对应分支**：`layer/julius-nss-base`（Parent: `base/openwrt-upstream`）
*   **提交范围**：共 48 提交，终点 Commit `b045e7cb0d` (`import(julius): inline complete NSS-EDMA package tree and firmware`)
*   **资产属性**：**确权为本仓库自主自包含维护的专属硬件加速资产**（源自 Julius 体系，已于 2026-10-18 完全内联落地）。
*   **核心资产清单与物理路径**：
    1.  **内联 NSS 驱动全家桶 (`package/nss/`)**：
        *   `package/nss/qca-nss-drv`：NSS 核心驱动与微码 IPC 通信协议栈 (`qca-nss-drv.ko`)；
        *   `package/nss/qca-nss-ecm`：Enhanced Connection Manager 芯片级硬件加速流表引擎 (`qca-nss-ecm.ko`)；
        *   `package/nss/qca-nss-clients`：PPPoE、VLAN、Bridge、Qdisc、IPsec、Tun6rd 等加速客户端 (`qca-nss-clients.ko`)；
        *   `package/nss/nss-firmware`：高通原厂 NSS 协处理器微码（默认版与 11.4 mesh 版两种固件变体）；
        *   `package/nss/nss-userspace-oss`：用户态通信、PPE 调试库与 `libnss_nl`；
        *   `package/nss/sqm-scripts-nss`：基于 NSS 芯片级硬件队列的 SQM 流控脚本。
    2.  **以太网与 Uniphy 协同驱动 (`target/linux/qualcommax/files/drivers/net/`)**：
        *   `ethernet/qualcomm/qca_edma.c` / `qca_edma.h`：与 NSS 固件共享环形描述符队列的硬件以太网驱动；
        *   `ethernet/qualcomm/qca_ppe_main.c` / `qca_ppe.h` / `qca_ppe_vlan.c`：专供 NSS 固件操作的 PPE 芯片寄存器驱动；
        *   `pcs/pcs-qca-uniphy.c` / `pcs-qca-uniphy.h`：2.5G / 10G USXGMII 自协商握手驱动。
    3.  **Wi-Fi NSS 直通卸载驱动补丁 (`package/kernel/mac80211/patches/nss/ath11k/`)**：
        *   包含 `199-003-ath11k-add-nss-support.patch` 在内的 30+ 补丁，实现 `ath11k` 数据报文绕过 Linux 主机协议栈直通协处理器硬件加速。
    4.  **硬件拓扑与设备树绑定 (`target/linux/qualcommax/dts/` 与 `files/.../dts/`)**：
        *   IPQ807x 与 IPQ60xx 的 NSS 协处理器设备树节点、时钟拓扑与 reserved-memory 内存物理保留区。
*   **防护铁律 (Protection Shield)**：
    *   **坚决保留满血 NSS 协处理器硬件加速，拒绝裁剪核心特性的主控 PPE 方案**。严禁引入 OpenWrt 官方新版基于主机 CPU 的独立 PPE 流表驱动（如 `qca_ppe_flow_offload.c` 等），防止与协处理器产生底层寄存器冲突与死锁。

---

### 3. Layer 3：开源社区调优层 (Community Distro & Tuning Layer)

*   **对应分支**：`layer/community-tuning`（Parent: `layer/julius-nss-base`）
*   **提交范围**：共 4 提交，起点 Commit `c29633d172`，终点 Commit `53a16fe26c` (`import(vikingyfy): import pure nss_freq PLL clock control tool`)
*   **资产属性**：吸收自开源社区优秀衍生版与开发者的环境调优与算力锁频方案。
*   **核心资产清单**：
    1.  `c29633d172`：ImmortalWrt 中国区本地化配置、NTP 授时服务器与国内镜像源；
    2.  `34612f64af`：ImmortalWrt cpufreq 频率动态管理服务与 schedutil 默认调频策略；
    3.  `0cb0085beb`：Vikingyfy 开启 ARMv8 Crypto Extensions 硬件加速指令集，默认开启 ATH11K_NSS_SUPPORT；
    4.  `53a16fe26c`：Vikingyfy nss_freq 协处理器与 CPU 底层锁频控制工具。

---

### 4. Layer 4：自研特性与生态加固生产层 (Production / Custom IP & Fixes)

*   **对应分支**：`nss-edma-julius`（Parent: `layer/community-tuning`，生产 HEAD 分支）
*   **提交范围**：共 58+ 提交，起点 Commit `4a9b3a53de` (`feat(nat): forward-port SONiC FullCone NAT1...`)
*   **资产属性**：**100% 由我们自主研发、深度重构或严格审查验证的核心业务资产**。
*   **核心资产清单与物理路径**：

#### 4.1 自研 NSS 工业级监控大盘
*   **物理路径**：`package/nss/luci-app-nss-dashboard/`
*   **核心技术创新**：
    *   微秒级展开手风琴架构（`toggleClientExpand`，原地局部修改 DOM，根除 1000ms 卡死）；
    *   SPA 内联作用域样式，彻底防御 Footstrap 等第三方主题禁用 head link 导致的界面裸奔；
    *   取消 sticky header 对首行数据 45.33px 的下移遮挡；
    *   后端 `jshn` 结构化单轮硬件探测引擎与无状态流表聚合（`nss_dashboard.common.sh`）；
    *   多核遥测与射频状态解耦、待机回落保护与 102px 紧凑工业级网格排版。

#### 4.2 自研 SONiC FullCone NAT1 套件
*   **物理路径**：
    *   `package/emortal/luci-app-fullconenat-sonic/`（WebUI 管理器）
    *   `package/network/utils/fullconenat-sonic/`（用户态控制工具）
    *   `target/linux/generic/hack-6.18/984-add-sonic-fullcone-support.patch`
    *   `target/linux/generic/hack-6.18/985-add-sonic-fullcone-to-ipt.patch`
    *   `target/linux/generic/hack-6.18/986-add-sonic-fullcone-to-nft.patch`
    *   `package/network/config/firewall4/patches/001-sonic-fullcone.patch`（zone-aware 规则自动生成）
*   **核心价值**：为 Linux 6.18 LTS 内核提供高性能 3-tuple 全锥形 NAT1 转发，完美解耦流表与硬件加速。

#### 4.3 严格审计与实机验证的 7 大生态硬缺陷修复
*   **审计真理源**：`package/nss/ECOSYSTEM-PATCHES-AUDIT.md`
*   **清单**：
    1.  **Dnsmasq procd/ujail reload SIGHUP 竞态修复** (`package/network/services/dnsmasq/files/dnsmasq.init`, Commit `87075416f3`)；
    2.  **mac80211 终端吞吐预估 RCU 读保护锁修复** (`package/kernel/mac80211/patches/subsys/361-*.patch`, Commit `65ca086892`)；
    3.  **ath11k PCIe 独立无线网卡 4 REO 接收中断散列多核** (`package/kernel/mac80211/patches/ath11k/959-*.patch`, Commit `e703bf2a04`)；
    4.  **PPP/PPPoE lockless_xmit 数据面多核无锁发包** (`target/linux/generic/pending-6.18/652-*`, `653-*`, Commit `3c683e6c41`)；
    5.  **stmmac GMAC 被 NSS 固件接管时拒绝 ethtool 重配防死锁** (`target/linux/qualcommax/patches-6.18/0958a-*.patch`, Commit `74453989bf`)；
    6.  **Spectrum SAX1V1K 专属 GPIO 27 软件 PWM 三级温控风扇配置** (`target/linux/qualcommax/dts/ipq8072-sax1v1k.dts` & `config-default`, Commit `41b1044302`)；
    7.  **ath11k monitor trim 日志降级为 dbg 消除刷屏** (`package/kernel/mac80211/patches/ath11k/949-*.patch`, Commit `77fa4dfe5c`)。

#### 4.4 自动化构建、流水线与动态质检门禁
*   **物理路径**：
    *   `.github/workflows/sync-upstream.yml`（双轨自动合并流水线，搭载 `merge=ours` 硬件保护盾）；
    *   `.github/scripts/verify-canary-health.sh`（未决符号扫描、动态 Seed 达成率校验与补丁清洁度门禁）；
    *   `.github/workflows/firmware-builder.yml`（调用 AutoWorkFlows 的 Caller 调度器）。

---

## 三、 同步协作与防摩擦纪律

1. **版本演进铁律**：
   * 任何面向上游 OpenWrt master 的同步，必须严格保持梯形依赖，自底向上平移或合并；
   * 在合并过程中，**Layer 2（NSS 驱动树）与 Layer 4（自研业务资产）享有最高保护权**，绝不允许被官方 master 的通用代码或新版主机 PPE 驱动无端覆盖。
2. **改动审计铁律**：
   * 涉及 Layer 2、Layer 3 与 Layer 4 的任何新增补丁、重构或废弃，必须同步更新本文档与 `ECOSYSTEM-PATCHES-AUDIT.md`，杜绝任何“未备案黑盒代码”进入生产分支。
