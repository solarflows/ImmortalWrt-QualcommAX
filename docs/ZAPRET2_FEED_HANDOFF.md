# ImmortalWrt-QualcommAX: Zapret2 Feed 接入与抗 DPI 直连架构交接文档 (HANDOFF)

> **文档性质**：生产级工程交接文档 (Handoff)  
> **归属工程**：`ImmortalWrt-QualcommAX` (高通 IPQ807x / Linux 6.18 LTS / NSS-EDMA)  
> **关联合金**：`https://github.com/damocjwj/openwrt-zapret2` (Upstream Feed) 与 `smartdns-tuning` (寻址层真理源)  
> **核心使命**：在保持 100% 物理直连、0 境外代理流量消耗的前提下，彻底击碎 GFW 针对 GitHub 等跨国服务的七层明文 SNI 动态封锁状态机。

---

## 一、 架构全景与业务目标

### 1.1 业务场景与演进痛点
在 `czw.lan`（IPQ807x 生产路由）的网络环境中，开发机与核心业务坚持采用国内公网物理千兆直连（不走境外代理节点）。
- **寻址层已优化至极限**：通过 `smartdns-tuning` 模块化架构，实现了基于官方 CIDR 真理源的 Anycast 候选池优选与 `tcp-syn:443` 毫秒级首包胜出；
- **传输层不可克服的阻断困境**：GFW 针对 `github.com` 等服务部署了基于状态机的七层 SNI 深度包检测（DPI）。只要客户端发出包含明文 `SNI: github.com` 的 TLS ClientHello，DPI 探针即刻对该 IP:443 实施 3~15 分钟的滑动窗口丢包惩罚；
- **打地鼠死循环**：SmartDNS 无论如何调度 IP，在直连裸奔状态下，只要客户端发起真实通信，选出的 IP 就会在数分钟内被轮流封杀，陷入“周期性可用”的困境；
- **破局路径**：将对抗维度由“四层选 IP（DNS）”下沉至“四层报文去同步化（TCP Desync）”，引入 `zapret2` 核心引擎，在路由器网关出站处将 TLS ClientHello 报文进行微切片，使 GFW DPI 无法重组明文 SNI，直接放行直连。

### 1.2 双轨咬合运行模型
```text
                     客户端发起访问 (https://github.com/)
                                      │
                                      ▼
             [第一阶段: 寻址层 - SmartDNS 48.4]
             - 匹配官方 CIDR 资产 (github-web-ipv4.txt)
             - 快速返回官方存活骨干 IP (140.82.116.3 等)
                                      │
                                      ▼
             [第二阶段: 过滤层 - OpenWrt nftables]
             - 仅匹配特定 IP 集合 (@github_web) 且 dport 443
             - 动作: 进入 Linux 内核队列 (queue num 200)
             - 其余正常流量 100% 绕行，直通 NSS 硬件加速
                                      │
                                      ▼
             [第三阶段: 伪装层 - zapret2 (nfqws2)]
             - 嗅探 TLS 握手，在 SNI 处执行 TCP 载荷切片 (split2)
             - 重新计算校验和并注入内核协议栈发出
                                      │
                                      ▼
             [第四阶段: 骨干网出站]
             - GFW DPI 无法在单包中匹配完整 SNI ➔ 状态机放行
             - GitHub 官方机房 Linux 内核重组 TCP 分片 ➔ 200 OK 物理秒开
```

---

## 二、 Upstream Feed 审查与可靠性审计

经严格代码审计，选定 **`https://github.com/damocjwj/openwrt-zapret2`** 作为固件编译的外部 Feed 源。

### 2.1 核心可靠性审计指标
1. **源码清洁度与供应链安全**：
   - 上游源码严格指向 `bol-van/zapret2` 官方 Release `v1.0.4`，并通过 **SHA-256 校验和强锁死（`PKG_HASH:=3e18cdff...`）**；
   - 彻底剔除了上游未经验证的第三方脚本、后台自动拉取远端名单行为与任意命令执行漏洞，仅纯粹编译 `nfqws2` 核心引擎与官方标准 Lua 库。
2. **OpenWrt-Native 原生设计**：
   - 遵循标准 FHS：二进制安装至 `/usr/sbin/nfqws2`，Lua 库落盘至 `/usr/share/zapret2/lua/`；
   - 标准 UCI 控制面：`/etc/config/zapret2`（Schema v2）；
   - 标准 procd 服务守护：`/etc/init.d/zapret2`，支持崩溃恢复；
   - 现代化控制接口：采用 ucode + rpcd API v1，自带简体中文 LuCI（`luci-app-zapret2`）；
   - 系统升级保护：集成 `/lib/upgrade/keep.d/zapret2`，保证 `sysupgrade` 升级固件不丢配置。
