# QSDK 12.5 双核 NPU (NSS) 固件 ABI 参考规范 (`NSS-12.5-NPU-ABI.md`)

> **适用范围**：Qualcomm IPQ807x（双核 UBI32 NPU：`NSS_CORE_0` + `NSS_CORE_1`）与 IPQ60xx（单核 UBI32 NPU：`NSS_CORE_0`）  
> **参考源码基底**：`package/nss/qca-nss-drv/src/`、`package/kernel/qca-ppe-nss/src/qca_ppe_nss.c`、`target/linux/qualcommax/files/`、`package/kernel/mac80211/patches/nss/ath11k/`  
> **固件版本标识**：`qca-nss-drv` 中 **12.5 为默认 ABI**（仅当开启 `CONFIG_NSS_FIRMWARE_VERSION_11_4` 时定义 `-DNSS_FIRMWARE_VERSION_11_4` 回退旧布局）。  
> **文档定位**：为后续基于 Linux 6.18+（或主线 `qca_edma + qca_ppe`）重写/精简 NSS 驱动提供完整的硬件寄存器、内存握手、环形队列、接口命名空间及消息协议 ABI 说明书。

---

## 一、 双核职责切分与硬件资源布局 (IPQ807x vs IPQ60xx)

### 1.1 双核逻辑分工 (`nss_core_id_t`)

定义于 `package/nss/qca-nss-drv/src/exports/nss_cmn.h:105-109` 与 `nss_hal/nss_hal.c:46-62`：

| 核心 ID | 固件镜像 | IPQ807x 职责 | IPQ60xx 职责 |
|---|---|---|---|
| **`NSS_CORE_0` (`0`)** | `qca-nss0.bin` | 主网络数据面：PPE/EDMA 接管、IPv4/IPv6 路由与 NAT、PPPoE、Bridge、VLAN、Wi-Fi (`wifili` 或独立分工)、Shaper/QoS | 唯一核心：承担全部网络加速与 Wi-Fi 卸载 |
| **`NSS_CORE_1` (`1`)** | `qca-nss1.bin` | 协处理/安全/隧道核：Crypto (`nss_crypto_cmn`)、IPsec、DTLS/TLS、CAPWAP、QVPN、PVXLAN、CLMAP、RMNET_RX，以及部分配置下分担 `wifili`（见 `ipq8074-nss.dtsi` 与 `nss_hal.c:581-609`；低内存模式 `NSS_MEM_PROFILE_LOW` 下强制 `num_nss = 1`） | 不存在（单核） |

> **绑定机制**：`nss_hal_probe()`（`nss_hal/nss_hal.c:380-709`）根据 DTS 节点属性 `npd->*_enabled` 将子系统 handler（如 `wifi_handler_id`、`crypto_handler_id`）及 `nss_top_main.dynamic_interface_table[type]` 绑定到对应核心的 `nss_ctx`。

### 1.2 物理地址、IMEM 与复位/中断寄存器

| 资源 | IPQ807x Core 0 (`nss0`) | IPQ807x Core 1 (`nss1`) | IPQ60xx Core 0 (`nss0`) |
|---|---|---|---|
| **固件加载 DDR 基址 (`qcom,load-addr`)** | `0x40000000` | `0x40800000` | `0x40000000` |
| **预留内存 (`nss_region`, `no-map`)** | `0x40000000`, size `0x01000000` (16 MiB) | 共用 `nss_region` | `0x40000000`, size `0x01000000` (16 MiB) |
| **NPU 控制寄存器 (`nphys`)** | `0x39000000` (`0x1000`) | `0x39400000` (`0x1000`) | `0x39000000` (`0x1000`) |
| **IMEM 紧耦合内存 (`vphys`)** | `0x38000000` (`0x30000`) | `0x38030000` (`0x30000`) | 无 IMEM（改用 `UTCM_SHARED`） |
| **QGIC IPC 门铃 (`qgic-phys`)** | `0x0b111000` (`0x1000`) | `0x0b111000` (`0x1000`) | `0x0b111000` (`0x1000`) |
| **Misc Reset (`nss-common`)** | `0x01868010` (`0x1000`) | `0x01868010` (`0x1000`) | `0x01868010` (`0x1000`) + `reset-flag @ 0x40000000` |
| **N2H 中断 (GIC SPI)** | 10 条：`377..386` | 9 条：`390..398`（无 `PROFILE_DMA`） | 10 条：`402..393`（降序） |
| **H2N 中断 Cause Base (`qgic + 0x8`)** | `NSS0_H2N_INTR_BASE = 13` | `NSS1_H2N_INTR_BASE = 19` | `NSS0_H2N_INTR_BASE = 13` |

### 1.3 时钟、电压域与核心复位/解复位序列

1. **公共时钟 (`__nss_hal_common_reset`)**：使能 13 路 NOC/CE/PTP/CFG 时钟；IPQ807x 额外使能 `nss-imem-clk` (400MHz) 与 `nss-mem-noc-nss-axi-clk` (461.5MHz)；IPQ60xx 使用 `nss-snoc-nssnoc-clk` (266.67MHz)。
2. **每核时钟与调压 (`__nss_hal_clock_configure`)**：
   - 配置 `GCC_NSSNOC_UBI{0,1}_AHB_CLK`、`GCC_UBI{0,1}_{CORE,AHB,AXI,MPT,NC_AXI}_CLK`（IPQ60xx 使用 `GCC_UBI0_UTCM_CLK` + `GCC_MEM_NOC_UBI32_CLK`）。
   - IPQ807x 仅在 Core 0 (`!nss_ctx->id`) 上管理 `npu` 调压器（`npu_reg`）：主频 > 1497.6 MHz (`NSS_FREQ_1497`) 设 `TURBO_VOLTAGE (2)`，否则 `NOMINAL_VOLTAGE (1)`。
