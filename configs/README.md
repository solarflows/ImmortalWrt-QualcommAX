# ImmortalWrt-QualcommAX 种子配置架构指南 (Seed Architecture Guide)

本项目采用**领域驱动（Domain-Driven）的模块化 10-Seed 架构**管理 OpenWrt/ImmortalWrt 编译配置，彻底告别单体巨型 `.config` 或混乱的散装 seed。

---

## 一、 核心工作原理与拼接流水线

在 `AutoWorkFlows` Reusable CI 构建流水线（`compile-firmware.yml`）中，配置加载遵循以下步骤：

1. **词法有序合并**：
   流水线按文件名天然字典序（`01 -> 10`）将目标目录下的所有 `.seed` 片段按序流式拼接：
   ```bash
   cat configs/${target}/*.seed > .config
   ```
2. **Kconfig 依赖求解 (`make defconfig`)**：
   拼接生成的 `.config` 仅包含显式声明的顶层开关与核心参数。执行 `make defconfig` 时，OpenWrt 构建系统将基于 Kconfig 规则树自动补全所有反向依赖（Reverse Dependencies）与底层底层驱动。
3. **SDK / ImageBuilder 显式抓取**：
   在打包流程中，CI 通过 `grep -E '^CONFIG_PACKAGE_...=y$'` 提取目标软件包集合。因此，**所有需要打包进固件的关键应用与二进制必须显式声明 `=y`，严禁依赖 Kconfig 的隐式 `default y`**。

---

## 二、 10 大种子领域职责与分流规则

当需要添加、移除或调整配置项时，请严格根据以下领域职责将其放入对应文件：

| 编号 | 种子文件名 | 领域职责定义 (Scope) | 典型配置项与包示例 |
| :--- | :--- | :--- | :--- |
| **01** | `01-base.seed` | **目标平台、设备画像与 NSS 内存规格基底**<br>决定芯片架构、机型 Profile、NSS 12.5 固件与内存画像（全套 NSS 驱动、运行时工具与监控由源码底座 Makefile 自动自举）。 | `CONFIG_TARGET_qualcommax=y`<br>`CONFIG_NSS_FIRMWARE_VERSION_12_5=y`<br>`CONFIG_NSS_MEM_PROFILE_HIGH=y`<br>`CONFIG_DEVEL=y`<br>`CONFIG_CCACHE=y` |
| **02** | `02-hardware.seed` | **外设算力、指令集扩展与底层外设**<br>CPU 特性、ARMv8 指令集、密码学硬件卸载 (MbedTLS AES-CE/SHA2-CE)、LED/按键。 | `CONFIG_MBEDTLS_AESCE_C=y`<br>`CONFIG_MBEDTLS_SHA256_USE_ARMV8_A_CRYPTO_IF_PRESENT=y`<br>`kmod-crypto-*`<br>`kmod-leds-*`, `kmod-ledtrig-*` |
| **03** | `03-system.seed` | **系统基础库、Shell 终端与 LuCI 框架**<br>核心系统动态库、命令行工具、文本编辑器、Web 界面底座、本地化与基础运维插件。 | `libc`, `libcurl`, `libpcre2`<br>`bash`, `coreutils`, `nano-plus`, `vim` (Tiny), `htop`, `jq`<br>`default-settings-chn`, `luci-theme-aurora`, `luci-theme-footstrap`<br>`ttyd`, `taskplan`, `vlmcsd`, `wechatpush` |
| **04** | `04-network.seed` | **核心网络栈、NAT、DNS 与网络诊断**<br>网络协议栈、SONiC NAT1 穿透、DNS 解析过滤、UPnP、组播、DDNS、通用 QoS 流控与网络排错工具。 | `fullconenat-sonic`, `luci-app-fullconenat-sonic`<br>`smartdns`, `luci-app-dnsfilter`<br>`bind-client`, `bind-dig` (仅客户端库)<br>`miniupnpd-nftables`, `ddns-scripts`<br>`sqm-scripts`, `iperf3`, `tcpdump`, `socat` |
| **05** | `05-tunnel.seed` | **隧道互联、异地组网与内网穿透**<br>安全隧道协议、虚拟局域网、P2P 打洞、反向代理穿透客户端。 | `kmod-wireguard`, `wireguard-tools`<br>`zerotier`, `natmap`, `ddnsto`<br>`frpc`, `frps`, `lucky`, `cloudflared` |
| **06** | `06-modem.seed` | **USB CPE、随身 WiFi 与 4G/5G 蜂窝网络**<br>模式切换、免驱虚拟网卡驱动、蜂窝拨号协议栈、串口与 AT 诊断指令。 | `usb-modeswitch`, `usbutils`<br>`kmod-usb-net-rndis`, `kmod-usb-net-cdc-ether`<br>`kmod-usb-net-cdc-ncm`, `kmod-usb-net-huawei-cdc-ncm`<br>`kmod-usb-net-ipheth` (iPhone 共享)<br>`kmod-usb-net-qmi-wwan`, `uqmi`, `luci-proto-qmi`<br>`kmod-usb-net-cdc-mbim`, `umbim`, `luci-proto-mbim`<br>`kmod-usb-serial-option`, `kmod-usb-acm` |
| **07** | `07-storage.seed` | **块设备、文件系统与本地存储共享**<br>磁盘分区、SMART 监控、文件系统格式化挂载、文件传输与管理服务。 | `parted`, `fdisk`, `lsblk`, `smartmontools`<br>`btrfs-progs`, `dosfstools`, `exfat-*`<br>`openssh-sftp-server` (SFTP 服务端)<br>`dufs`, `luci-app-filemanager` |
| **08** | `08-containers.seed` | **容器化引擎与高级脚本运行时环境**<br>轻量容器栈（Podman/crun）与重型脚本语言运行时（Perl/Python/Ruby）。 | `podman`, `crun`, `conmon`, `netavark`<br>`perl` + `perlbase-*`<br>`python3-base`, `python3-light`<br>`ruby` + `ruby-*` |
| **09** | `09-monitoring.seed` | **时序数据采集、状态统计与主机入侵审计**<br>Collectd 监控插件族、RRD 绘图引擎、黑名单防御与漫游审计。 | `luci-app-statistics`, `collectd`, `rrdtool1`<br>`collectd-mod-*` 监控插件全家桶<br>`banip`, `luci-app-banip`, `fail2ban`<br>`luci-app-wifihistory` |
| **10** | `10-proxy.seed` | **出海代理控制面、核心引擎与规则库**<br>代理 WebUI 面板、透明代理链、后端内核二进制、地理规则文件、分流 DNS 与辅助转发。 | `luci-app-passwall`, `luci-app-passwall2`, `luci-app-homeproxy`, `luci-app-openclash`<br>`sing-box`, `xray-core`, `shadowsocks-rust`<br>`haproxy`, `hysteria`, `naiveproxy`<br>`geoview`, `v2ray-geoip-full`, `v2ray-geosite-full`<br>`chinadns-ng`, `dns2socks`, `ipt2socks`, `tcping` |

