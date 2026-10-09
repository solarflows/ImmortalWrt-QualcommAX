# ImmortalWrt QualcommAX GitOps Hub

[![Dual-Upstream Sync](https://github.com/solarflows/ImmortalWrt-QualcommAX/actions/workflows/sync-upstream.yml/badge.svg)](https://github.com/solarflows/ImmortalWrt-QualcommAX/actions/workflows/sync-upstream.yml)
[![ImmortalWrt Builder](https://github.com/solarflows/ImmortalWrt-QualcommAX/actions/workflows/firmware-builder.yml/badge.svg)](https://github.com/solarflows/ImmortalWrt-QualcommAX/actions/workflows/firmware-builder.yml)

本项目为针对高通 Qualcomm IPQ807x / IPQ60xx WiSoC 架构（Netgear RBR750、Link NN6000 v2 等）定制的现代长期稳定版（LTS）固件 GitOps 管控中心。

---

## 🏛️ 仓库分层架构 (Repository Architecture)

本项目采用**管控解耦与源码分离的双分支模型**，确保工作流、种子配置与驱动源码各司其职，并享受 GitHub Actions 专属独享的 10GB 编译缓存配额：

```text
solarflows/ImmortalWrt-QualcommAX
├── main 分支 (默认分支 · 轻量级 GitOps 管控中枢)
│   ├── .github/workflows/
│   │   ├── sync-upstream.yml       # 双上游同步工作流（追踪 Julius NSS-EDMA + ImmortalWrt Master）
│   │   └── firmware-builder.yml    # 固件编译流水线（Reusable Caller 调度器，调用 AutoWorkFlows）
│   ├── .github/patches/            # 核心自研特性原子补丁队列（0001 ~ 0006）
│   ├── configs/                    # 矩阵设备种子配置与自定义软件包定义
│   └── README.md                   # 架构与项目文档
│
└── nss-edma-custom 分支 (纯净源码产出分支)
    ├── ImmortalWrt Master (Linux 6.18 内核底座)
    ├── Julius Bairaktaris 现代解耦 NSS-EDMA / PPE 驱动栈 (35 个原子提交)
    └── 落地自研特性补丁 (SONiC FullCone, ARMv8 CE, NSS 调优, LTS Feeds)
```

---

## ⚡ 核心能力与硬件特性

1. **现代 NSS-EDMA / PPE 硬件加速驱动栈**：
   - 彻底摒弃老旧闭源 `qca-nss-dp` 与 `qca-ssdk`，采用 Linux 主线 `qca_edma` + `qca_ppe` + `kmod-qca-ppe-nss` 现代解耦驱动；
   - 完整打通 Linux 标准 DSA 交换机架构，支持 EEE 节能以太网与 VSI 多端口映射；
   - 满血 Wi-Fi 硬件卸载（`ath11k` wifili NSS offload，支持 per-CPU 队列与 802.11s mesh 卸载）；
   - NSS 硬件流控与队列（`nssqos`、`luci-app-nssqos`、`sqm-scripts-nss`）。
2. **SONiC FullCone NAT (NAT1)**：
   - 采用 Broadcom/SONiC 生产级 3-tuple `nat_by_manip_src` 快速映射与免垃圾回收机制；
   - 彻底消灭哈希表锁竞争与死锁，会话直接驻留 Conntrack，**与高通 NSS / PPE 硬件流表天然共存**；
   - 原生作为 `firewall4` 的依赖项，支持在 LuCI 界面针对不同 Zone 单独开启。
3. **ARMv8 Crypto Extensions (CE) 硬核矢量加速**：
   - 在 Cortex-A53 上激活 AES-CE、SHA2-CE、GHASH-CE、CRC32-CE 硬件指令，WireGuard / IPsec / 存储加密性能提升 3~5 倍。
4. **安全稳定的 NSS 频率管理**：
   - 出厂默认稳定中频档位 `mid`（748.8 MHz 原厂安全标频，低发热，绝不盲目超频）；
   - 智能四核心中断均衡（`set-irq-affinity`），消灭 CPU0 软中断瓶颈。

---

## 🎯 支持设备矩阵 (Supported Devices)

| 目标标识 | 设备型号 | 芯片平台 | 内存容量 | 专属特性 |
| :--- | :--- | :--- | :---: | :--- |
| **`rbr750`** | **Netgear Orbi RBR750** | IPQ8074 (4核 A53) | 1 GB | 1G 内存画像、双核 NSS、三频无线、2.5G WAN |
| **`nn6000`** | **Link NN6000 v2** | IPQ6000 (4核 A53) | 1 GB | 1G 内存画像、双核 NSS、Wi-Fi 6 AX1800 |

---

## 📦 固件下载 (Firmware Releases)

固件由 GitHub Actions 全自动多核编译并发布：
- **最新正式固件下载**：[GitHub Releases 页面](../../releases)
- **PassWall 架构离线包**：可在 Releases 对应的 `passwall-rbr750` / `passwall-nn6000` 标签下获取。