3. **固件加载与解复位 (`__nss_hal_core_reset`, `nss_hal/ipq807x/nss_hal_pvt.c`)**：
   - 加载方式：**无 ELF 解析**，通过 `firmware_request_nowarn()` 读取原始 `.bin` 直接 `memcpy_toio()` 写入 `npd->load_addr`（807x 加载前先清零 `vphys` IMEM）。
   - 释放 GCC 复位：在 `nss_misc_reset` (`0x01868010`) 中对 `NSS_CORE_GCC_RESET_1 (0x20)` 解除复位 -> `usleep_range(10, 20)` -> 对 `NSS_CORE_GCC_RESET_2 (0x17)` 解除复位（IPQ807x 按 `(id << 3)` 移位）。
   - 写 NPU 引导寄存器（基址 `nphys`）：
     - `NSS_REGS_RESET_CTRL_OFFSET (0x04) = 1`
     - `NSS_REGS_CORE_AMC_OFFSET (0x0c) = 1`
     - `NSS_REGS_CORE_BAR_OFFSET (0x08) = 0x3c000000`
     - `NSS_REGS_CORE_BOOT_ADDR_OFFSET (0x10) = npd->load_addr`
     - *(仅 IPQ807x)*：`INT_STAT2_TYPE = 0xFFFF`，`INT_STAT3_TYPE = 0xFF`
     - `NSS_REGS_CORE_IFETCH_RANGE_OFFSET (0x48) = 0xBF004001`
     - 最后写 `NSS_REGS_RESET_CTRL_OFFSET (0x04) = 0` 正式放行 UBI32 核心运行。
   - **停核 (`__nss_hal_core_halt`, IPQ807x)**：写 `RESET_CTRL = 1` -> 置位 `RESET_2` -> `usleep_range(10, 20)` -> 置位 `RESET_1`。

---

## 二、 启动内存握手 (`nss_meminfo`) 与 `pbuf` 缓冲池 ABI

定义于 `nss_meminfo.h` 与 `nss_meminfo.c`：

1. **引导后保留区探测**：
   - Host `ioremap` 地址 `load_addr + NSS_MEMINFO_MAP_START_OFFSET (8)`（长度 `0x1000`）。
   - 校验 `(uint16_t)meminfo_start[0] == NSS_MEMINFO_RESERVE_AREA_MAGIC (0x9526)`。
   - *(仅 IPQ60xx)*：校验 `(uint16_t)meminfo_start[2] == NSS_MEMINFO_RESERVE_AREA_UTCM_SHARED_MAP_MAGIC (0x9530)`，从 `meminfo_start[3..4]` 读取 `utcm_shared_{head,end}`。
2. **解析内存请求表**：
   - 重映射 `meminfo_start[1]` 指向的请求表（`0x1000`），校验表头 `NSS_MEMINFO_MAP_START_MAGIC (0x9527)`。
   - 遍历 `struct nss_meminfo_request`（每项含 `NSS_MEMINFO_REQUEST_MAGIC = 0x9528`），直到 `NSS_MEMINFO_MAP_END_MAGIC (0x9529)`：
     - `IMEM`：填入 `vphys` 物理地址；
     - `SDRAM`：`kmalloc()` + `dma_map_single(..., DMA_TO_DEVICE)` 后回填物理地址与 `memtype_user`；
     - `UTCM_SHARED`：IPQ60xx 共享内存段；
     - `INFO`：如 `"heap_ddr_size"`（按活跃核数均分 `nss_core_ddr_info`）、`"nss_if_mem_map_inst"`（提取共享接口内存映射基址 `mem_ctx->if_map`）。
3. **Ring 内存分配与启动确认**：
   - `nss_meminfo_configure_n2h_h2n_rings()` 分配 **`NSS_N2H_RING_COUNT (5)` 条 N2H 环**与 **`NSS_H2N_RING_COUNT (11)` 条 H2N 环**（每条 `NSS_RING_SIZE = 128` + 2 冗余项），写入 `struct nss_if_mem_map` 并执行 `dma_sync_single_for_device`。
   - 固件启动就绪后，向 `if_map->magic` 写入 **`DEV_MAGIC (0x4e52522e)`** 并触发 `NSS_N2H_INTR_EMPTY_BUFFERS_SOS` 中断；Host 在 `nss_core_init_nss()` 中校验魔数并置核心为 `NSS_CORE_STATE_INITIALIZED`。
4. **额外 `pbuf` 池动态扩容**：
   - Core 0 就绪后，低内存模式通过 `nss_n2h_cfg_empty_pool_size()` 设为 `4096`；动态追加走 `NSS_METADATA_TYPE_N2H_ADD_BUF_POOL`（`PAGE_SIZE` `kzalloc` + `dma_map_single` 页表）。

---

## 三、 环形队列 (H2N / N2H)、缓存同步与 C2C 核间 ABI

### 3.1 共享内存控制头 (`struct nss_if_mem_map`, `nss_hlos_if.h:328-380`)

* `h2n_desc_if[16]` / `n2h_desc_if[15]`：各环的描述符基址 (`uint32_t desc_addr`) 与环长 (`uint16_t size`)
* `magic` (`0x4e52522e`)、`if_version` (`1`)、`h2n_rings`、`n2h_rings`、`num_phys_ports`
* 生产者/消费者游标数组：`h2n_nss_index[16]`、`n2h_nss_index[15]`、`h2n_hlos_index[16]`、`n2h_hlos_index[15]`

### 3.2 32 字节环形描述符 (`nss_hlos_if.h:246-316`)

* **`struct h2n_descriptor` (32 Bytes)**：
  `+0x00 interface_num (u32)` | `+0x04 buffer (u32 DMA phys)` | `+0x08 qos_tag (u32)` | `+0x0c buffer_len (u16)` | `+0x0e payload_len (u16)` | `+0x10 mss (u16)` | `+0x12 payload_offs (u16)` | `+0x14 bit_flags (u16)` | `+0x16 buffer_type (u8)` | `+0x17 reserved (u8)` | `+0x18 opaque (u64)`
* **`struct n2h_descriptor` (32 Bytes)**：
  `+0x00 interface_num (u32)` | `+0x04 buffer (u32 DMA phys)` | `+0x08 buffer_len (u16)` | `+0x0a payload_len (u16)` | `+0x0c payload_offs (u16)` | `+0x0e bit_flags (u16)` | `+0x10 buffer_type (u8)` | `+0x11 response_type (u8)` | `+0x12 pri (u8)` | `+0x13 service_code (u8)` | `+0x14 reserved (u32)` | `+0x18 opaque (u64)`

### 3.3 队列编号与关键标志位

* **H2N 队列 (`nss_core.h:149-158`)**：`0=EMPTY_BUFFER_QUEUE`、`1=CMD_QUEUE`、`2=EMPTY_PAGED_BUFFER_QUEUE`、`3=DATA_QUEUE`（支持多数据环）。
* **N2H 队列**：`0=EMPTY_BUFFER_RETURN_QUEUE`、`1..4=DATA_QUEUE_0..3`。
* **常用 `buffer_type`**：
  - H2N：`EMPTY(0)`、`PAGED_BUFFER_EMPTY(1)`、`PACKET(2)`、`CTRL(4)`、`NATIVE_WIFI(8)`
  - N2H：`EMPTY(1)`、`PACKET(3)`、`COMMAND_RESP(5)`、`STATUS(6)`、`CRYPTO_RESP(8)`、`PACKET_VIRTUAL(10)`、`PACKET_EXT(13)`
