# NSS 驱动系列审阅发现与修复指南

> 基线：`nss-edma-julius` 分支 `16e4edb1b2`，2026-10-27。
> 审阅范围：6 个包补丁（全部精读）、3 个关键内核补丁（0960/0961/0970，逐行验证）、
> 14 个其余内核补丁（模式扫描）、驱动源码 4 类 bug 模式扫描、构建集成、启动脚本、LuCI 应用。
> 每条发现均由本人读源码复核，非仅采信子代理报告。

---

## 一、确认的 9 个问题（按修复优先级排序）

### P0-1：`br_port_get_rcu()` 在 RCU 临界区外调用

- **文件**：`target/linux/qualcommax/patches-6.18/0960-qca-nss-ecm-support-CORE.patch`
- **位置**：补丁 424 行（`br_fdb_entry_refresh`）和 442 行（`br_fdb_has_entry`）
- **问题**：`br_port_get_rcu(dev)` 是 `rcu_dereference(dev->rx_handler_data)`，
  两个函数都在 `rcu_read_lock()` **之前**调用它。与 `br_del_if()`（桥端口移除，
  `kfree_rcu` 释放 `net_bridge_port`）有真实 UAF 竞态。ECM stats sync workqueue
  在进程上下文调用此路径，无外部保护。
- **修复**：把 `rcu_read_lock()` 移到函数入口，`rcu_read_unlock()` 放在所有
  early-return 路径和函数末尾。
- **修复安全性**：✅ 纯增加保护范围，零行为变化。

```c
// 修复前
struct net_bridge_port *p = br_port_get_rcu(dev);   // ← 无 RCU 保护
if (!p || p->state == BR_STATE_DISABLED)
    return;
rcu_read_lock();                                     // ← 锁来得太晚

// 修复后
rcu_read_lock();
p = br_port_get_rcu(dev);                            // ← RCU 保护下
if (!p || p->state == BR_STATE_DISABLED) {
    rcu_read_unlock();
    return;
}
```

### P0-2：`ppp_connect_channel()` 在释放锁后使用 `ppp` 指针

- **文件**：`target/linux/qualcommax/patches-6.18/0961-qca-nss-ecm-support-PPPOE-offload.patch`
- **位置**：补丁 60-67 行
- **问题**：`mutex_unlock(&pn->all_ppp_mutex)` 之后才 `dev_hold(ppp->dev)`。
  并发 `ppp_disconnect_channel`（另一 CPU，由 pppd 断开或 socket 关闭触发）
  可释放 `ppp` 的最后引用 → `free_netdev(ppp->dev)` → `dev_hold` 是 UAF。
  czw 用 PPPoE WAN，每次拨号/断线都走这条路径。
- **修复**：把 `dev_hold(ppp->dev)` 移到 `mutex_unlock` 之前（锁内 ppp 必定
  存活），notifier 调用和 `dev_put` 留在锁外。
- **修复安全性**：✅ 锁内取引用，锁外使用。已验证 ECM PPPoE 回调不取
  `all_ppp_mutex`，无死锁。

```c
// 修复前
mutex_unlock(&pn->all_ppp_mutex);
if (notify) {
    dev_hold(ppp->dev);        // ← ppp 已不受保护
    raw_notifier_call_chain(..., PPP_CHANNEL_CONNECT, ppp->dev);
    dev_put(ppp->dev);
}

// 修复后
if (notify)
    dev_hold(ppp->dev);        // ← 锁内，ppp 必定存活
mutex_unlock(&pn->all_ppp_mutex);
if (notify) {
    raw_notifier_call_chain(..., PPP_CHANNEL_CONNECT, ppp->dev);
    dev_put(ppp->dev);
}
```

### P1-1：RAW notifier 链无注销同步

- **文件**：`target/linux/qualcommax/patches-6.18/0961-qca-nss-ecm-support-PPPOE-offload.patch`
- **位置**：补丁 24 行（`RAW_NOTIFIER_HEAD`）、26-36 行（register/unregister）、
  64-65/77-78 行（调用点）