3. **防火墙安全边界与事务回滚**：
   - 拥有完全独立的 **`table inet zapret2`** 表，绝不污染或篡改 `fw4` 主表与 PassWall 的 `inet passwall` 表；
   - 提交规则前预先执行 `nfqws2 --dry-run` 和 `nft -c` 沙盒测试，失败时原子回滚，杜绝死机断网；
   - 默认禁用（`enabled='0'`），默认拦截模式为 `marked` 且空名单，安装后绝对零流量误劫持。

---

## 三、 固件集成与编译构建契约

### 3.1 Feeds 配置文件挂载
在 `ImmortalWrt-QualcommAX/feeds.conf.default` 末尾追加：
```text
src-git zapret2 https://github.com/damocjwj/openwrt-zapret2.git
```

### 3.2 软件包更新与依赖安装
在本地或 CI 流水线编译脚本中执行：
```sh
./scripts/feeds update zapret2
./scripts/feeds install -p zapret2 zapret2 luci-app-zapret2
```

### 3.3 编译种子（Seeds / .config）激活项
```make
# 1. 核心引擎与前端界面
CONFIG_PACKAGE_zapret2=y
CONFIG_PACKAGE_luci-app-zapret2=y
CONFIG_PACKAGE_luci-i18n-zapret2-zh-cn=y

# 2. 内核队列驱动 (必须确保内核支持)
CONFIG_PACKAGE_kmod-nft-queue=y
CONFIG_PACKAGE_kmod-nfnetlink-queue=y
CONFIG_PACKAGE_kmod-nft-offload=y

# 3. 用户态核心通讯库
CONFIG_PACKAGE_libnetfilter-queue=y
CONFIG_PACKAGE_libmnl=y
CONFIG_PACKAGE_liblua5.3=y
CONFIG_PACKAGE_rpcd=y
CONFIG_PACKAGE_ucode=y
CONFIG_PACKAGE_zlib=y
CONFIG_PACKAGE_libcap=y
```

*注意：`zapret2/Makefile` 采用 `LUA_JIT=0`，直接链接现代 OpenWrt 标准的 `liblua5.3`，规避了 LuaJIT 在 aarch64 内核内存寻址边界上的潜在问题。*

---

## 四、 运行时协同与硬件保护契约 (铁律)

在 IPQ807x / Linux 6.18 固件运行期，必须严格遵守以下防御准则：

### 4.1 高通 NSS-EDMA / PPE 硬件加速防冲突契约
- **不可旁路性**：送入 `NFQUEUE` 队列的数据包必须先经由内核 CPU 处理，若在握手阶段被 NSS 硬件流卸载（Flow Offloading）旁路，会导致数据包跳过 `nfqws2` 从而使去同步化失效；
- **状态机极简放行**：
  在 nftables 规则中，**仅对初始三次握手与 ClientHello 报文入队**：
  ```nft
  ct state new,established tcp flags & (fin|syn|rst|ack) == syn queue num 200
  ```
  **连接一旦正常建立（握手完成），后续所有大流量传输 100% 归还高通 NSS 芯片硬件线速转发**，确保千兆下载跑满、路由器 CPU 占用维持在 0% 附近。

### 4.2 多租户防火墙命名空间绝缘
- `inet zapret2`：专司本地/转发的去同步化队列分流，其规则优先级（priority）需排在 mangle 之后；
- `inet passwall`：维持独立的特权代理（`psw_custom`）与分流节点链，两者的 mark 掩码必须分离（例如 zapret2 采用专用 mark 或纯端口队列，避免冲突）。

---

## 五、 验证与排障运行手册 (Runbook)

### 5.1 验证服务与队列监听
```sh
# 1. 检查 nfqws2 进程状态与内存占用 (预期 RSS ~2MB)
ps | grep nfqws2

# 2. 检查内核队列监听
cat /proc/net/netfilter/nfnetlink_queue

# 3. 检查独立防火墙表
nft list table inet zapret2
```

### 5.2 宿主机直连抗 DPI 验证 (Windows 终端执行)
在宿主机不开启任何代理（`--noproxy "*"`）的情况下：
```bash
# 1. 刷新本机解析器缓存
pwsh -Command "Clear-DnsClientCache"

# 2. 验证 TLS 1.3 握手在 SNI 阻断网段上能否直接通过 (如 20.205.243.166:443)
curl -v -I --noproxy "*" -m 5 https://github.com/

# 3. 验证 Releases 二进制文件持续下载吞吐
curl -L -r 0-10485759 -o NUL -w "Speed: %{speed_download} B/s\n" --noproxy "*" "https://github.com/CherryHQ/cherry-studio/releases/download/v2.1.7/Cherry-Studio-2.1.7-win-x64-setup.exe"
```
预期结果：TCP 握手与 TLS ClientHello 顺利穿透，返回 `HTTP/1.1 200 OK`，千兆直连吞吐稳定。
