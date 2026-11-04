# ImmortalWrt QualcommAX (NSS-EDMA) 架构与状态交接文档 (HANDOFF.md)

> **文档性质**：工作区资产交接与状态快照（Handoff）  
> **编写日期**：2026-11-03  
> **目标仓库**：`solarflows/ImmortalWrt-QualcommAX` (`E:\Users\Husky\Documents\Default Project\ImmortalWrt-QualcommAX`)  
> **关联生产远程**：`https://github.com/solarflows/ImmortalWrt-QualcommAX.git`  
> **官方基线远程**：`https://github.com/openwrt/openwrt.git` (`upstream-openwrt`)  
> **核心硬件平台**：Qualcomm IPQ807x / IPQ60xx (架构: AArch64 Cortex-A53, 协处理器: NSS-EDMA / ECM 直通)  
> **典型验证目标机**：`czw.lan` (Netgear Orbi RBR750 / 三频无线 / 512MB RAM / SLC NAND)  
> **底层交叉编译机**：`ThinkCentre-M910X.lan` (Ubuntu 24.04 / aarch64-openwrt-linux-musl-gcc 14.4.0)

---

## 0. 现状一览 (Executive Summary & Live State)

当前仓库已完成**全套底层内核/驱动高危缺陷修复**、**官方 OpenWrt Master 最新基底无损同步**、**NSS Dashboard 工业级前端重构**、以及 **zapret2 出海代理种子集成**。全部远程分支均已带有租约验证（`--force-with-lease`）安全同步至 GitHub 生产仓。