* **常用 `bit_flags`**：
  - H2N：`GEN_IPV4_IP_CHECKSUM(0x0001)`、`GEN_IP_TRANSPORT_CHECKSUM(0x0002)`、`FIRST_SEGMENT(0x0004)`、`LAST_SEGMENT(0x0008)`、`SEGMENTATION_ENABLE(0x0100)`、`VIRTUAL_BUFFER(0x2000)`、`BUFFER_REUSABLE(0x8000)`
  - N2H：`IPV4_IP_CHECKSUM_VALID(0x0001)`、`IP_TRANSPORT_CHECKSUM_VALID(0x0002)`、`FIRST_SEGMENT(0x0004)`、`LAST_SEGMENT(0x0008)`、`INGRESS_SHAPED(0x0010)`
* **Preheader 与缓存一致性**：
  - `NSS_DP_PREHEADER_SIZE = 32` 字节，发送网口需 `needed_headroom += 32`；
  - `NSS_CACHE_LINE_SIZE = 32`，所有描述符及 `if_map` 索引更新后必须配合 `dma_sync_single_for_{device,cpu}` 与 **`dsb(sy)` (`NSS_CORE_DSB()`)** 再敲 `qgic + 0x8` 中断门铃。

### 3.4 通用 RPC 消息头 (`struct nss_cmn_msg`, 32 Bytes, `exports/nss_cmn.h:152-175`)

```c
struct nss_cmn_msg {
    uint16_t version;           /* NSS_HLOS_MESSAGE_VERSION = 1 */
    uint16_t len;               /* 不含本 32B 头部的载荷长度 */
    uint32_t interface;         /* 目标/源 if_num */
    enum nss_cmn_response response; /* ACK(0), EVERSION(1), EINTERFACE(2), ELENGTH(3), EMSG(4), NOTIFY(5) */
    uint32_t type;              /* 子系统消息 opcode */
    uint32_t error;             /* 固件返回错误码 */
    uint32_t reserved;
    nss_ptr_t cb;               /* 64-bit 回调函数指针 (同步/异步回传) */
    nss_ptr_t app_data;         /* 64-bit 上下文/序列号防过期校验 */
};
```
* 控制消息通过 `NSS_IF_H2N_CMD_QUEUE` + `H2N_BUFFER_CTRL | H2N_BIT_FLAG_BUFFER_REUSABLE` 下发；固件通过 N2H `N2H_BUFFER_STATUS` 回传，由 `nss_core_handle_nss_status_pkt()` 按 `interface` 分发。

### 3.5 双核 C2C 互联 ABI (`nss_core.c:2368-2401`, `nss_c2c_tx.c`)

当一个核心完成引导进入 `INITIALIZED` 时，Host 为其与所有已就绪的对端核心交换 `NSS_C2C_TX_INTERFACE` 的 `NSS_C2C_TX_MSG_TYPE_TX_MAP` 消息：
* `tx_map` = 对端 `meminfo_ctx.c2c_start_dma`；
* `c2c_intr_addr` = `(uint32_t)peer->nphys + NSS_REGS_C2C_INTR_SET_OFFSET (0x0018)`。

### 3.6 EDMA 物理环接管与端口上线时序 (`qca_ppe_nss.c`, `qca_edma.c`)

* **EDMA 接管**：NSS 固件启动后直接重写 EDMA 的 `QID2RID` 表、将 Host RX ring 15 从 CPU-port 队列解绑并接管物理收发环（因此 `qca-nss-drv` 必须在有端口 armed 后才可探测启动；卸载时需在核心复位状态下由 `qca_edma_fw_baseline_restore()` 恢复 `EDMA_QID2RID_TABLE_MEM` 与 Ring Map）。
* **端口启动必选顺序 (`ppe_nss_port_start`)**：
  1. `qca_ppe` 分配端口私有 VSI -> 发 `NSS_PHYS_IF_VSI_ASSIGN`（**缺失 VSI 则 TX 通但 RX 全死；多端口共用同一 VSI 固件直接 NACK**）；
  2. `qca_ppe_port_fw_vsi_refresh()` 重写 PPE 泛洪/成员掩码（固件在 `vsi_assign` 时会将其清零）；
  3. 依次下发 `NSS_PHYS_IF_MAC_ADDR_SET`、`NSS_PHYS_IF_MTU_CHANGE`、`NSS_PHYS_IF_OPEN`（`MODE0` -> 接管进 `NSS_ETH_RX_INTERFACE`）；
  4. `qca_edma_port_dp_claim()` 接管 conduit TX 路径，并在链路状态变动时调用 `NSS_PHYS_IF_LINK_STATE_NOTIFY` (`0/1`)。

---

## 四、 接口命名空间 (`if_num`) 与核心子系统消息 ABI

### 4.1 `if_num` 分区规划 (`exports/nss_api_if.h:121-291`)

| 范围 | 用途 | 关键固定 ID |
|---|---|---|
| `0 .. 7` | **物理接口 (`PHYSICAL`)** | 对应 PPE/DSA 物理端口 `1..6` |
| `8 .. 23` | **虚拟接口 (`VIRTUAL`)** | 虚拟网卡/VAP 映射 |
| `24 .. 27` | **隧道接口 (`TUNNEL`)** | IPsec encap/decap、TUN6RD、TUNIPIP6 |
| `28 .. 155` | **动态接口 (`DYNAMIC`, 128 个)** | 通过 `NSS_DYNAMIC_INTERFACE` (`ALLOC_NODE`/`DEALLOC_NODE`) 动态申请，涵盖 `VAP`、`PPPOE`、`BRIDGE`、`VLAN`、`WIFILI_INTERNAL/EXTERNAL`、`WIFI_EXT_VDEV_*` |
| `156 .. 227` | **特殊固定接口 (`SPECIAL`, 72 个)** | `N2H (+0)`、`ETH_RX (+2)`、`PPPOE (+3)`、`IPV4_RX (+5)`、`IPV6_RX (+7)`、`CRYPTO_CMN (+11)`、`DYNAMIC (+20)`、`VAP (+44)`、`VLAN (+45)`、`WIFILI_INTERNAL (+47)`、`WIFILI_EXTERNAL0/1 (+59/+60)`、`WIFI_EXT_VDEV (+67)` |

### 4.2 网络核心子系统消息

