# NSS 硬件加速控制中心 (luci-app-nss-dashboard) 核心排障与工程规约

本文档总结 `luci-app-nss-dashboard` 在底层内核驱动对接、ubus 数据管道设计与 LuCI 前端视图渲染中所沉淀的典型技术陷阱与排障指南，作为后续固件维护与二次开发的规范基准。

---

## 一、 数据管道与内核状态排障 (Kernel & Data Pipeline)

### 1. Conntrack / ECM 事件分发与 nssqos 依赖解耦
- **故障现象**：硬件流表页面（Flows）完全空白，或内核日志频繁出现 conntrack notifier 重复挂载警告。
- **底层根因**：
  1. 上游内核历史版本中，`ctnetlink` 与 `qca-nss-ecm` 争夺单个 `nf_conntrack_event_cb` 槽位，相互覆盖导致 conntrack 计数断流；
  2. `/usr/sbin/nssqos-conns` 输出的是标准单行紧凑 JSON 数组。旧脚本采用 `awk 'NR > 1 && count < 60'` 强行按行切分，第 1 行即包含全部流数据，直接被 `NR > 1` 规则整行过滤丢弃；
  3. 部分极简固件未集成 `nssqos` 包，导致调用不存在的二进制返回空。
- **工业级标准解法**：
  - **内核层**：打入 `0970-netfilter-conntrack-decouple-ecm-event-notifier.patch`，在 `struct netns_ct` 为 ECM 开辟独立 `nf_conntrack_ecm_cb` RCU 槽位，彻底消除与 ctnetlink 的冲突；
  - **后端 rpcd**：在 `luci.nss_dashboard` 中检测 `[ ! -x /usr/sbin/nssqos-conns ]`，未安装时输出 `{"installed":0,"flows":[]}`；存在时直接输出原生 JSON，0 行 awk 切分；
  - **前端视图**：`flows.js` 判定 `installed === 0` 时，渲染原生友好提示卡片，明确告知用户缺少可选特性组件，不影响底层 NSS 核心线速转发。

---

### 2. 物理协商速率 (Speed) 与 64 位累计流量采集
- **故障现象**：端口线速矩阵中 Speed 列沦为“已连接”文字，RX/TX 吞吐恒为 0 B。
- **底层根因**：
  1. 上游胶水层调试接口 `/sys/kernel/debug/qca-ppe-nss/status` 只记录 PPE 内部描述符的挂载状态（`started: 1/0`），完全不记录以太网 PHY 物理层协商的具体速率（100M/1000M/2.5G/10G）与载波通断（carrier）；
  2. 老版 `luci-app-nss` 并未采集 PHY 速率与字节，仅展示数据包数（Packets），且在页面底部注明由系统概览展示总流量；
  3. 前端兜底代码 `p.speed || (isUp ? '已连接' : '未连接')` 在字段为空时直接退化为文字“已连接”。
- **工业级标准解法**：
  - **前端原生 ubus 定向拉取**：在 `ports.js` 中声明原生 `network.device status {"name": netdev}`，仅对 NSS EDMA 绑定的活跃物理接口定向并发请求；
  - **状态与速率清洗**：优先读取 `dev.carrier` 判定物理通断；通过正则清洗 `dev.speed`（如 `"1000F"` ➔ `1000M` 绿色徽章，未插线 ➔ `未连接` 灰色徽章）；
  - **64 位流量获取**：直接读取 `dev.statistics.rx_bytes` 与 `dev.statistics.tx_bytes`，使用 LuCI 原生 `String.format('%1024.1mB', ...)` 动态格式化为 B/KB/MB/GB；
  - **后端 sysfs 单进程保底**：在 `luci.nss_dashboard` 中通过单次 awk 读取 `/sys/class/net/<dev>/speed` 与 `statistics/{rx,tx}_bytes`，零外部进程 fork。

---

## 二、 LuCI 前端视图与 DOM 构建规约 (Frontend & DOM Architecture)

### 1. LuCI `E()` 辅助函数的嵌套数组序列化陷阱
- **故障现象**：多协议单元格或多标签渲染为 `[object HTMLSpanElement],[object HTMLSpanElement]`。
- **底层根因**：
  LuCI 原生 DOM 构建器 `E(tag, attrs, children)` 处理子元素时的实现逻辑如下：
  ```javascript
  if (!Array.isArray(children)) children = [ children ];
  for (var i = 0; i < children.length; i++) {
      if (children[i] instanceof Node)
          e.appendChild(children[i]);
      else if (children[i] !== null && children[i] !== undefined)
          e.appendChild(document.createTextNode(children[i]));
  }
  ```
  若书写 `E('td', {}, [ Object.keys(c.protos).map(...) ])`，传入的 `children[0]` 为嵌套的 `Array` 对象而非 DOM `Node` 实例。`instanceof Node` 校验失败，触发 `document.createTextNode(child)`，执行 `Array.prototype.toString()` 变成逗号分隔的对象字符串。