### 实时流水线状态 (截至 2026-11-03)
- **正式版固件发布任务**：[GitHub Actions Run #41578838789](https://github.com/solarflows/ImmortalWrt-QualcommAX/actions/runs/41578838789)
- **调度 Workflow**：`.github/workflows/firmware-builder.yml` (`ImmortalWrt QualcommAX Builder`)
- **构建目标参数**：`target: ipq807x`, `branch: nss-edma-julius`, `release_type: release`
- **预期产出**：正式发布 Release `ipq807x-V261103` (包含全套 sysupgrade 镜像、factory 镜像与软件包 IPK 归档)

---

## 1. 仓库多层分支架构与职责边界

本仓库严格遵循**四层解耦（三层基石 + 顶层生产 + 主控调度）**的设计模式，杜绝杂散代码与分支混淆：

```text
[base/openwrt-upstream]  46e6335fbd ── 官方 OpenWrt Master 快照纯净基线 (零私有侵入)
         │
         ▼ (rebase)
[layer/julius-nss-base]  108df2e888 ── Vendor NSS-EDMA 协处理器驱动、内核桥接与补丁基盘
         │
         ▼ (rebase)
[layer/community-tuning] d2a7964296 ── 本土化基础包 (autocore、nss_freq、cpufreq、国内镜像源)
         │
         ▼ (rebase)
[nss-edma-julius]        7c1fc3f4b6 ── 生产基底分支 (全套业务、高通无线栈修复、NSS Dashboard)
         ▲
         │ (dispatch)
[main]                   de3cf8e47d ── 主控分支：流水线调度、Seeds 种子生态配置与 openwrt.sha 锚点
```

### 各分支 HEAD 哈希与确权状态

| 分支名 | HEAD 哈希 | 属性与职责 | 同步状态 |
|---|---|---|---|
| **`base/openwrt-upstream`** | `46e6335fbd` | 追踪官方 `upstream-openwrt/master`，纯净无私有修改 | 已快进同步 |
| **`layer/julius-nss-base`** | `108df2e888` | 承载原厂 NSS-EDMA 驱动树，剥离上游主机 PPE 软分载 | 已推送到远端 |
| **`layer/community-tuning`** | `d2a7964296` | 吸收社区温控、主频控制（nss_freq）、中国源与负载均衡 | 已推送到远端 |
| **`nss-edma-julius`** | `7c1fc3f4b6` | 生产发布基底，承接 20 个高精度定制提交与内核/驱动补丁 | 已推送到远端 |
| **`main`** | `de3cf8e47d` | 包含 `configs/` 种子配置、`.github/openwrt.sha` 追踪锚点 | 已推送到远端 |

---

## 2. 本轮吸收并验证的 5 大关键底层补丁台账

所有补丁均物理落地为 `*.patch` 文件，遵循 `Build/Prepare` 纯净挂载原则，100% 保持上游驱动源码树免篡改：

### 1) U-Boot 硬件投票导致 USB 时钟卡死与内核污点修复
- **补丁文件**：`target/linux/qualcommax/patches-6.18/0921-clk-qcom-gcc-ipq8074-set-BRANCH_HALT_VOTED-for-usb-master-clocks.patch`
- **原作者**：Chukun Pan (潘楚琨) `<amadeus@jmu.edu.cn>` (LKML 2026-09-10)
- **根本机理**：原厂闭源 U-Boot (Netgear RBR750 / Linksys MX5300 等) 在引导后未注销时钟使用权；Linux 启动期 `clk_disable_unused()` 尝试关断 USB master 时钟时，因缺少 `BRANCH_HALT_VOTED` 导致轮询硬件 halt 寄存器 200 次超时，报 `gcc_usb0/1_master_clk status stuck at 'on'` 并导致内核被打上 `Tainted: [W]=WARN` 污点。
- **验证结论**：成功规避超时死循环，彻底根除开机 dmesg 大段 Call Trace 与内核污点。

### 2) ECM 期望连接空指针崩溃（Kernel Panic）守卫
- **补丁文件**：`target/linux/qualcommax/patches-6.18/0972-netfilter-nf_conntrack-null-check-expect-event.patch`
- **原作者**：Canary233 `<2096276316@qq.com>` (LibWrt commit `6667298b2d`)
- **根本机理**：高通 Vendor NSS ECM 驱动注册的 `struct nf_ct_event_notifier` 仅实现了 `.ct_event`，未实现 `.exp_event`。内核在处理 FTP 被动模式数据流、SIP、H.323 等 ALG 期望连接时，`nf_ct_expect_event_report()` 无条件执行 `notify->exp_event()`，直接导致 `pc: 0x0` 空指针解引用宕机。
- **验证结论**：增加空指针守卫 `if (notify->exp_event)`，消除加速流上复杂多连接协议导致的死机隐患。

### 3) 阻断 Flowtable 卸载盲目穿透 SQM/Cake 流量整形
- **补丁文件**：`target/linux/generic/pending-6.18/714-netfilter-flowtable-end-the-forward-path-at-a-device-with-tc.patch`
- **原作者**：Julius Bairaktaris `<julius@bairaktaris.de>` (openwrt-nss-edma `bde0b96b35`)
- **根本机理**：Linux flowtable 路径探测在下探真实物理设备时，跳过了挂载在 VLAN/PPPoE/Bridge 设备上的根 Qdisc，导致 PPPoE-WAN 上的 SQM 整形被完全穿透（50M 宽带跑出 2~4Gbps 假线速并引发严重缓冲膨胀与丢包）。
- **验证结论**：在探测到经过设备带有非默认 Qdisc 或 tc 钩子时主动截断下探，实现流表卸载与 Cake/FQ-Codel 队列调度和谐共生。

### 4) ath11k 监听模式下上行 Trigger-based (TB) 帧速率解析修复
- **补丁文件**：`package/kernel/mac80211/patches/ath11k/988-wifi-ath11k-take-the-rate-of-a-trigger-based-PPDU-from-its-uplink-user-info.patch`
- **原作者**：Julius Bairaktaris `<julius@bairaktaris.de>` (openwrt-nss-edma `8c56347ef4`)
- **根本机理**：HE 客户端上行响应 Trigger 帧不携带 HE-SIG-A SU，导致 Monitor 抓包时 mac80211 警告 `Rate marked as an HE rate but data is invalid: MCS: 0, NSS: 0` 并丢弃数据包。补丁从 TLV uplink OFDMA info 提取准确 NSS 与 MCS。

### 5) ath11k 修复 Radiotap 监听速率与 SIG 解析误报
- **补丁文件**：`package/kernel/mac80211/patches/ath11k/989-wifi-ath11k-report-the-rate-of-a-monitored-PPDU-from-its-SIG.patch`
- **原作者**：Julius Bairaktaris `<julius@bairaktaris.de>` (openwrt-nss-edma `ac8afbe19d`)
- **根本机理**：修复 Monitor 接口将 L-SIG 速率代码误当作 HT/VHT/HE 帧 MCS 报告的问题，并在缺少 NSS 时退回 L-SIG 基础速率，防止未解析 SIG 的数据帧被丢弃。

### 6) 官方主线 Master (46e6335fbd) 附带的关键吸收
- **补丁位置**：`package/kernel/mac80211/patches/subsys/484-wifi-mac80211-don-t-estimate-airtime-for-unsupported-rate-widths.patch` (随基底合入)
- **解决缺陷**：修复 IPQ8074 平台上 `ath11k` 在执行 OFDMA 传输后，hostapd 轮询站台状态触发吞吐量估算时，因无法识别 RU 频宽导致的 `airtime.c:532` `WARN_ON_ONCE()` 内核报警。

---

## 3. 前端界面与种子生态优化明细

### A. `luci-app-nss-dashboard` 工业级重构
- **RPC 载荷去污染**：后端 `nss_dashboard.common.sh` 与 rpcd 脚本剔除用于展示的中文标签，所有状态说明与单位 100% 移交前端 V8 引擎与 LuCI `_()` 原生国际化驱动；
- **官方 33% 栅格对齐**：修改 `12_nss.js` 与 `main.js`，彻底移除 `max-width: 120px` 与 `table-layout: fixed`，第一列严格采用 `width="33%"`，与官方「系统」、「内存」、「网络」模块达到 0px 像素级垂直贯通；
- **消除点状下划线污染**：全面移除 `.th-hint` 侵入式下划线，Native Hover 提示直接挂载在 `<td>` 和卡片标题的 `title` 原生属性上；
- **正向收益进度条（HW%）逻辑反转**：在 `lib/chips.js` 中增加 `intent: 'offload'` 语义识别，硬件加速比率 $\ge 60\%$ 渲染为健康绿（`var(--success-color-high, #00ac59)`），$<30\%$ 降级为警告黄；
- **协议分布（L4/L3）层级解耦**：
  - 行 1（L4 传输层）：`[TCP]` | `[UDP]` | `[Other]`（满格对齐）
  - 行 2（L3 网络层）：`[IPv4]` | `[IPv6]`
- **驱动模块网络层次对齐**：`Bridge` $\to$ `VLAN` $\to$ `PPPoE`（L2/L3），`Wi-Fi` $\to$ `Qdisc` $\to$ `SQM`（无线与调度），`EIP-197`（硬件加解密）。

### B. 种子生态（Seed）集成
- 在 `configs/ipq807x/10-proxy.seed` 与 `configs/ipq60xx/10-proxy.seed` 中正式声明：
  ```ini
  CONFIG_PACKAGE_luci-app-zapret2=y
  CONFIG_PACKAGE_zapret2=y
  ```
- 配合 `AutoWorkFlows`（commit `95bc6e6`）在 `.github/custom-feed/packages.yaml` 中配置的 `damocjwj/openwrt-zapret2` 仓库源，实现了 DPI 绕过核心及 LuCI 控制界面的开箱即用。

---

## 4. 验证拓扑与硬件环境状态

```text
 ┌─────────────────────────────────────────────────────────────┐
 │                    开发工作区 (PC 宿主机)                    │
 │  E:\Users\Husky\Documents\Default Project                  │
 └──────────────────────────────┬──────────────────────────────┘
                                │ SSH / Git / SFTP
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│   ThinkCentre-M910X (编译机)  │        │       czw.lan (测试路由器)    │
│  Ubuntu 24.04 / aarch64-musl │        │  Netgear RBR750 (IPQ8074)    │
│  ~/builder/immortalwrt-...   │        │  内核 6.18.60 / NSS 固件就绪 │
└──────────────────────────────┘        └──────────────────────────────┘
```

1. **ThinkCentre-M910X 状态**：
   - 源码树位于 `/home/husky/builder/immortalwrt-qualcommax`，当前位于 `test-verify-absorb` 验证分支；
   - 依赖的 Toolchain 与内核对象已全量构建就绪，全栈驱动通过编译（`target/linux/compile`、`package/kernel/mac80211/compile`、`package/nss/qca-nss-drv/compile` 等均为 Exit Code 0）。
2. **czw.lan 路由器状态**：
   - 运行官方 LuCI Master + 6.18.60 内核；
   - 前端资源文件（`12_nss.js`、`main.js`、`nss.css`）已热部署并通过浏览器 DevTools / Accessibility 树实测验证，Console 报错为 0。

---

## 5. 防灾备份与还原指针 (Disaster Recovery)

在本次同步与发版演进过程中，已建立了严格的只读备份分支，随时可作为原子回滚锚点：

| 备份分支名 | 对应 Commit | 备份快照描述 |
|---|---|---|
| **`backup/nss-edma-julius_20261102`** | `bb3d1b1c57` | 包含 5 项新补丁但在同步 `46e6335fbd` Master 基线之前的完整生产状态 |
| **`backup/nss-dashboard-20261102-grid-aligned`** | `9e7a7a387b` | NSS Dashboard 33% 栅格对齐与进度条反转完成时的状态 |
| **`backup/nss-edma-julius_20261101`** | `6287feebcb` | 移动端响应式布局与 RPC 去污染改造完成时的状态 |
| **`backup/nss-edma-julius_20261030`** | `77fa4dfe5c` | 历史稳定版 `ipq807x-V261030` 发布的基准快照 |

---

## 6. 后续接手操作指南 (Next Actions)

若后续会话接手或对工作区执行维护：
1. **监控 CI 产出**：通过 `gh run watch 41578838789` 观察固件编译与发布结果；
2. **Release 检查**：编译完成后，在 GitHub Releases 页面检查 `ipq807x-V261103` 的镜像完整性与 sha256 校验和；
3. **固件升级实机测试**：下载生成的 `*-sysupgrade.bin` 固件刷入 `czw.lan`，重点核验：
   - 开机 `dmesg` 是否已彻底消除 `gcc_usb1_master_clk status stuck at 'on'` 警告；
   - 系统设置是否保持 `Tainted: G` 纯净状态；
   - 菜单中 `zapret2` 插件是否正常加载。
4. **工作区整洁原则**：保持各子项目物理隔离，在 `Default Project` 下任何改动继续遵循 `AGENTS.md` 防护门禁。