- **问题**：RAW notifier 链无锁无 RCU（内核文档明确"调用者自理"）。
  `qca-nss-pppoe` 模块卸载时，另一 CPU 上的 `notifier_call_chain()` 可遍历
  已摘链的 `notifier_block` → 模块数据已释放 → oops。
- **修复**：`RAW_NOTIFIER_HEAD` → `BLOCKING_NOTIFIER_HEAD`，
  `raw_notifier_chain_register` → `blocking_notifier_chain_register`，
  `raw_notifier_call_chain` → `blocking_notifier_call_chain`，
  `raw_notifier_chain_unregister` → `blocking_notifier_chain_unregister`。
- **修复安全性**：✅ **更正确**。调用点在进程上下文（可睡眠）；ECM 回调做
  `nss_pppoe_tx_msg_sync`（同步等固件回复，会睡眠）——raw 链本就不该承载
  会睡眠的回调，blocking 链才是正确选择。`blocking_notifier_chain_unregister`
  的 `down_write` 会等所有活跃调用点完成，正是需要的同步。

### P1-2：`nf_conntrack_unregister_ecm_notifier()` 缺 `synchronize_rcu()`

- **文件**：`target/linux/qualcommax/patches-6.18/0970-netfilter-conntrack-decouple-ecm-event-notifier.patch`
- **位置**：补丁 75-80 行
- **问题**：ECM 回调在 `rcu_read_lock()` 内被调用，注销只做
  `RCU_INIT_POINTER(..., NULL)` 无 `synchronize_rcu()`。ECM 模块卸载时，
  仍在 RCU 临界区的 CPU 调用已释放的模块代码 → oops。
- **修复**：注销函数末尾加 `synchronize_rcu()`。
- **修复安全性**：✅ 纯等待，无副作用，无死锁。

```c
// 修复后
void nf_conntrack_unregister_ecm_notifier(struct net *net)
{
    mutex_lock(&nf_ct_ecache_mutex);
    RCU_INIT_POINTER(net->ct.nf_conntrack_ecm_cb, NULL);
    mutex_unlock(&nf_ct_ecache_mutex);
    synchronize_rcu();    // ← 等待所有 RCU 读者完成
}
```

### P2-1：`br_fdb_has_entry()` 在 RCU 解锁后返回裸指针

- **文件**：`target/linux/qualcommax/patches-6.18/0960-qca-nss-ecm-support-CORE.patch`
- **位置**：补丁 448-452 行
- **问题**：`rcu_read_unlock()` 后返回 `fdb` 指针——FDB 条目用 `kfree_rcu`
  删除，返回后指针随时可被释放。4 个调用方（`ecm_db_connection.c:3249/3429`、
  `ecm_ipv4.c:2155`、`ecm_ipv6.c:2251`）全部只做 `!br_fdb_has_entry(...)`
  布尔判断，**零解引用**——不会崩溃，但 TOCTOU 是真实的：检查通过后条目
  立刻老化删除，ECM 会加速一个 MAC 已消失的桥接流（错误加速）。
- **修复**：返回类型从 `struct net_bridge_fdb_entry *` 改为 `bool`。
- **修复安全性**：✅ 4 个调用方全部只做布尔判断，`!` 运算符对指针和 bool
  行为一致，调用方零改动。

```c
// 修复前
struct net_bridge_fdb_entry *br_fdb_has_entry(struct net_device *dev,
    const char *addr, __u16 vid)
{
    ...
    rcu_read_unlock();
    return fdb;    // ← 裸指针，随时可被释放
}

// 修复后
bool br_fdb_has_entry(struct net_device *dev, const char *addr, __u16 vid)
{
    ...
    rcu_read_unlock();
    return fdb != NULL;    // ← 只返回存在性
}
```

### P2-2：`fdb_event.is_local` 未初始化

- **文件**：`target/linux/qualcommax/patches-6.18/0960-qca-nss-ecm-support-CORE.patch`
- **位置**：补丁 385 行（声明）、394-398 行（部分初始化）、408-411 行（传给 notifier）
- **问题**：`struct br_fdb_event fdb_event;` 声明无 memset，只设了 4 个字段
  （addr/br/orig_dev/dev），`is_local` 含栈垃圾。同文件 `br_fdb_cleanup()`
  的同类调用（355 行）**有** memset——证明这里的遗漏是意外。当前两个消费者
  （ECM、bridge-mgr）不读 `is_local`，是潜伏的。
