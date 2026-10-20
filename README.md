# ImmortalWrt QualcommAX GitOps Hub

<div align="center">

[![Stable Release](https://img.shields.io/github/v/release/solarflows/ImmortalWrt-QualcommAX?color=388bfd&label=Stable%20Release&logo=github)](https://github.com/solarflows/ImmortalWrt-QualcommAX/releases/latest)
[![Canary Release](https://img.shields.io/github/v/release/solarflows/ImmortalWrt-QualcommAX?include_prereleases&color=d97706&label=Canary%20Pre-release&logo=github)](https://github.com/solarflows/ImmortalWrt-QualcommAX/releases)
[![Production Builder](https://github.com/solarflows/ImmortalWrt-QualcommAX/actions/workflows/firmware-builder.yml/badge.svg)](https://github.com/solarflows/ImmortalWrt-QualcommAX/actions/workflows/firmware-builder.yml)
[![Upstream Sync & Canary](https://github.com/solarflows/ImmortalWrt-QualcommAX/actions/workflows/sync-upstream.yml/badge.svg)](https://github.com/solarflows/ImmortalWrt-QualcommAX/actions/workflows/sync-upstream.yml)

[![Kernel](https://img.shields.io/badge/Kernel-Linux%206.18%20LTS-2ea44f?logo=linux)](https://github.com/solarflows/ImmortalWrt-QualcommAX)
[![Platform](https://img.shields.io/badge/Platform-Qualcomm%20IPQ807x%20%7C%20IPQ60xx-8b5cf6)](https://github.com/solarflows/ImmortalWrt-QualcommAX)
[![NAT1](https://img.shields.io/badge/FullCone%20NAT-SONiC%20FastLane-0ea5e9)](https://github.com/solarflows/ImmortalWrt-QualcommAX)
[![Dashboard](https://img.shields.io/badge/Telemetry-luci--app--nss--dashboard-f43f5e)](https://github.com/solarflows/ImmortalWrt-QualcommAX)
[![License](https://img.shields.io/badge/License-GPL--2.0-blue.svg)](LICENSE)

**面向高通 Qualcomm IPQ807x / IPQ60xx WiSoC 架构的高性能、长期稳定版（LTS）双轨固件 GitOps 管控中心。**  
*满血 Vendor NSS 硬件加速 · Conntrack RCU 双轨解耦 · 40ms 单进程自研大盘 · 路径级合并保护盾与动态质检门禁*

</div>

---

## 🏛️ 双轨演进架构 (Dual-Track Architecture)

本项目采用**“生产基底（LTS）+ 滚动尝鲜（Canary）”**的双轨演进模型。通过 Git 合并保护盾（`merge=ours`）与工件级动态自适应质检门禁，在保证生产环境绝对稳定的前提下，无缝吸收 OpenWrt 官方主线的通用系统演进：

```text
                                  ┌──────────────────────────────────────────────┐
                                  │         OpenWrt Official Master              │
                                  │          (全球最大开源社区主干)               │
                                  └──────────────────────┬───────────────────────┘
                                                         │ 每周日定时自动同步
                                                         │ 挂载路径级保护盾 (merge=ours)
                                                         ▼
┌─────────────────────────────────────────┐ 派生重置   ┌─────────────────────────────────────────┐
│ 轨道 1: 生产稳定轨 (nss-edma-julius)      ├────────────>│ 轨道 2: 滚动尝鲜轨 (nss-edma-rolling)     │
│ ├── 纯手工高精度维护与真机测试          │            │ ├── 自动化派生分支，绝缘硬件破坏性改动   │
│ ├── 满血 Vendor NSS SDK + 6.18 深度适配 │            │ ├── 吸收官方工具链、基础库与上层更新     │
│ ├── Conntrack RCU 解耦 (0970 补丁)      │            │ └── 编译工件先出，进入动态质检门禁       │
│ └── 发布正式稳定版 (Latest Release)      │            └────────────────────┬────────────────────┘
└─────────────────────────────────────────┘                                 │
                                                                             │ 工件下载与全动态质检
                                                                             ▼
                                                       ┌─────────────────────────────────────────┐
                                                       │ 🔍 自适应动态质检门禁 (Health Gate)     │
                                                       │ ├── 动态 Seed 达成率校验 (0硬编码包名)  │
                                                       │ ├── modpost 未决符号扫描 ([*.ko] undef) │
                                                       │ └── 固件实体、Profiles 与 Checksum 校验 │
                                                       └─────────────┬───────────────────────────┘
                                                                     │
                                                      ┌──────────────┴──────────────┐
                                                   [通过]                         [异常]
                                                      │                              │
                                                      ▼                              ▼
                                          自动发布 Canary Pre-release        建立 Issue 告警，不阻断 CI
                                          推进 main 追踪 SHA 基准            SHA 绝不前进，下次自动重试
```

---

## 🎯 支持设备矩阵与固件下载 (Supported Devices & Downloads)

固件由 GitHub Actions 自动化编译并发布，提供**正式稳定版**与**滚动尝鲜版**双通道下载：

| 设备型号 | 芯片架构 | 硬件画像 | 生产稳定版固件 (Stable) | 滚动尝鲜版固件 (Canary) | PassWall 离线包 |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Netgear Orbi RBR750** | IPQ8074 (4核 A53) | 1GB RAM / 双核 NSS / 2.5G WAN | [📥 获取最新稳定版](../../releases/latest) | [🧪 获取最新尝鲜版](../../releases) | [📦 离线安装包](../../releases) |
| **Link NN6000 v2** | IPQ6000 (4核 A53) | 1GB RAM / 双核 NSS / AX1800 | [📥 获取最新稳定版](../../releases/latest) | [🧪 获取最新尝鲜版](../../releases) | [📦 离线安装包](../../releases) |

> 💡 **提示**：
> - **生产稳定版（Stable Release）**：适合家庭主力路由，建议绝大多数用户使用，经过实机长期运行验证；
> - **滚动尝鲜版（Canary Pre-release）**：标签格式为 `ipq807x-canary-V*`，适合技术爱好者体验最新的 OpenWrt 上游特性；
> - **PassWall 扩展包**：发布在对应 Release 下的 `packages-ipq807x`（正式版）与 `packages-ipq807x-canary`（尝鲜版）。

---

## ⚡ 核心能力与自研技术资产 (Key Features & Engineering Assets)

### 1. 📊 自研单进程极速遥测控制大盘 (`luci-app-nss-dashboard`)
针对高通 NSS 硬件加速状态监测专门自研的高性能前端控制台，彻底根除老旧大盘的卡顿与高负载痛点：
- **纯 Lua 单进程 40ms 直读**：不拉起外部守护进程，无常驻内存泄漏，秒级响应；
- **全宽独立跨列折叠（Accordion Sub-Row）**：针对多 IP 设备采用全宽平滑展开子行，展开态主行追加阻断浮层，杜绝浮层抽搐；
- **自适应空闲退避能耗模型**：4s 活跃轮询 ➔ 60s 无操作自动退避至 12s ➔ 浏览器失焦物理休眠，零无谓算力浪费；
- **零功能裁剪模块化解耦**：彻底重构单体大杂烩，拆分为底座工具 `nss-tools`、DSCP 优先级服务 `nssqos` 以及两个独立 LuCI 配置包。

### 2. 🛡️ 内核级 Conntrack Notifier RCU 双轨解耦 (`0970-netfilter-conntrack-decouple-ecm-event-notifier.patch`)
高通开源驱动栈深水区历史死锁缺陷的终极修复：
- 在 `struct netns_ct` 为 ECM 独立开辟专有 `nf_conntrack_ecm_cb` RCU 槽位；
- 导出专用注册注销接口，彻底消灭 `ctnetlink` 与 `ECM` 相互覆盖导致的连接跟踪断流、连接数假死与内核 `WARN_ON` 报错；
- 保证透明代理、防火墙流表与高通硬件流表加速完美并行不悖。

### 3. 🚀 满血 Vendor NSS-EDMA / PPE 硬件加速栈
- **硬件数据流接管**：由双核 1.5GHz NSS 协处理器全权接管有线转发，支持 10Gbps+ 满线速吞吐与极低 CPU 负载；
- **Wi-Fi 硬件直通**：`ath11k` wifili NSS offload，支持 per-CPU 队列与 802.11s mesh 卸载；
- **NSS 硬件 QoS**：硬件级 SQM 流量调度（`nssqos` + `sqm-scripts-nss`），严防 Bufferbloat 拥塞。

### 4. 🌐 SONiC FullCone NAT (NAT1)
- 采用 Broadcom / SONiC 生产级 3-tuple `nat_by_manip_src` 快速映射与免垃圾回收机制；
- 彻底消灭哈希表锁竞争与死锁，会话直接驻留 Conntrack，**与高通 NSS / PPE 硬件流表天然共存**；
- 原生作为 `firewall4` 的依赖项，支持在 LuCI 界面针对不同 Zone 单独开启。

### 5. 🔒 ARMv8 Crypto Extensions (CE) 硬核矢量加速
- 在 Cortex-A53 上激活 AES-CE、SHA2-CE、GHASH-CE、CRC32-CE 硬件指令，WireGuard / IPsec / 存储加密性能提升 3~5 倍。

---

## 🛠️ GitOps 流水线与分支管理规范 (GitOps Workflows)

### 仓库分支矩阵

| 分支名称 | 属性 | 用途说明 | 维护策略 |
| :--- | :--- | :--- | :--- |
| **`main`** | **管控中枢** | 存放 GitHub Actions 流水线、Seeds 种子配置、追踪 SHA 与文档 | 默认分支，接受 PR 与调度配置变更 |
| **`nss-edma-julius`** | **生产基底** | 手工高精度维护的成熟 Vendor NSS 源码树与补丁真理源 | **人工严格维护**，CI 机器人禁止直接推送 |
| **`nss-edma-rolling`** | **滚动分支** | 自动化同步生成的 Canary 源码构建沙盒 | 由 `sync-upstream.yml` 自动派生、重置与强制推送 |

### 流水线触发选项

1. **`firmware-builder.yml`（生产固件构建器）**：
   - 支持参数：`target`（`ipq807x` / `ipq60xx` / `both`）、`branch`（源码分支选择）、`release_type`（`release` 正式 / `prerelease` / `draft`）、`cache_variant`（缓存隔离区）与 `require_signing`（强制签名私钥守卫）。
2. **`sync-upstream.yml`（双轨自动同步与质检发版）**：
   - 每周日 18:00 UTC 自动运行；
   - 支持手动调度：`force_sync`、`trigger_build`、`target`、`require_signing`。

---

## 📄 许可证 (License)

本项目基于 **GPL-2.0** 许可证开源发布，遵循所有上游 OpenWrt、ImmortalWrt 及 Linux 内核开源协议约定。
