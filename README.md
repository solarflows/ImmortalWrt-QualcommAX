# ImmortalWrt-QualcommAX

[![Release](https://img.shields.io/github/v/release/solarflows/ImmortalWrt-QualcommAX?style=flat-square&color=blue&label=release)](https://github.com/solarflows/ImmortalWrt-QualcommAX/releases/latest) [![Canary](https://img.shields.io/github/v/release/solarflows/ImmortalWrt-QualcommAX?include_prereleases&style=flat-square&color=orange&label=canary)](https://github.com/solarflows/ImmortalWrt-QualcommAX/releases) [![Build Status](https://img.shields.io/github/actions/workflow/status/solarflows/ImmortalWrt-QualcommAX/firmware-builder.yml?branch=main&style=flat-square&label=build)](https://github.com/solarflows/ImmortalWrt-QualcommAX/actions) [![Kernel](https://img.shields.io/badge/kernel-Linux%206.18%20LTS-informational?style=flat-square&logo=linux)](https://github.com/solarflows/ImmortalWrt-QualcommAX) [![Target](https://img.shields.io/badge/target-ipq807x%20%7C%20ipq60xx-informational?style=flat-square)](https://github.com/solarflows/ImmortalWrt-QualcommAX) [![License](https://img.shields.io/badge/license-GPL--2.0-blue?style=flat-square)](LICENSE)

适用于高通 Qualcomm IPQ807x 与 IPQ60xx 平台的 ImmortalWrt 固件，基于 Linux 6.18 LTS 内核，集成 Qualcomm NSS（Network Subsystem）硬件加速驱动栈。

---

## 固件下载与默认配置 (Downloads & Default Settings)

固件由 GitHub Actions 自动化构建，提供**稳定版 (Stable)** 与 **滚动版 (Canary)** 两个发布通道：

| 设备型号 | SoC | 稳定版固件 (Stable) | 滚动版固件 (Canary) | 软件包 (Packages) |
| :--- | :---: | :---: | :---: | :---: |
| **Netgear Orbi RBR750** | IPQ8074 | [最新稳定版](../../releases/latest) | [最新尝鲜版](../../releases) | [PassWall 离线包](../../releases) |
| **Link NN6000 v2** | IPQ6000 | [最新稳定版](../../releases/latest) | [最新尝鲜版](../../releases) | [PassWall 离线包](../../releases) |

### 默认网络配置
- **管理 IP**：`192.168.1.1`
- **默认用户**：`root`
- **默认密码**：无密码（首次登录直接回车，建议通过 Web 后台或 `passwd` 命令及时设置）

---

## 硬件加速支持 (Hardware Offloading Scope)

系统数据通道运行于 NSS-EDMA / PPE 驱动之上，加速范围覆盖：

| 功能模块 | 加速状态 | 实现组件与说明 |
| :--- | :---: | :--- |
| **IPv4 路由 / NAT** | 支持 | 基于 ECM（Enhanced Connection Manager）与 NSS 微码线速卸载 |
| **IPv6 路由转发** | 支持 | ECM IPv6 前端驱动与微码硬件转发 |
| **PPPoE 客户端** | 支持 | 集成 `kmod-qca-nss-drv-pppoe`，消减锁竞争与 CPU 中断开销 |
| **Wi-Fi 无线转发** | 支持 | 基于 `ath11k` wifili 模块，支持板载及外置 PCIe 射频的 NSS 硬件直通 |
| **硬件 QoS / SQM** | 支持 | 支持 `nsstbl` 与 `nssfq_codel` 硬件队列调度规则，有效控制 Bufferbloat |
| **FullCone NAT (NAT1)** | 支持 | 基于 Broadcom / SONiC 架构的 3-tuple 快速映射，与 NSS 硬件流表天然共存 |
| **Conntrack 解耦** | 支持 | 补丁 `0970` 为 ECM 提供独立 RCU 事件分发槽位，杜绝 `ctnetlink` 冲突 |

---

## 硬件加速状态验证 (Status Verification)

固件运行后，可通过 SSH 执行以下命令验证硬件加速是否已正常接管：

```sh
# 1. 检查 NSS 核心运行状态与 IPv4 接收包计数 (流量通过时应持续递增)
cat /sys/kernel/debug/qca-nss-drv/stats/ipv4

# 2. 检查 ECM 硬件流表加速命中数 (> 0 说明已进入硬件快路径)
cat /sys/kernel/debug/ecm/ecm_nss_ipv4/tcp_accelerated_count
cat /sys/kernel/debug/ecm/ecm_nss_ipv4/udp_accelerated_count

# 3. 检查 CPU 软中断 (跑满千兆/万兆带宽时，CPU softirq 应维持极低占用)
top
```

---

## 刷机与升级 (Installation & Upgrade)

- **原生系统初次刷入**：请根据具体机型的 Bootloader / OEM 限制刷入对应的 Factory 镜像或执行 U-Boot 引导（详见各机型专有说明）；
- **已有 OpenWrt 固件升级**：
  - **Web 界面**：登录 LuCI ➔ `系统` ➔ `备份/升级` ➔ 上传 `*-squashfs-sysupgrade.bin` 固件；
  - **终端命令行**（推荐不保留配置升级）：
    ```sh
    sysupgrade -n /tmp/openwrt-qualcommax-*-sysupgrade.bin
    ```

---

## 分支说明 (Branches)

| 分支名称 | 属性 | 说明 |
| :--- | :---: | :--- |
| **`main`** | 管控分支 | 存放 GitHub Actions 构建工作流、Seeds 种子配置与上游基准跟踪文件（`.github/openwrt.sha`） |
| **`nss-edma-julius`** | 稳定分支 | 生产基底分支，由人工维护 NSS 源码树、平台补丁及板级设备树（DTS），输出稳定版固件 |
| **`nss-edma-rolling`** | 滚动分支 | 自动派生分支，每周同步 OpenWrt 官方主线，受保护路径（`qualcommax`、`mac80211`、`nss`）不被覆盖，输出 Canary 固件 |

---

## 本地编译 (Building)

```sh
# 克隆仓库
git clone -b nss-edma-julius https://github.com/solarflows/ImmortalWrt-QualcommAX.git openwrt
cd openwrt

# 更新 feeds 并应用种子配置 (以 IPQ807x 为例)
./scripts/feeds update -a && ./scripts/feeds install -a
cat configs/ipq807x/*.seed > .config
make defconfig

# 开始编译
make -j$(nproc)
```

---

## 鸣谢与上游 (Acknowledgements)

- [OpenWrt](https://github.com/openwrt/openwrt) & [ImmortalWrt](https://github.com/immortalwrt/immortalwrt)
- [Julius Bairaktaris (openwrt-nss-edma)](https://github.com/JuliusBairaktaris/openwrt-nss-edma)
- [Qualcomm CodeAurora](https://source.codeaurora.org/)

---

## 许可证 (License)

本项目遵循 [GPL-2.0](LICENSE) 许可证开源。