1. **通用接口控制 (`nss_if.h`)**：`NSS_IF_OPEN` / `CLOSE` / `LINK_STATE_NOTIFY` / `MTU_CHANGE` / `MAC_ADDR_SET` / `STATS` / `VSI_ASSIGN` / `VSI_UNASSIGN` / `SET_NEXTHOP` / `PPE_PORT_CREATE` / `DESTROY`。
2. **IPv4 / IPv6 加速 (`nss_ipv4.h`, `nss_ipv6.h`)**：
   - Opcodes：`TX_CREATE_RULE_MSG (0)`、`DESTROY_RULE_MSG (1)`、`RX_CONN_STATS_SYNC_MSG (3)`、`RX_NODE_STATS_SYNC_MSG (4)`、`TX_CONN_CFG_RULE_MSG (5)`、`TX_CONN_STATS_SYNC_MANY_MSG (7)` 等。
   - `rule_create` 通过 `valid_flags` 组合 `5tuple`、`conn_rule`、NAT、`tcp_rule`、`pppoe_rule`、`qos_rule`、`dscp_rule`、`vlan_primary/secondary_rule`、`nexthop_rule`。
   - `conn_stats` / `conn_stats_many` 携带双向包/字节增量、`inc_ticks` 及销毁原因（`STATS(0)` / `FLUSH(1)` / `EVICT(2)` / `DESTROY(3)`）。
3. **PPPoE (`nss_pppoe.h`)**：`SESSION_CREATE (0)`（含 `base_if_num`、`mtu`、`server_mac`、`local_mac`、`session_id`）、`DESTROY (1)`、`SYNC_STATS (2)`、`BR_ACCEL_CFG (3)`。
4. **Bridge / VLAN (`nss_bridge.h`, `nss_vlan.h`)**：消息号从 `NSS_IF_MAX_MSG_TYPES + 1 (10000)` 起跳，包含 `NSS_BRIDGE_MSG_JOIN` / `LEAVE` / `SET_FDB_LEARN` 与 `NSS_VLAN_MSG_ADD_TAG`（`vlan_tag`、`next_hop`、`if_num`）。

### 4.3 Wi-Fi (`wifili`) 与 Core 1 Crypto 引擎 ABI

1. **Wifili (`nss_wifili_if.h`, `nss_wifili.c`)**：
   - SoC 接口注册于 `NSS_WIFILI_INTERNAL_INTERFACE` (AHB) 或 `EXTERNAL_INTERFACE0/1` (PCIe)，每个 Radio 注册为动态接口；
   - 关键生命周期消息：`INIT_MSG` -> `START_MSG` -> `PDEV_INIT_MSG`（配置 `rxdma_ring`、`radio_id`、`lmac_id`、`num_rx_swdesc`）-> `PEER_CREATE_MSG` / `PEER_DELETE_MSG` / `PEER_AST_FLOWID_MAP_MSG` / `WDS_PEER_*` -> `PDEV_STATS_V3_*` / `PEER_STATS_MSG`。
2. **Crypto Common (`nss_crypto_cmn.h`, `nss_crypto_cmn.c`)**：
   - 注册于 `NSS_CRYPTO_CMN_INTERFACE (156 + 11)`（在 IPQ807x 上默认归属 **Core 1**）；
   - Opcodes：`SETUP_NODE (1)`、`SETUP_ENG (2)`、`SETUP_DMA (3)`、`SETUP_CTX (4)`、`CLEAR_CTX (5)`、`VERIFY_CTX (6)`、`SYNC_{NODE,ENG,CTX}_STATS (7..9)`。

---

## 五、 QSDK 12.5 相对 11.4 的 ABI 增量差异清单

在重写或适配 12.5 固件时，必须注意以下相比 11.4 的结构体与语义变化（源码中以 `#ifndef NSS_FIRMWARE_VERSION_11_4` 或 `#ifdef NSS_FIRMWARE_VERSION_12_5` 区分）：

1. **Wifili Peer 与统计结构扩展 (`nss_wifili_if.h`)**：
   - `NSS_WIFILI_DELAY_INDEX_MAX` 从 `10` 扩展为 **`13`**；
   - `struct nss_wifili_peer_msg` 新增 **`uint32_t peer_memory_size`** 字段；
   - `struct nss_wifili_tx_comp_ring_stats` 新增 `tx_cap_enqueue_count` 与 `tx_cap_enqueue_fail_count`；
   - `struct nss_wifili_rx_ctrl_stats` 新增 `mcast_3addr_drop`、`ucast_rcv_cnt`、`ucast_rcv_bytes`；
   - `struct nss_wifili_peer_ctrl_stats` 新增 `struct nss_wifili_retry_ctrl_stats retry`（`tx_mpdu_retry_count`、`tx_mpdu_total_retry_count`、`rx_retry_count`）。
2. **4-Addr / WDS 行为差异 (`ath11k` 补丁)**：
   - 12.5 启用 `NSS_WIFI_VDEV_EXT_DATA_PKT_TYPE_4ADDR`（`nss_wifi_vdev_addr4_data_metadata`）处理；
   - 实测部分 12.5 固件对 `AP_VLAN` ext vdev 不主动上报 `WDS_LEARN`，需 Host 侧做源地址学习补全。
3. **IPv4 与 Shaper 扩展**：
   - `nss_ipv4.h` 新增 `NSS_IPV4_RULE_CREATE_RAWIP_VALID (0x4000)`；
   - `nss_shaper.h` 升级支持 `qos_tag` 与批量统计同步布局。

---

## 六、 单核 NPU 兼顾 Crypto 实证与 `nss_freq` 调频调压 ABI

### 6.1 论坛说法核实：IPQ60xx / IPQ50xx 单核 NPU 同时承担 NSS 与 Crypto

经核查设备树与 `nss_hal` 源码，该说法**准确**，具体如下：

1. **IPQ60xx（实锤）**：`target/linux/qualcommax/files/arch/arm64/boot/dts/qcom/ipq6018-nss.dtsi` 仅定义唯一核心 `nss0: nss@40000000`（`qcom,id = <0>`），该节点**同时**开启网络属性（`qcom,bridge-enabled`、`qcom,ipv4-enabled`、`qcom,ipv6-enabled`、`qcom,ppe-enabled`，`L107-126`）与加密属性（`qcom,crypto-enabled` `L130`、`qcom,ipsec-enabled` `L131`）。`nss_hal/ipq60xx/nss_hal_pvt.c` 仅实现 `core0`。
2. **IPQ50xx（HAL 实锤）**：`nss_hal/ipq50xx/nss_hal_pvt.c` 同样仅有 `core0`（`nss_core0_clk`、`intr_cause`）；`nss_hal/nss_hal.c:429-454` 将 `crypto_handler_id` 与 `ipsec_handler_id` 绑定到同一 `nss_dev->id`（`core0`）。*(注：本仓库 `qualcommax` DTS 目录未包含 `ipq5018-nss.dtsi`)*。
3. **与 IPQ807x 对比**：`ipq8074-nss.dtsi` 将 `nss0`（`L51-140`）专用于网络转发，将 `nss1`（`L203-204`，`status = "disabled"`）专用于 `crypto`/`ipsec`（注释明确 `Core 1 carries no packet path`）。此外，高通这三代芯片在树内均**无独立 `eip197` DTS 节点**（`eip197` 仅用于 MT7987/MT7988），均通过 NSS `nss_crypto_cmn`（配合 `qca-nss-crypto` 包）驱动硬件加解密。