- **修复**：在 394 行之前加 `memset(&fdb_event, 0, sizeof(fdb_event));`
  或显式 `fdb_event.is_local = false;`。
- **修复安全性**：✅ 垃圾变 0，零行为变化。

### P3-1：`nss_qdisc_stats.c` 的 `usleep_range` 在 workqueue 里

- **文件**：`package/nss/qca-nss-clients/src/nss_qdisc/nss_qdisc_stats.c`
- **位置**：537 行
- **问题**：与 ECM 负载假象同类的 `TASK_UNINTERRUPTIBLE`——qdisc stats sync
  workqueue 里 `usleep_range(4900, 5000)`。czw 上 qdisc 模块未加载（qdisc=1），
  当前不触发。加载后（SQM 场景）会把负载再推高。
- **修复**：新建补丁文件 `package/nss/qca-nss-clients/patches/0003-nss_qdisc-use-usleep_range_idle-for-stats-sync.patch`，
  把 `usleep_range` 改为 `usleep_range_idle`。
- **修复安全性**：✅ `TASK_IDLE` = `TASK_UNINTERRUPTIBLE | TASK_NOLOAD`，
  对 kworker 语义完全一致（kworker 收不到信号），唯一区别是不进负载计数。

### P3-2：`pppoe_get_addressing()` 无锁读 `po->pppoe.dev`

- **文件**：`target/linux/qualcommax/patches-6.18/0961-qca-nss-ecm-support-PPPOE-offload.patch`
- **位置**：补丁 355-368 行
- **问题**：拷贝 `po->proto.pppoe` 和 `dev_hold(addressing->dev)` 无
  `lock_sock(sk)`，与 `pppoe_release()` 的 `dev_put + NULL` 竞态。窗口极窄
  （需同时有 netdev 注销）。
- **结论**：**接受现状，不修**（2026-10-27 实施时撤回原方案）。原方案
  `lock_sock` 不可行：调用链 `ecm_ipv4_ip_callback`（netfilter hook，
  softirq 上下文）→ `ecm_ported_ipv4_process` →
  `ecm_ipv4_node_establish_and_ref` → `ecm_interface_mac_addr_get_pppoe`
  → `pppoe_get_addressing`。`lock_sock` 是睡眠锁，softirq 中会
  scheduling-while-atomic 崩溃。正确修复需把 `po->pppoe.dev` RCU 化
  （写入侧 `rcu_replace_pointer` + `synchronize_rcu` + `dev_put`，
  读取侧 `rcu_dereference` + `dev_hold`），涉及 `pppoe_release` 核心
  路径与 struct 定义，改动面远大于纳秒级窗口的风险。与 P3-3 同理。

### P3-3：`ppp_hold_channels()` 的 `pch->chan` TOCTOU

- **文件**：`target/linux/qualcommax/patches-6.18/0961-qca-nss-ecm-support-PPPOE-offload.patch`
- **位置**：补丁 227-241 行
- **问题**：`pch->chan` 的 NULL 检查（227 行）和解引用（239-240 行）是两次
  无保护读取。`pch->chan` 由 `pch->downl` 保护（不是我们持有的 `ppp_lock`），
  另一 CPU 可在两次读取之间清空它。**完整分析见对话中的拆解**。
- **结论**：**接受现状，不修**。窗口纳秒级，上游 QSDK 原厂代码，全世界的
  NSS 固件带着这个窗口运行了十年。完整修复需重构引用获取机制（RCU 化），
  改动面远大于风险。可选做单次读取收窄（一行），但不改变风险等级。

---

## 二、主动撤回的假阳性

| 项 | 原判断 | 撤回原因 |
|---|---|---|
| `nss_core.c:576` of_node 泄漏 | 疑似 | `of_node_put` 在 609/623 行，超出 800 字符扫描窗口 |
| kmalloc 无 NULL 检查（15 处） | 疑似 | 全部在下一行有检查，grep 只看分配行 |
| SFE 前端 `usleep_range`（2 处） | 疑似负载 | `ECM_FRONT_END_NSS_ENABLE=y`，SFE 未编译 |
| gre `msleep(2000)` | 疑似阻塞 | gre 模块不在构建目标 |
| tun6rd/capwap/gre/l2tp 等 12 处 of_node 泄漏 | 疑似 | 模块不在构建目标 |