---

## 三、 机型差异化配置策略 (Profile Differences)

| 维度 | `ipq807x` (Netgear RBR750) | `ipq60xx` (Link NN6000 v2) |
| :--- | :--- | :--- |
| **硬件定位** | 高端三频分布式家庭旗舰路由 | 高性能多网口多存储全能边缘枢纽 |
| **种子文件覆盖** | `01` ~ `05` + `07` + `10`（共 7 个 seed，无物理 USB 接口故不加载 `06-modem`） | `01` ~ `10`（全量 10 个 seed） |
| **容器支持** | ❌ **不启用**（保持极致稳健与轻量） |  **启用 Podman 容器套件** (`08-containers.seed`) |
| **脚本运行时** | ❌ 仅保留基础 `lua` |  **内置完整 Perl、Python3、Ruby 运行库** (`08-containers.seed`) |
| **监控分析** | ❌ 避免频繁写 Flash 与 RRD 磁盘开销 |  **启用 Collectd 监控统计与 Fail2ban 审计** (`09-monitoring.seed`) |
| **代理控制面** | 三重代理（PassWall + PassWall2 + HomeProxy） | 四重代理（PassWall + PassWall2 + HomeProxy + OpenClash） |
| **磁盘管理** | 仅保留基本 SFTP 传输与 DufS 轻量共享 | 完整集成 Diskman、分区工具、Btrfs/exFAT 工具链 |

---

## 四、 增删修改包时的维护准则 (Maintenance Rules)

在向 seed 中新增或修改包时，请务必遵守以下工程铁律：

1. **语言包配对准则**：
   每引入一个 `CONFIG_PACKAGE_luci-app-<name>=y`，必须在同文件内显式声明对应的 `CONFIG_PACKAGE_luci-i18n-<name>-zh-cn=y`。
2. **最小依赖审查**：
   - 严禁引入不必要的重型服务套件（例如：`ddns-scripts-nsupdate` 仅依赖 `bind-client` + `bind-libs`，绝对不能引入包含服务端的全套 `bind` 工具）。
   - 文本编辑器统一使用官方 Tiny 紧凑版 `CONFIG_PACKAGE_vim=y`，切勿引入臃肿的 `vim-runtime`。
3. **编译特性子选项归位**：
   软件包的编译参数（例如 `CONFIG_SING_BOX_BUILD_*` 或 `CONFIG_PARTED_READLINE`）必须与该软件包本身置于同一 seed 文件内。
4. **蜂窝网络扩展规范**：
   USB 4G/5G 网卡相关驱动与协议工具（如新增 ECM/RNDIS/NCM/QMI/MBIM 相关驱动）必须集中维护在 `06-modem.seed` 中，严禁散落至 `03-system` 或 `04-network`。