### 6.2 `nss_freq` 频率表、调压与两阶段切换 ABI (`nss_freq.c`, `nss_hal/*/nss_hal_pvt.c`)

* **各平台频率/负载阈值表 (`nss_core.h:241-306`)**：

| 平台 | 档位宏与频率 (Hz) | `min_bit` / `max_bit` 阈值 | 调压器 (`npu-supply`) |
|---|---|---|---|
| **IPQ807x** | `NSS_FREQ_187` (`187200000`, fallback)<br>`NSS_FREQ_748` (`748800000`)<br>`NSS_FREQ_1497` (`1497600000`)<br>`NSS_FREQ_1689` (`1689600000`, DTSI) | `187`: max `0x07000`<br>`748`: `0x07000..0x14000`<br>`1497`: `0x14000..0x25000` | 仅 Core 0 (`npu_reg`)：<br>`> 1497.6MHz` 先切 `TURBO_VOLTAGE (2)` 再调频；`<= 1497.6MHz` 先降频再切 `NOMINAL_VOLTAGE (1)` |
| **IPQ60xx** | `NSS_FREQ_187` (`187200000`)<br>`NSS_FREQ_748` (`748800000`)<br>`NSS_FREQ_1497` (`1497600000`)<br>可选 `NSS_FREQ_1689` (`1689600000`) | `187`: `0x03000..0x10000`<br>`748`: `0x10000..0x18000`<br>`1497`: `0x18000..0x25000`<br>`1689`: `0x14000..0x25000` | 固定时钟 `UTCM=266.67MHz`、`MEM_NOC_UBI32=533.33MHz`；`nss_hal_wq_function` 不调用 `regulator_set_voltage()` |
| **IPQ50xx** | Low: `NSS_FREQ_SCALE_NA` (`0xFAADFAAD`)<br>Mid: `NSS_FREQ_850` (`850000000`)<br>High: `NSS_FREQ_1000` (`1000000000`) | Low: `NSS_FREQ_NA (0)`<br>Mid: `0x07000..0x0c000`<br>High: `0x0c000..0x25000` | 无调压；`NSS_UTCM_CLK = 266.67MHz` |

* **两阶段调频握手**：采样周期 `NSS_FREQ_USG_AVG_FREQUENCY = 1000 ms`（`MAX_BOUND=75%`、`MAX=100%`）。切换时 `nss_freq_change()` 先发 `start_or_end = 0` 等待固件 `NSS_ACK_STARTED (0)` -> Host 执行 `clk_set_rate()` -> 再发 `start_or_end = 1` 等待 `NSS_ACK_FINISHED (1)`。

---

## 七、 运行时流控、32B Preheader 与 RPC `serial` 防串包 ABI

### 7.1 `32 字节 Preheader` 真实使用语义

* `NSS_DP_PREHEADER_SIZE = 32`（`qca_ppe_nss.c`、`nss_data_plane/hal/nss_ipq{60xx,807x}.c:103`）：用于为 `needed_headroom` 和 MTU 预留前置空间。
* **N2H 空包预分配 (`nss_core.c:2095-2148`)**：Host 分配 `alloc_skb(max_buf_size + NET_SKB_PAD)` 并 `skb_reserve(nbuf, NET_SKB_PAD)`，将 `nbuf->head` 做 `DMA_FROM_DEVICE` 映射，`desc->buffer_len = max_buf_size + NET_SKB_PAD`。
* **N2H 收包还原 (`nss_core.c:1348-1365`)**：Host 直接按固件填回的 `nbuf->data = nbuf->head + desc->payload_offs`、`nbuf->len = desc->payload_len` 还原载荷（不碰 headroom）。
* **H2N 发包映射 (`nss_core.c:2663-2678, 2904-2939`)**：从 `nbuf->head` 映射 DMA，将 `payload_off = nbuf->data - nbuf->head` 与 `payload_len = nbuf->len` 写入 `h2n_descriptor`。对于带扩展元数据的接口（如 `wifili` VAP、`tstamp`），元数据写入 `skb->head + 4` 或 preheader 区域。

### 7.2 缓冲池水位、SOS 补包与 H2N 队列反压 (`nss_n2h.c`, `nss_core.c`)

* **空缓冲池与水位**：`NSS_N2H_MIN_EMPTY_POOL_BUF_SZ = 32`、`MAX = 131072`、`DEFAULT = 8192`（低内存模式 `4096`）。通过 `NSS_TX_METADATA_TYPE_SET_WATER_MARK` 配置 `low_water` / `high_water`（`[32, 131072]`，且 `low <= high`）。
* **SOS 紧急补包**：当 NPU 空缓冲耗尽触发最高优先级 NAPI 中断 `NSS_N2H_INTR_EMPTY_BUFFERS_SOS`（或 `PAGED_EMPTY_BUFFERS_SOS`）时，`nss_core_handle_empty_buffer_sos()` 计算 `count = ((nss_index - hlos_index - 1) + size) & mask` 批量补入新 `skb` 并敲 `NSS_H2N_INTR_EMPTY_BUFFER_QUEUE`。
* **Host 背压与队列流控**：默认队列上限 `NSS_DEFAULT_QUEUE_LIMIT = 256`（通过 `NSS_TX_METADATA_TYPE_N2H_HOST_BACK_PRESSURE_CFG` 控制）。H2N 发送环剩余槽位 `< (segments + 1)` 时，置位 `NSS_H2N_DESC_RING_FLAGS_TX_STOPPED`、使能 `NSS_N2H_INTR_TX_UNBLOCKED` 中断并返回 `NSS_CORE_STATUS_FAILURE_QUEUE`（映射为 `NETDEV_TX_BUSY`）；环空出后由 `nss_core_handle_tx_unblocked()` 触发 `queue_decongestion_callback[]` 唤醒发包队列。