## 三、审阅通过的部分

| 类别 | 项 | 结论 |
|---|---|---|
| 包补丁 × 6 | drv 0001/0002、clients 0001/0002、ecm 0001/0002 | 全部正确 |
| 模式扫描 | spinlock+sleep、kmalloc NULL、of_node（已构建模块） | 全部干净 |
| 构建集成 | Makefile×3、ECM init、uci-defaults | 全部正确 |
| 启动脚本 | nss.init、nss-up（239 行）、nss-wedge-watch（500 行） | 无 bug |
| LuCI 应用 | luci-nss-status.js、luci-app-nss-dashboard | 无问题 |

## 四、修复执行计划

| 阶段 | 项 | 修法 | 预计行数 |
|---|---|---|---|
| P0 | #2 br_port_get_rcu | 移 rcu_read_lock 到函数入口 | 2 个函数 × 4 行 |
| P0 | #4 ppp_connect UAF | dev_hold 移到 mutex_unlock 前 | 3 行 |
| P1 | #5 RAW→BLOCKING | 4 处标识符替换 | 4 行 |
| P1 | #8 注销加 synchronize_rcu | 1 行 | 1 行 |
| P2 | #1 返回改 bool | 签名 + return | 2 行 |
| P2 | #3 加 memset | 1 行 | 1 行 |
| P3 | #9 qdisc usleep_idle | 新建补丁文件 | 12 行 |
| — | #7 lock_sock | 不修（softirq 上下文，见 P3-2） | 0 |
| — | #6 TOCTOU | 不修（接受现状） | 0 |

**全部修复都在内核补丁文件里**（`target/linux/qualcommax/patches-6.18/`），
需要重编内核。P3-1（qdisc）在包补丁目录，需要重编 qca-nss-clients。

---

## 五、修复实施记录（2026-10-27）

| 项 | 状态 | 实际修改 |
|---|---|---|
| P0-1 br_port_get_rcu RCU 范围 | ✅ 已修 | 0960：两个函数 `rcu_read_lock()` 移至 `br_port_get_rcu()` 之前，early-return 路径补 unlock |
| P0-2 ppp_connect_channel UAF | ✅ 已修 | 0961：`dev_hold` 移到 `mutex_unlock` 之前（`if (notify)` 守卫，错误路径 notify=0 不解引用） |
| P1-1 RAW→BLOCKING notifier | ✅ 已修 | 0961：HEAD / register / unregister / call×2 共 5 处标识符替换 |
| P1-2 注销缺 synchronize_rcu | ✅ 已修 | 0970：unregister 末尾加 `synchronize_rcu()` |
| P2-1 br_fdb_has_entry 返回 bool | ✅ 已修 | 0960：函数体 + `if_bridge.h` extern 声明同步改 bool；4 个 ECM 调用方零改动（全部 `!` 布尔判断，已逐一核实） |
| P2-2 fdb_event.is_local 未初始化 | ✅ 已修 | 0960：`br_fdb_update` 路径加 memset（与 `br_fdb_cleanup` 路径对齐） |
| P3-1 qdisc usleep_range | ✅ 已修 | 新建 `qca-nss-clients/patches/0003-nss_qdisc-use-usleep_range_idle-for-stats-sync.patch` |
| P3-2 pppoe_get_addressing 无锁读 | ❌ 不修 | `lock_sock` 在 softirq 上下文不可用（调用链经 netfilter hook），正确修复需 RCU 化，改动面远大于风险 |
| P3-3 ppp_hold_channels TOCTOU | ❌ 不修 | 原决策不变 |

**验证**：4 个补丁 hunk 计数校验全部通过；0003 对源码
`git apply --check` 通过；0001/0002 未触碰 `nss_qdisc_stats.c`
（无应用顺序冲突）。

**待办**：重编内核（0960/0961/0970）+ qca-nss-clients（0003），部署 czw 验证。
