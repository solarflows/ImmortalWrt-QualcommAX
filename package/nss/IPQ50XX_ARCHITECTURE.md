# 高通 IPQ50xx NSS 硬件加速架构与全平台吸收技术规约

本文档记录高通 IPQ50xx（IPQ5018 / IPQ5000）系列芯片在现代 Linux 6.18 主线网络栈下的 NSS 硬件加速架构机理，以及将其作为全新 Subtarget 并入 `ImmortalWrt-QualcommAX` 的工程吸收实施方案。

---

## 一、 核心架构机理与硬件代差对比

### 1. 物理数据通道：原生 EDMA vs `stmmac` 动态接管
| 维度 | IPQ807x / IPQ60xx (现有基底) | IPQ50xx (待吸收目标) |
|---|---|---|
| **以太网控制器** | 片上专用 NSS-EDMA 控制器 + PPE 硬件交换矩阵 | 通用 Synopsys DesignWare MAC (`stmmac` / `dwmac-ipq5018`) |
| **驱动架构** | `qca-edma` + `ppe-nss`，硬件描述符环直连 NSS 协处理器 | 主线通用 `stmmac` + `kmod-qca-dwmac-nss` 内存接管胶水层 |
| **接入机制** | 零拷贝硬件直通（SerDes -> EDMA -> NSS） | 内核 `0956` Claim API：排空 TX、关闭 NAPI、暂停 DMA，将数据路径由 `stmmac` 剥离给 NSS |
| **控制面归属** | Host 管理 | Host 保持持有 MDIO、phylink 和 netdev 实例，免除对闭源 `qca-ssdk` 的依赖 |

### 2. 交换机拓扑：多物理端口直连 vs DSA `tag_8021q` 降维
- **冲突根因**：IPQ5018 通常仅有 1~2 个 GMAC 连接外部交换机芯片（QCA8337 / RTL8367S），主线强制运行 DSA 驱动并在数据帧中注入厂商私有 CPU Tag（如 2 字节 Atheros 头部）。NSS 微码解析器只识别标准以太网帧或标准 IEEE 802.1Q 帧（`0x8100`），读到私有 Tag 会判为未知协议（`eth_rx_unknown_l3_protocol`）并丢弃给 CPU，硬件加速完全失效；
- **解决机理**：利用 Linux DSA 原生 `DSA_TAG_PROTO_TAG_8021Q`，强制交换芯片使用标准 802.1Q VLAN 标签（VID 编码端口号）与 CPU 通信；配合自研 `qca-dsa-nss` 模块，为每个 DSA 端口向 NSS 微码注册为标准 NSS VLAN 动态虚拟接口。微码视其为常规 VLAN 报文，从而实现线速硬件卸载。

---

## 二、 吸收工程组件清单 (Asset Inventory)

将 IPQ50xx 完整收编为第三大构建目标需移植的模块矩阵：

### 1. 内核补丁层 (`target/linux/qualcommax/patches-6.18/`)
- `0956-stmmac-add-a-data-plane-claim-api-for-the-nss-firmware.patch`：为通用 `stmmac` 添加数据面动态转移接口（TX 冲刷、NAPI 解绑、`ndo_start_xmit` 重定向）。

### 2. NSS 驱动与胶水模块层 (`package/nss/`)
- `kmod-qca-dwmac-nss`：IPQ50xx 专属的数据面胶水驱动，实现 `nss-dp` 抽象接口与运行时 debugfs 激活；
- `kmod-qca-dsa-nss`：DSA 端口与 NSS 虚拟接口（VLAN Interface）的动态绑定映射器；
- `kmod-qca8337-nss` / `kmod-rtl8367s-nss`：负责在特定 Trunk 模式下解绑原生 DSA 驱动并重配置硬件 VTU 表的交换芯片驱动。

### 3. ECM 引擎扩展补丁 (`package/nss/qca-nss-ecm/patches/`)
- `0051-ecm_interface-treat-tag_8021q-dsa-user-ports-as-vlan-uppers.patch`：使 ECM 将 `tag_8021q` 用户端口识别为有效卸载载体；
- `0052-frontends-nss-accelerate-the-tag_8021q-ports-of-a-vlan-aware-bridge.patch`：打通 VLAN-Aware 桥与 DSA 端口的硬件加速流规则；
- `0053-ecm_db-give-each-side-of-a-routed-flow-its-own-bridge-VLAN.patch`：解决同一网桥内跨不同 VLAN 路由流量的硬件加速。

### 4. 用户态控制与迁移套件 (`package/nss/nss-tools/`)
- `nss-tools-dwmac`：包含 `/etc/init.d/nss` 引导脚本（保障 switch、glue、netifd、ECM 与 ath11k 的时序依赖），以及自动探测板级拓扑的动态迁移工具。

---

## 三、 设备矩阵与内存 Profiles 规划

### 1. 内存分级模型
- **512MB / 1GB 设备 (`std` Profile)**：
  - 适用机型：GL.iNet GL-B3000、TP-Link Archer AX55 v1、红米 AX5400、小米 AX6000、Linksys MR5500/MX5500；
  - 配置：ath11k 内存模式 1G，NSS 内存 Profile 配置为 `MEDIUM`。
- **256MB 设备 (`256m` Profile)**：
  - 适用机型：小米 AX3000T v2、Cudy P5、锐捷 RG-MA3063、TP-Link EX511 v2；
  - 配置：ath11k 内存模式 256M，NSS 内存 Profile 配置为 `LOW`（DDR 占用严格压缩至 8~16MB，规避内存耗尽）。

### 2. Wi-Fi 固件严格基线
- 2.4GHz + 5GHz 射频驱动必须锁定 `WLAN.HK.2.7.0.1` 固件（`ath11k-firmware-ipq5018-qcn6122`），禁止混用原厂 `2.9.r4`（规避 13 分钟触发 `PHY0M3` Q6 崩溃）。

---

## 四、 流水线与构建矩阵扩展路线 (Roadmap)

1. **第一阶段（资产归入与纯净验证）**：
   - 将驱动源码与补丁落地于 `package/nss/` 与 `target/linux/qualcommax/`；
   - 验证单包编译（`make package/nss/qca-dwmac-nss/compile`）0 警告通过。
2. **第二阶段（种子配置点亮）**：
   - 建立 `configs/ipq50xx/01-minimal.seed` 与 `configs/ipq50xx/04-network.seed`；
   - 针对目标板级固化默认选配包（包含 `nss-tools-dwmac`、`kmod-qca-dwmac-nss`、`zram-swap`）。
3. **第三阶段（CI 全自动矩阵合流）**：
   - 改造 `.github/workflows/compile-firmware.yml` 与 `sync-upstream.yml`；
   - 构建矩阵由 `[ipq807x, ipq60xx]` 扩展为 `[ipq807x, ipq60xx, ipq50xx]`，打通动态健康质检门禁与 Canary Pre-release 自动发版。