### 7.3 同步 RPC `serial` 防超时串包模式 (`nss_phys_if.c:40-62, 162-190, 254-291`)

* **正确范式 (`nss_phys_if.c`)**：加锁持有 `phif.sem` -> 递增 `phif.serial++` 并写入 `ncm->app_data = (nss_ptr_t)phif.serial` -> 调用 `reinit_completion(&phif.complete)` -> `wait_for_completion_timeout(..., 3000ms)`；回调中校验 `(nss_ptr_t)app_data != phif.serial` 则直接丢弃迟到响应（防止超时后晚到的 ACK 唤醒下一次请求）。
* **已知反面缺陷 (`nss_ipv4.c:302-331`)**：原厂 `nss_ipv4_tx_sync()` 未设 `serial` 且未 `reinit_completion()`（`1000ms` 超时后晚到回包会污染后续同步调用），重写新驱动时**必须全量采用 `serial` + `reinit_completion()` 范式**。

---

## 八、 核心 L2/L3/PPPoE/Shaper 完整 C 结构体与位标志 ABI

所有结构体定义位于 `qca-nss-drv/src/exports/`：

### 8.1 `nss_if.h` / `nss_dynamic_interface.h` / `nss_pppoe.h` / `nss_bridge.h` / `nss_vlan.h`

* **`nss_if_open` (`nss_if.h:97-102`)**：`uint32_t tx_desc_ring, rx_desc_ring, rx_forward_if, alignment_mode;`（`NSS_IF_DATA_ALIGN_2BYTE = 0`, `4BYTE = 2`）。
* **`nss_dynamic_interface_msg` (`nss_dynamic_interface.h:158-193`)**：`cm` + `union { struct { enum nss_dynamic_interface_type type; int if_num; } alloc_node; struct { enum nss_dynamic_interface_type type; int if_num; } dealloc_node; }`。常用 `type`：`PPPOE(8)`, `BRIDGE(16)`, `VLAN(17)`, `WIFILI_INTERNAL(19)`, `IGS(53)`, `WIFILI_EXTERNAL0(61)`, `EXTERNAL1(62)`, `WIFI_EXT_VDEV_WDS(66)`, `WIFI_EXT_VDEV_VLAN(69)`。
* **`nss_pppoe_msg` (`nss_pppoe.h`)**：`create` (`base_if_num`, `mtu`, `server_mac[6]`, `local_mac[6]`, `session_id`)、`destroy`、`sync_stats`、`br_accel` (`DIS=0`, `EN_5T=1`, `EN_3T=2`)。
* **`nss_bridge_msg` / `nss_vlan_msg`**：消息 opcode 从 `NSS_IF_MAX_MSG_TYPES + 1 (10000)` 开始；`nss_bridge_msg` 内嵌 `union nss_if_msgs if_msg` + `br_join/leave(if_num)` + `fdb_learn(mode)`；`nss_vlan_msg` 内嵌 `if_msg` + `add_tag(vlan_tag, next_hop, if_num)`。

### 8.2 `nss_ipv4.h` & `nss_ipv6.h` 完整流表规则与位图

* **`valid_flags` 十六进制位图**（`nss_ipv4.h:269-297`, `nss_ipv6.h:280-303`）：
  `CONN_VALID (0x0001)` | `TCP_VALID (0x0002)` | `PPPOE_VALID (0x0004)` | `QOS_VALID (0x0008)` | `VLAN_VALID (0x0010)` | `DSCP_MARKING_VALID (0x0020)` | `VLAN_MARKING_VALID (0x0040)` | `SRC_MAC_VALID (0x0080)` | `NEXTHOP_VALID (0x0100)` | `RPS_VALID (0x0200)` | `IGS_VALID (0x0400)` | `IDENTIFIER_VALID (0x0800)` | `MIRROR_VALID (0x1000)` | `EMESH_SP_VALID (0x2000)` | **`RAWIP_VALID (0x4000, 仅 >11.4 / 12.5 IPv4)`**。
* **`rule_flags` 位图**：
  `BRIDGE_FLOW (0x0001)` | `ROUTED_FLOW (0x0002)` | `DSCP_MARKING (0x0004)` | `VLAN_MARKING (0x0008)` | `MAC_VALID (0x0010)` | `EGRESS_TRUSTSEC_VALID (0x0020)` | `FLOW_VALID (0x0040)` | `RETURN_VALID (0x0080)` | `XMIT_TYPE_VALID (0x0100)` | `NO_EDIT_RULE (0x0200)` | `FLOW_V4_VALID (0x0400)` | `RETURN_V4_VALID (0x0800)` | `RETURN_PPPOE_VALID (0x1000)` | `NO_UPDATE_RULE (0x2000)`。
* **`struct nss_ipv4_rule_create_msg` 字段序列 (`nss_ipv4.h:584-620`)**：
  1. `uint16_t valid_flags, rule_flags;`
  2. `nss_ipv4_5tuple tuple;` (`flow_ip, flow_ident, return_ip, return_ident, protocol, reserved[3]`)
  3. `nss_ipv4_connection_rule conn_rule;` (`flow_mac[3], return_mac[3], flow_interface_num, return_interface_num, flow_mtu, return_mtu, flow_ip_xlate, return_ip_xlate, flow_ident_xlate, return_ident_xlate` — NAT 改写字段直接内联在此结构体中)
  4. `nss_ipv4_protocol_tcp_rule tcp_rule;` (`flow_max_window, return_max_window, flow_end, return_end, flow_max_end, return_max_end, flow_window_scale, return_window_scale, reserved`)
  5. `pppoe_rule` -> `qos_rule` -> `dscp_rule` -> `vlan_primary_rule` -> `vlan_secondary_rule` -> `src_mac_rule` -> `nexthop_rule` -> `rps_rule` -> `igs_rule` -> `identifier` -> `mirror_rule`
* **`struct nss_ipv6_rule_create_msg` (`nss_ipv6.h:676-712`) 差异**：
  - `5tuple` IP 为 `uint32_t [4]`；`conn_rule` 无 `*_xlate` 字段；
  - **注意字段顺序差异**：`nss_ipv6_protocol_tcp_rule` (`L525-544`) 为 `flow_max_window, flow_end, flow_max_end, return_max_window, return_end, return_max_end, flow_window_scale, return_window_scale, reserved`（先全写 `flow_*` 再写 `return_*`，与 IPv4 交替排列不同）。