- **规约禁令**：
  - 严禁在 `children` 数组内再包裹一层冗余的中括号；
  - 必须直接将 `.map()` 返回的 Node 数组作为直接参数传入容器：
    ```javascript
    E('td', { 'class': 'td' }, [
        E('div', { 'style': 'display:inline-flex; gap:4px; flex-wrap:wrap;' },
            Object.keys(c.protos).map(function(pr) {
                return badge((pr === 'TCP') ? 'badge-info' : 'badge-warning', pr);
            })
        )
    ])
    ```

---

### 2. 选项卡悬空 (Tab Floating) 与断行变形陷阱
- **故障现象**：在窄视口（如移动端或控制台侧栏，~500px）下，选项卡文本换行断裂（如“状态总 / 览 / (Status)”），且激活选项卡的下边框与容器底线错位脱节，呈现“悬空”状态。
- **底层根因**：
  1. `.cbi-tabmenu` 缺少 `white-space: nowrap` 与 `flex-wrap: nowrap`，不同选项卡文本长短不一导致换行行数不一致（部分 3 行，部分 2 行）；
  2. 选项卡容器 flex 默认高度由最高的 3 行 Tab 撑开，较矮的 Tab 靠顶对齐，导致其底边未能延伸到底部容器基准线；
  3. 未设置 `overflow-x: auto`，移动端产生挤压变形。
- **工业级标准解法**：
  - 在 `nss.css` 固化标准弹性单行选项卡：
    ```css
    .cbi-tabmenu {
        display: flex;
        flex-wrap: nowrap;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        border-bottom: 1px solid var(--border-color-high);
        scrollbar-width: none;
    }
    .cbi-tabmenu > li.cbi-tab {
        flex-shrink: 0;
        margin: 0 0 -1px 0;
        display: flex;
    }
    .cbi-tabmenu > li.cbi-tab > a {
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        padding: 7px 14px;
        border: 1px solid transparent;
        border-bottom: 1px solid var(--border-color-high);
        border-radius: 4px 4px 0 0;
    }
    .cbi-tabmenu > li.cbi-tab.active > a {
        background: var(--background-color-high);
        border-color: var(--border-color-high);
        border-bottom-color: var(--background-color-high) !important;
        font-weight: 700;
    }
    ```
  - 强制 `white-space: nowrap` 与 `flex-shrink: 0`，保证无论文本长短，所有 Tab 高度严格一致，下边框绝对贴合基准线。

---

### 3. 主题 Design Tokens 变量对齐与实体模块框规范
- **故障现象**：真机界面强调色全无，排版退化为无边框平铺黑底白字。
- **底层根因**：OpenWrt 官方 `cascade.css` 没有提供 `.badge` 等辅助类；且模块缺少实体边框与摘要栏容器。
- **工业级标准解法**：
  - 必须由插件自带的 `nss.css` 提供 100% 绑定 LuCI 官方底层 CSS 变量（`--background-color-high`、`--text-color-high`、`--primary-color-high` 等）的 Design Tokens；
  - 统一使用 `.nss-module-box`（实体外框）与 `.cbi-section-title`（浅底色摘要栏），实现明暗双模无缝咬合。

---

## 三、 SPA 单容器架构与生命周期调度 (Single Page Architecture)

### 1. 架构对比：多路由跳转 vs SPA 单容器
- **原多路由方案（产生页面刷新的根因）**：
  LuCI 将每个功能注册为独立的 URL view。在顶部导航切换时，LuCI 路由执行 view 卸载与重构，导致整页重新渲染、置顶常驻栏被销毁重建、出现视口闪烁与滚动条丢失。
- **SPA 单容器方案（零整页刷新）**：
  统一在 `nss_dashboard/main.js` 入口渲染：
  1. **顶置常驻遥测总线状态栏 (Sticky Telemetry Bar)**：挂载于最顶端，独立运行 5s 周期物理心跳与温度轮询，切换任何子卡均绝不销毁；
  2. **二级子卡选项卡 (Sub-Tabs)**：横向排列 `状态总览`、`控制与防御`、`端口线速`、`硬件流表`；
  3. **子卡内容挂载区 (Sub-Card Container)**：点击选项卡仅在内存中做 DOM 切换，切换延迟 0ms。

### 2. 按需轮询与资源防御
- **按需唤醒**：仅在切入【端口线速】时触发 4s 的 ubus 端口并发采样；仅在切入【硬件流表】时触发 3s 的流表拉取；
- **休眠机制**：离开对应子卡时，高频轮询自动注销或休眠，后台仅保留 5s 的微开销遥测总线心跳，杜绝后台 CPU 浪费。