* **`conn_sync` & `conn_sync_many_msg` (`v4:L720-791`, `v6:L818-877`)**：含 `reason` (`STATS=0, FLUSH=1, EVICT=2, DESTROY=3`)、双向包/字节计数、`inc_ticks`、`qos_tag`、`cause`；批量查询 `conn_sync_many_msg` 头为 `uint16_t index, size, next, count;`。

---

## 九、 Wi-Fi (`wifili` / `ath11k`) 环共享、内存布局与 12.5 完整 ABI

### 9.1 HAL SRNG 环接管与 `ath11k` 内存交接

1. **`nss_wifili_hal_srng_info` (`nss_wifili_if.h:764-783`)**：
   `ring_id (u8)`, `mac_id (u8)`, `resv[2]`, `ring_base_paddr`, `num_entries`, `flags`, `ring_dir`, `entry_size`, `low_threshold`, `hwreg_base[2]`。
2. **`nss_wifili_init_msg` (`nss_wifili_if.h:857-889`)**：
   向固件移交 `ab->mem_pa`、shadow `rdptr`/`wrptr` 物理地址、`HAL_SRNG_RING_ID_LMAC1_ID_START`、4 个 `tcl_ring_info`、4 个 `tx_comp_ring`、4 个 `reo_dest_ring`、`reo_exception_ring`、`rx_rel_ring`、`reo_reinject_ring`、DMA 一致性 Tx 描述符页（`wtdim` 最多 32 页 + `wtdam` 最多 64 页）及 TLV 大小配置。
3. **`nss_wifili_pdev_init_msg` (`L903-920`)**：移交 `rx_refill_buf_ring` 作为 `rxdma_ring`，附带 `radio_id`, `hwmode`, `lmac_id`, `num_rx_swdesc`, `target_pdev_id`, `scheme_id`。
4. **Peer 与 AST 内存 (`nss_wifili_peer_msg`, `L949-976`)**：
   - `ath11k_nss_peer_create` 分配 **`WIFILI_NSS_PEER_BYTE_SIZE` (`1600` 字节)** 并做 `dma_map_single(..., DMA_TO_DEVICE)` 填入 `nss_peer_mem`，附带 `hw_ast_idx`、`tx_ast_hash`、`flags`（`DISABLE_4ADDR = 0x01`）；
   - **12.5 强制扩展字段**：`#ifndef NSS_FIRMWARE_VERSION_11_4` 末尾追加 **`uint32_t peer_memory_size`**。
   - **FlowID 映射 (`nss_wifili_peer_ast_flowid_map_msg`, `L926-943`)**：`ast_idx[4]`, `tid_valid_mask[4]`, `is_valid[4]`, `flowQ[4]`。

### 9.2 Wi-Fi 数据面封装与 12.5 专属扩展

* **TX**：`ath11k_nss_tx` 剥离 QoS ctl（Native Wi-Fi 模式）或追加 MIC/ICV 长度（Raw 模式），通过 `nss_wifi_vdev_tx_buf` -> `nss_core_send_packet()` 走 `NSS_IF_H2N_DATA_QUEUE` 下发。
* **RX 扩展包 (`N2H_BUFFER_PACKET_EXT = 13`)**：由 `nss_core_handle_ext_buffer_pkt()` 分发至 `ext_cb`；VAP 回调从 `skb->head + 4` 读取 `struct nss_wifi_vdev_per_packet_metadata`，处理 `WDS_LEARN (12)`、`MCBC_RX (14)` 与 **`4ADDR (17)`**（12.5 启用 `nss_wifi_vdev_addr4_data_metadata`: `peer_id, sa_valid, addr4_valid`）。
* **12.5 统计与行为差异**：
  - `NSS_WIFILI_DELAY_INDEX_MAX = 13`（11.4 为 `10`）；
  - `nss_wifili_peer_ctrl_stats.retry` 新增 6 项重试统计（`tx_failed_retry_count`, `tx_retry_count`, `tx_multiple_retry_count`, `rx_retry_count`, `tx_mpdu_retry_count`, `tx_mpdu_total_retry_count`）；
  - `tx_comp_ring_stats` 新增 `tx_cap_enqueue_count/fail_count`；`rx_ctrl_stats` 新增 `mcast_3addr_drop`, `ucast_rcv_cnt/bytes`；
  - 部分 12.5 固件（如 IPQ5018 12.5-210）对 `AP_VLAN` ext vdev 不主动上报 `WDS_LEARN`，需 Host 在 `ath11k_nss_ext_vdev_wds_learn` 补全 SA 学习。

---

## 十、 QSDK 12.5 全量剩余子系统 ABI 清单 (`exports/*.h`)

实现 12.5 固件全部功能时，除上述 L2/L3/Wi-Fi 外，其余子系统的 `if_num`、动态接口类型与核心控制消息如下：

### 10.1 加解密与安全隧道 (`Crypto` / `IPsec` / `DTLS` / `TLS` / `QVPN`)

| 子系统 | `if_num` / Dynamic Type | 核心 Opcode 与关键结构体 |
|---|---|---|
| **Crypto Common (`nss_crypto_cmn.h`)** | `NSS_CRYPTO_CMN_INTERFACE (167)` | `SETUP_NODE(1)` (`max_dma_rings, max_ctx, max_ctx_size`)、`SETUP_ENG(2)` (`fw_ver[4], dma_mask, req_count`)、`SETUP_DMA(3)` (`pair_id`)、`SETUP_CTX(4)` (`index, sec_offset, cipher_key[32], auth_key[128], nonce[4], algo(0..67), flags`)、`CLEAR/VERIFY_CTX(5,6)`、`SYNC_*_STATS(7..9)`。*(注：逐包加密头 `nss_crypto_cmn_buf_hdr` 属于独立 `qca-nss-crypto` 包)* |
| **IPsec (`nss_ipsec_cmn.h`)** | `NSS_IPSEC_CMN_INTERFACE (174)`<br>Dyn: `46..50` (`INNER/MDATA_INNER/OUTER/MDATA_OUTER/REDIRECT`) | `NODE_CONFIG(1)`、`CTX_CONFIG(2)`、`CTX_SYNC(3)`、`SA_CREATE(4)` (`sa_tuple`: `dest_ip[4], src_ip[4], spi_index, crypto_index, protocol, ip_ver`; `sa_data`: `seq_start, flags[0..10], window_size, blk/iv/icv_len`)、`SA_DESTROY(5)`、`SA_SYNC(6)`、`FLOW_CREATE/DESTROY(7,8)`；包头元数据 `nss_ipsec_cmn_mdata` (`version=1, magic=0x8893`) |
| **DTLS (`nss_dtls_cmn.h`)** | Dyn: `DTLS(13)`, `DTLS_CMN_INNER/OUTER(24,25)` | `CONFIGURE_NODE(0)`、`CONFIGURE_HDR(1)` (`flags`: `IPV6=0x1, UDPLITE=0x2, CAPWAP=0x4, GCM=0x8, ENCAP_METADATA=0x20000`)、`CONFIGURE_DTLS(2)` (`ver, crypto_idx, window_size, epoch, iv/hash/blk_len`)、`SWITCH_DTLS(3)`、`DECONFIGURE(4)`、**`UPDATE_VP(7)` (12.5 VP 映射 `vp_num`)** |
| **TLS (`nss_tls.h`)** | `NSS_TLS_INTERFACE (217)`<br>Dyn: `TLS_INNER/OUTER(63,64)` | 版本 `0x0301 (1.1)` / `0x0302 (1.2)`；`NODE_CONFIG/SYNC(0,1)`、`CTX_CONFIG/DECONFIG/SYNC(2..4)` (`except_ifnum, headroom, tailroom`)、`CIPHER_UPDATE(5)` (`crypto_idx, ver, skip`) |
| **QVPN (`nss_qvpn.h`)** | Dyn: `QVPN_INNER/OUTER(14,15)` | 可编程 VPN 流水线（最多 10 条指令/5 个 Profile：`ADD/REMOVE_VPN_HDR`, `ADD/REMOVE_L3_L4_HDR`, `ENCRYPT/DECRYPT`, `ANTI_REPLAY`）：`TUNNEL_CONFIGURE/DECONFIGURE(0,1)`、`CRYPTO_KEY_ADD/DEL/ACTIVATE/DEACTIVATE(2..5)`、`SYNC_STATS(6)` |

### 10.2 封装隧道与转发增强 (`CAPWAP` / `GRE` / `L2TPv2` / `PPTP` / `MAP-T` / `6RD` / `4in6` / `VxLAN`)

| 子系统 | `if_num` / Dynamic Type | 核心 Opcode 与关键结构体 |
|---|---|---|
| **CAPWAP (`nss_capwap.h`)** | Dyn: `CAPWAP_HOST_INNER/OUTER(67,68)` (`HEADROOM=256`) | `CFG/UNCFG_RULE(1,2)`、`ENABLE/DISABLE_TUNNEL(3,4)`、`UPDATE_PATH_MTU(5)`、`SYNC_STATS(6)`、`DTLS(8)`、`FLOW_RULE_ADD/DEL(9,10)`、`UPDATE_VP_NUM(11)` |
| **GRE / Tunnel / Redir** | `GRE(202)`, `GRE_TUNNEL(198)`, `GRE_REDIR(177)`, `GRE_REDIR_LAG(208)` | `nss_gre.h`: `CONFIG/DECONFIG/LINK_UP/DOWN/STATS` (`flags 0x1..0x4000`)；`nss_gre_tunnel.h`: 最多 16 会话，支持 `AES128/256_CBC`；`nss_gre_redir.h`: `INNER/OUTER_CONFIGURE`, `INTERFACE_MAP/UNMAP`, `SJACK_MAP/UNMAP` |
| **L2TPv2 (`nss_l2tpv2.h`)** | `NSS_L2TPV2_INTERFACE (190)`<br>Dyn: `10` (Max 4) | `SESSION_CREATE(0)` (`local/peer_tunnel_id, session_id, sip, dip, sport, dport, reorder_timeout, recv_seq, oip_ttl, udp_csum`)、`DESTROY(1)`、`SYNC_STATS(2)`、`BIND_IPSEC_IF(3)` |
| **PPTP (`nss_pptp.h`)** | `NSS_PPTP_INTERFACE (192)`<br>Dyn: `43..45` (Max 12) | `SESSION_CONFIGURE(0)` (`src/dst_call_id, sip, dip, sibling_ifnum_pri/aux`)、`DECONFIGURE(1)`、`SYNC_STATS(2)` |
| **MAP-T (`nss_map_t.h`)** | `NSS_MAP_T_INTERFACE (195)`<br>Dyn: `20,21` (Max 4) | `INSTANCE_RULE_CONFIGURE(0)`（本地/远端 v4/v6 前缀、EA len、PSID offset、MAP 风格、`sibling_if`）、`DECONFIGURE(1)`、`SYNC_STATS(2)` |
| **TUN6RD / TUNIPIP6** | Tunnel: `26`, `27` | `nss_tun6rd.h`: `ATTACH_PNODE(0)`, `RX_STATS_SYNC(1)`, `ADD_UPDATE_PEER(2)`；`nss_tunipip6.h`: `TX_ENCAP/DECAP_IF_CREATE(0,1)`, `FMR/BMR_RULE_ADD/DEL` |
| **PVxLAN / VxLAN / CLMAP** | `VXLAN(213)`, Dyn `51,52`, `56,57`, `54,55` | `nss_pvxlan.h` / `nss_vxlan.h`（12.5 扩展 VNI/VP 映射）；`nss_clmap.h` (`MAC_ADD/DEL/FLUSH`, `US/DS`) |

### 10.3 辅助功能 (`QRFS` / `Tstamp` / `LAG` / `Mirror` / `IGS` / `RMNET_RX`)

* **QRFS (`nss_qrfs.h`, IF `207`)**：`FLOW_ADD/DELETE(0,1)`（5 元组 + `cpu` + `if_num`）、`MAC_ADD/DELETE(2,3)`、`STATS_SYNC(4)`。
* **PTP 时间戳 (`nss_tstamp.h`, IF `210/211`)**：`nss_tstamp_h2n_pre_hdr`（`ts_ifnum, ts_tx_hdr_sz`）与 `nss_tstamp_n2h_pre_hdr`（`ts_ifnum, ts_data_lo, ts_data_hi, ts_tx, ts_hdr_sz`）。
* **LAG (`nss_lag.h`, IF `186..189`)**：`NSS_TX_METADATA_LAG_STATE_CHANGE(0)`（`lagid, interface, event: RELEASE=0/ENSLAVE=1`）。
* **Mirror (`nss_mirror.h`, Dyn `65`, Max 8)**：`CONFIGURE(0)`（`pkt_clone_point`, `size`, `offset`）、`ENABLE/DISABLE(1,2)`、`SET/RESET_NEXTHOP(3,4)`、`SYNC_STATS(5)`。
* **IGS (`nss_igs.h`, Dyn `53`, Max 8)** & **RMNET_RX (`nss_rmnet_rx.h`, IF `214`, Dyn `59,60`, 12 channels)**：入向整形与蜂窝 RmNet 通道配置及统计同步。
