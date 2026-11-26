# luci-app-nss-dashboard 精简重构规划

> 基线：`nss-edma-julius` 分支，`757f43f0` + 工作区 P0 改动（未提交，−18 行）。
> 本文只写"怎么做"：阶段、步骤、代码骨架、验收口径、风险和回滚。行号是 P0 之后工作区的编号，仅供定位，实际以函数名/类名为准。

## 现在就从这里开始

1. 先做 **P1 的 spike**（30 分钟）：确认 `require view.<x>.<y> as z` 的路径与方法调用方式、`poll.remove` 是否存在。这三件事决定 P1/P3 怎么写，别跳过。
2. spike 通过后按 **P1 → P2 → P3 → P4 → P5** 顺序做，每阶段一个 commit，每次 scp 上设备过一遍 [5.2 清单](#52-设备端手工回归每阶段都跑一遍)。
3. **P4 之前不要碰 CSS**：它是唯一有视觉风险的阶段，排在所有逻辑重构之后，出问题时能立刻排除"是不是逻辑改坏的"。
4. 需要我直接开工，说"做 P1"即可；我可以先把 `lib/util.js` + `lib/chips.js` 写出来给你 review，再动 `main.js`。

---

## 目录

1. [现状基线](#1-现状基线)
2. [目标与不变量](#2-目标与不变量)
3. [七个设计决策](#3-七个设计决策)
4. [阶段计划 P0–P6](#4-阶段计划)
5. [每阶段验收清单](#5-验收清单)
6. [提交切分建议](#6-提交切分建议)
7. [非目标](#7-非目标)
8. [风险登记表](#8-风险登记表)
9. [附录](#9-附录)

---

## 1. 现状基线

### 1.1 文件与体量

| 文件 | 总行 | 非空行 | 说明 |
|---|---:|---:|---|
| `view/nss_dashboard/main.js` | 2977 | 2702 | SPA 主视图，一切逻辑都在这 |
| `view/status/include/12_nss.js` | 300 | 267 | 状态"概览"页的插槽卡片 |
| `view/nss_dashboard/nss.css` | 577 | 505 | 含 133 个 `!important` |
| `usr/libexec/rpcd/luci.nss_dashboard` | 418 | 400 | 8 个 ubus 方法 |
| `etc/uci-defaults/98-nss-dashboard-profile` | 166 | ~150 | 首启探测 + 写 `/tmp/nss_profile.json` |
| `Makefile` / menu.d / acl.d / po | 42 / 9 / 15 / 7 | | 纯打包 |

### 1.2 复杂度指标（实测）

| 指标 | 数值 |
|---|---:|
| `E()` 调用 | 485 |
| 内联 `style` 属性 | 223 处 / 127 种不同取值 |
| `_()` 翻译调用 | main 284 + slot 32 |
| `querySelector` | 40 |
| `addEventListener` | 6（含 4 个全局监听） |
| CSS 规则块 / `!important` | 75 / 133（约每 4 行就有 1 个 `!important`） |
| CSS 类被 JS 引用 | 45 个全部有引用（无死类，P0 已清完） |
| 自动化测试 | 0 |

### 1.3 函数地图（main.js，行号 = 当前工作区）

| 区块 | 行 | 行数 |
|---|---|---:|
| 头部 `require` + RPC 声明 + 全局状态 | 1–54 | 54 |
| 工具函数（IP/会话/轮询档位/滚动/剪贴板） | 55–228 | 174 |
| `renderItemExpandPanel` | 229–418 | 190 |
| CSS 装载 + 计量条 + 徽章工厂 | 419–667 | 249 |
| `renderStickyBar`（顶部三仓） | 668–876 | 209 |
| `renderConflictBanner` | 877–896 | 20 |
| `renderStatusCard` | 897–1128 | 232 |
| `renderControlCard` | 1129–1266 | 138 |
| `fetchPortStats` + `renderPortsCard` | 1267–1374 | 108 |
| 表格原语 + 列定义 + 格式化 | 1375–1681 | 307 |
| `processFlowsData` | 1682–1922 | 241 |
| 行渲染器 + keyed patch | 1923–2139 | 217 |
| `renderFlowsCard` | 2140–2359 | 220 |
| `updateFlowsTable` | 2360–2414 | 55 |
| `renderAuditRankBars` + `renderAuditCard` | 2415–2619 | 205 |
| `view.extend`（load/render/tabs/poll） | 2620–2977 | 358 |

### 1.4 已知重复（精确配对）

| 重复内容 | 位置 A | 位置 B | 行数 |
|---|---|---|---:|
| `ensureCss` | main 419–435 | slot 12–25 | 17 |
| `progressbar` | main 498–528 | slot 27–57 | 31 |
| `hostCpuProgressbar` | main 529–549 | slot 59–78 | 21 |
| `moduleChip` | main 645–667 | slot 92–113 | 23 |
| `tempBadge` | main 632–644 | slot 115–127 | 13 |
| CPU tick 差分 | main 438–474 | slot 195–215 | 21 |
| SoC/主频/FW/掩码回落逻辑 | main 668–681 | main 897–913 / slot 145–151 | 4 份 |
| 拉 flows + hostHints + 写熔断标记 | main 2796–2806 | main 2834–2848 / 2881–2910 | 3 份 |
| 滚动位置保存/恢复 | main 2785/2810 | 2899–2902 / 2918–2923 | 3 份 |
| 空表占位行 | 5 处 | | ~15 |
| 列宽 `width:NNNpx` | `th` 与每个 `td` 都写一遍 | | ~40 |

---

## 2. 目标与不变量

**目标**：前端 JS 3277 行 → 约 2600 行、CSS 577 → 约 450 行（整体约 **−21%**）；`main.js` 从 2977 行的"什么都在这"变成编排层（若做模块拆分可降到 ~350 行）；CSS `!important` 133 → 0，规则数从 75 降到 ~55；后端探测逻辑从两套变一套；顶部/状态页/概览插槽三份重复取值逻辑变成一份。

**不变量（每个阶段都必须满足）**：

1. **视觉零变化**：同一主题、同一窗口宽度下，逐像素一致。
2. **RPC 契约不变**：ubus 方法名、参数顺序、返回 JSON 字段全部不动（附录 A）。
3. **无需重建固件**：改完直接 scp 前端文件即可测；shell 改动同样可直接覆盖。
4. **无构建步骤**：LuCI 直接加载源文件，不引入打包器。
5. **ES5**：沿用现有 `var` / `function`，不用箭头函数、`let`、模板串。
6. **可单阶段回滚**：每个阶段一个 commit，出问题 `git revert` 单个提交即可。

---

## 3. 七个设计决策

### D1 模块化：拆文件必须同时合并逻辑

只拆文件不减行数，反而增加 `require` 样板。本规划里"拆"和"合"绑定进行：先把重复实现合并成唯一一份，再按职责放到 `lib/`，否则不做。

**否决**：单纯把 2977 行切成 6 个 500 行文件。

### D2 DataTable：配置驱动，一次定义两处消费

现状四张表（flows 客户端聚合 / flows 明细 / audit / ports）各自手写 `thead` + `tbody` + patch + 排序 + 过滤，列宽写三遍（`th`、每个 `td`、有时还有 CSS）。

改成一份列定义，`th` 与 `td` 同源，排序/过滤/patch 由列自己声明：

```js
// lib/datatable.js
'use strict';
'require baseclass';
'require dom';

return baseclass.extend({
	// cfg = {
	//   id, cols, rows, keyOf, state: { key, dir },
	//   emptyText, colSpan, filters: { key: '' },
	//   onState: fn, expand: { colSpan, render(row), isOpen(row), key(row) }
	// }
	create: function(cfg) { ... return { head, body, table, wrap, update(rows) }; }
});
```

列定义：

```js
function rateCell(f) {
	return [ E('strong', {}, [ fmtRate(f.bps) ]) ];
}

{ key: 'rate', title: _('实时速率'), width: '108px', num: true, sort: true,
  filter: function(f, q) { return fmtRate(f.bps).toLowerCase().indexOf(q) !== -1; },
  get:   function(f) { return f.bps || 0; },     // 排序键
  cell:  rateCell,
  // patch 默认就是 dom.content(td, cell(row))；想省重排时才自定义，且必须复用同一个 cell
  patch: function(td, f) { dom.content(td, rateCell(f)); } }
```

关键收益：`patchClientRows`(63) / `patchFlowRows`(18) / `updateFlowsTable`(55) 里所有 `row.querySelector('[data-col="xxx"]')` 全部消失，因为 patch 由列负责。

**宽度只写在 `th`**：`.nss-fixed-table { table-layout: fixed !important; }` 已存在（nss.css 285–287），`table-layout:fixed` 下列宽由首行决定，`td` 上的 `width` 是冗余的 —— 删掉约 40 处内联宽度。

**否决**：继续用 `data-col` + 手写 patch（现状就是它导致了 40 个 querySelector）。

### D3 子页：用注册表代替两份 if 链

现状 `renderActiveCard()`（2813–2871）和 `forceUpdate()`（2876–2926）各自写一遍 `activeTab` 分支，加起来的逻辑必须手工保持同步。

```js
var TABS = [
	{ id: 'status',  label: _('状态总览'), load: null,
	  render: function() { return renderStatusCard(metricsData, p); } },
	{ id: 'ports',   label: _('端口线速'),
	  load: function() { return callGetPorts().then(fetchPortStats).then(function(d){ portsData = d; }); },
	  render: function() { return renderPortsCard(portsData); },
	  saveScroll: 'ports-scroll-wrap' },
	{ id: 'flows',   label: _('硬件流表'),
	  load: function() { return loadFlows(); },            // 唯一的拉取点
	  render: function() { return renderFlowsCard(...); },
	  incremental: true, saveScroll: 'flows-scroll-wrap' },
	...
];

function loadTab(tab) { return tab.load ? tab.load() : Promise.resolve(); }
function renderTab(tab) { return tab.render(); }
```

`forceUpdate` 退化为：`Promise.all([callGetMetrics(), loadTab(cur)]).then(renderSticky + renderTab)`。

### D4 共享"数据模型"，不共享"布局"

顶部三仓的算力条目和状态页的六格卡片**布局确实不同**（24px 通栏条 vs 112px 方块），不要强行合并 DOM。共享的是取值与格式化：

```js
// lib/chips.js
buildSpec: function(d, p) {
	return {
		soc: p.soc || d.soc || 'IPQ8074',
		cores: p.cores || d.cores || 2,
		npuLabel: (cores !== 1) ? 'NPU ×2' : 'NPU ×1',
		freq: d.nss_freq || p.nss_freq || '1478.4 MHz',
		fwShort: rawFw.replace(/^NSS\.(FW\.)?/, ''),
		fwMask: p.fw_mask || d.fw_mask || '0x36',
		heartbeat: Number(d.heartbeat || 0),
		temp: parseFloat(d.cpu_temp) || 0,
		conns: (d.ecm_total != null) ? d.ecm_total : 0
	};
}
```

`renderStickyBar`、`renderStatusCard`、`12_nss.js` 三处都改成 `var s = chips.buildSpec(d, p)`，回落逻辑只有一份。预计三处共省 ~45 行，但更重要的是消除"三处默认值不一致"这类隐性 bug（现状三处默认值已经不完全一样）。

### D5 计量条：一个组件 + 参数

现状四个实现：`progressbar`(31) / `hostCpuProgressbar`(21) / `miniCpuStackedBlock`(28) / `miniBarBlock`(38)，共 118 行，其中 `miniBarBlock` 内部又调用 `progressbar`。

合并为：

```js
chip.bar({ label: 'C0', value: 42, max: 100, size: 12, disabledText: _('待机'), title: ... })
chip.stack({ usr: 12, sys: 8, sirq: 3, size: 14 })   // CPU 三段堆叠
```

`size` 保留 12/14px 差异（顶部三仓与状态页确实不同），**不要**统一。

### D6 i18n：二选一，不要维持现状

现状 316 处 `_()`，`po/zh_Hans/nss-dashboard.po` 只有 7 条 msgid 且全是旧版字符串（`"Status"`、`"Controls"`…），当前源码里的中文串一条都没覆盖 —— 等于全部空转。

| 方案 | 工作量 | 结果 |
|---|---|---|
| **A. 去掉 `_()`，保留英文 msgid**（推荐，个人固件） | 机械替换 316 处 | 行数不变，行长变短，去掉一个维护负担 |
| B. 补全 po（285 条） | 半天翻译 | 真正可翻译，但每个新字符串都要维护 |
| C. 维持现状 | 0 | 半成品，后续每个 PR 都要问"这条要不要进 po" |

**建议 A**，并把菜单标题与 `12_nss.js` 的 `title` 一起改成中文常量。注意：菜单标题走 `.lmo` 翻译，删 po 前要把 `menu.d` 的 `"NSS Dashboard"` 改成中文，否则菜单会变英文。

### D7 CSS：作用域 + 特异性，不靠 `!important`

现在的 `!important` 是"和主题打架"的产物，共 133 处。正确做法是把自己所有选择器收在 `.nss-dashboard-spa` 下（`12_nss.js` 用 `.nss-status-table` 包一层），靠**多一级类选择器**赢过主题的 `.badge` / `.table`，而不是靠 `!important`。

必须保留的坑（写进不变量，否则主题样式会回来咬人）：

- `#nss-sticky-telemetry-bar` 和 `#nss-status-table` 的 **id 不能删**。Footstrap 之类主题用 `.cbi-section:not([id])` 给无 id 的区块加内边距，删 id 会多出一圈 padding。
- `.fit-unit` 的 `height/min-height` 需要压住主题按钮高度，改作用域后要重新验证三仓对齐。

---

## 4. 阶段计划

### P0 死代码清理（已完成，未提交）

| 项 | 位置 | 行数 |
|---|---|---:|
| 删除未使用的 `callGetStatus` RPC 声明 | main.js 18–21 | −5 |
| 删除无引用的 `.badge-tile-102` 规则 | nss.css 264–275 | −13 |

验收：全仓库 grep 无引用；wrapped `node --check` 通过；CSS 花括号 74/74。**视觉零风险**（删的都是没被任何元素使用的规则）。

---

### P1 抽共享内核 `lib/util.js` + `lib/chips.js`

**前置 spike（必须做，30 分钟）**
LuCI 的客户端 `require` 语义本仓库里没有源码可查，先用一个探针确认三件事，再动 500 行代码：

```js
// view/nss_dashboard/lib/probe.js
'use strict';
'require baseclass';
return baseclass.extend({ ping: function() { return 'pong'; } });
```

```js
// main.js 顶部临时加
'require view.nss_dashboard.lib.probe as probe';
// render 里临时加
console.log('probe:', probe.ping(), 'poll.remove:', typeof poll.remove);
```

要确认：
1. `require view.nss_dashboard.lib.probe as probe` 能加载到（点路径 → 文件路径）。
2. 方法是直接 `probe.ping()` 调用（上游 `tools/fs.js`、`tools/widgets.js` 就是这个用法），还是要 `new probe()`。
3. 这个 LuCI 版本的 `poll` 有没有 `remove`（P3 要用）。

**步骤**

1. 建 `lib/util.js`，移入：`normIp`、`compressIPv6`、`isPrivateIp`、`getSessionData`、`setSessionData`、`fmtRate`、`fmtPps`、`formatEndpoint` + `WELL_KNOWN_PORTS`、`copyTextToClipboard`、`makeScrollWrapAttrs`、`ensureCss`，并新增 `preserveScroll(id, fn)`：
   ```js
   preserveScroll: function(sel, parent, fn) {
       var old = parent.querySelector(sel);
       var left = old ? old.scrollLeft : 0;
       fn();
       var cur = parent.querySelector(sel);
       if (cur && left > 0) cur.scrollLeft = left;
   }
   ```
2. 建 `lib/chips.js`，移入：`calcCpuLoad`、`sampleMetricsRate`、`badge`、`tempBadge`、`moduleChip`、合并后的 `bar()` / `stack()`，以及 D4 的 `buildSpec`。
3. `main.js` 只加 2 行 `require`，调用点改成 `util.fmtRate(...)` / `chips.badge(...)`。
4. `12_nss.js` 同样 require 这两个模块，删掉自己 12–127 的 116 行副本与 195–215 的 CPU 差分。
5. `ensureCss` 在两个文件里都删掉，改成 util 里一份；`?v=` 常量抽成 `util.CSS_VERSION`（仍是硬编码，但只有一处）。

**验收**：状态总览页与大盘顶部逐像素对照（截图 diff）；`moduleChip` 在 slot 里没有 `badge-tile-112`，在 status 卡里有 —— 用参数 `{ tile: 'badge-tile-112' }` 保留，不要顺手统一。

**预算**：main.js 2977 → 2490（−487，其中 466 行只是移入 `lib/`），`12_nss.js` 300 → 196（−104，**这部分是真删除**），新增 `lib/` 466 行 → **JS 总量 3277 → 3152（净 −125）**。
**风险**：中低。唯一是 slot 与 main 的条高（14px vs 12px）与徽章是否带 tile 类，用参数化解决。
**回滚**：`git revert` 单个提交；lib 文件新增不影响旧文件。

---

### P2 配置驱动 DataTable（最大的一块）

**步骤**

1. 建 `lib/datatable.js`（约 200 行），提供：
   - `create(cfg)` → `{ head, table, body, wrap, update(rows) }`
   - `head` 内部：`renderTableHeaders` 逻辑 + 可选过滤行（列 `filter` 字段决定是否出输入框）
   - `update(rows)` 内部：排序（`sortTableItems` 逻辑）→ keyed patch（沿用现有 `patchTableRows` 的 `data-key` / `data-expand-for` 契约）→ 空表占位
   - `expand` 支持：主行点击切换、展开行紧跟主行、展开状态下 patch 不塌（现有 2059–2121 的坑要原样保留）
2. 把 `CLIENT_COLS`、`FLOW_COLS`、`AUDIT_COLS`（现在藏在 `renderAuditCard` 里，2407 行）提升为模块常量，补 `cell` / `patch` / `filter`。
3. `renderFlowsCard` 里两张手写表（2222–2245 客户端、2246–2273 明细）换成两个 `datatable.create`；子页切换只重算 `rows`。
4. 删掉 `renderClientRow`、`renderFlowRow` 里的 `td` 宽度（`table-layout:fixed` 已保证），宽度只留在列定义。
5. `renderPortsCard` 换成同一个 DataTable（6 列，无排序无过滤，`sort:false`）。
6. `renderAuditCard` 的表格部分换成 DataTable（复用 `AUDIT_COLS`），只保留"解析 nlbwmon 字段 → 行对象"的 60 行。
7. `updateFlowsTable` 整函数删除，`forceUpdate` 直接 `table.update(rows)`。

**验收**：逐列比对列宽（截图叠图）；客户端行展开 → 4s 轮询 3 轮后仍展开且数据在更新；flows 超过 100 条出现截断横幅且"显示全部"可用；排序箭头与方向正确；flows 明细页的列过滤仍然只作用于明细页。

**预算**：表格相关约 900 行 → 约 500 行（含新增 200 行内核），**净 −400**。
**风险**：中。keyed patch + 展开行是历史上出过 bug 的地方（commit `5b5413c` / `757f43f` 都在修它），必须先补一条手工回归路径：展开 → 轮询 → 排序 → 切换子页 → 再展开。
**回滚**：P2 单独一个 commit；DataTable 是新增文件，`renderXxx` 逐个替换，可以只回滚其中一张表。

---

### P3 子页注册表 + 轮询生命周期

**步骤**

1. 引入 `TABS` 数组（D3），删掉 `renderActiveCard` 与 `forceUpdate` 里的两份 `activeTab` 分支。
2. 抽出唯一的 `loadFlows()`：现在"拉 `callGetFlows` + `callGetHostHints` + 写 `sessionStorage['nss_flows_installed']`"有三份（2796–2806 / 2834–2848 / 2881–2910）。熔断标记只在一个地方写。
3. 滚动位置：三处手写 `querySelector('#xxx-scroll-wrap')` 换成 `util.preserveScroll`。
4. `poll.add(update, 1)` 改为可卸载：
   ```js
   var pollFn = update;
   poll.add(pollFn, 1);
   window._nssCleanupListeners = function() { ...; if (poll.remove) poll.remove(pollFn); };
   ```
   如果 spike 发现没有 `poll.remove`，退一步：在 `update()` 里判断 `document.getElementById('nss-subcard-mount')` 是否存在，不存在直接返回（廉价防泄漏，至少不再发 RPC）。
5. `expandedClientsMap` 在 `load()` 时清空（现在只增不减）。

**验收**：在页面内 → 离开到"网络"→ 再回来，重复 5 次，DevTools Network 里 ubus 请求频率不增长（现状会线性增长）；展开状态、排序状态、轮询档位跨页面保留符合预期。

**预算**：视图主体 358 → 约 200，**净 −158**。
**风险**：中。`poll.remove` 不可用时行为略有不同（只是不发请求，闭包仍存在），按上面的兜底处理。

---

### P4 CSS 作用域化 + 去 `!important`

**步骤**

1. 给所有根元素加 `nss-dashboard-spa`；`12_nss.js` 返回的 `<table>` 已有 `id="nss-status-table"`，用它作作用域根。
2. 把 45 个类选择器全部改写为 `.nss-dashboard-spa .badge` 形式，删除对应 `!important`（133 → 0）。
3. `.fit-unit` 一类"压主题"的规则，用 `>.badge`、`button.fit-unit` 等提高特异性替代 `!important`。
4. 合并 `.badge-tile-112` / `.badge-tile-64` 的公共声明（`justify-content`、`box-sizing`、`text-align`、`font-variant-numeric` 四项完全相同）。
5. 保留 `#nss-sticky-telemetry-bar` / `#nss-status-table` 的 id（D7 的坑）。
6. CSS 版本号 `?v=261027i` 提到 `util.CSS_VERSION`，本次改动需要同步 bump。

**验收**：主题矩阵 —— Bootstrap（Footstrap 默认）、LuCI 原生、Material，各在 1920 / 1280 / 800 / 375 四档宽度截图；重点看三仓高度对齐、`fit-unit` 按钮高度、表格首列 padding、`badge` 圆角与字号。

**预算**：577 → 约 450，`!important` 133 → 0；规则数 75 → 约 55（合并 tile 与手写布局）。
**风险**：**高**（本规划唯一的视觉风险阶段）。建议独立成一次提交，并在设备上按主题逐个过；任一主题不通过就整段回滚，不要逐条打补丁。
**回滚**：单独 commit，`git revert` 即恢复全部 `!important`。

---

### P5 后端：探测逻辑单一来源

**步骤**

1. 新建 `/lib/nss-dashboard/common.sh`，容纳：
   - `nss_detect_soc()`（现在 `uci-defaults` 里的 `compatible` 解析）
   - `nss_detect_modules()`（现在 `sample_modules()` 与 `uci-defaults` 里的两份）
   - `nss_detect_fw()`、`nss_write_profile()`（唯一写 `/tmp/nss_profile.json` 与 `/tmp/nss_profile.env` 的地方）
2. `uci-defaults` 与 rpcd 都 `. /lib/nss-dashboard/common.sh`，只保留各自职责（前者做 UCI 初始化，后者做查询）。
3. `get_status` 改用 jshn（`/usr/share/libubox/jshn.sh`）拼 JSON，删掉 `printf ... "${metrics_json#\{}"` 这种字符串拼接；同时删掉它自己那套 `grep -o` profile 解析，改为 `ensure_profile` + 读缓存。
4. `get_ports` 的 awk 保持不变（它只是读，不重复）。

**验收**：`ubus call luci.nss_dashboard getStatus | jsonfilter -e '@.soc'` 有值；`getMetrics` 连续调用 100 次无残留临时文件；`/tmp/nss_profile.json` 只由一处写入；首启（删 `/tmp/nss_profile.*` 与 `/etc/config/nss_dashboard`）后配置能重新生成。

**预算**：584 → 约 545，**净 −40**，但消除两套 schema 漂移。
**风险**：中。涉及开机流程，出问题会影响所有页面（`getStatus` 是概览页的数据源）。建议先在设备上手动 `sh /etc/uci-defaults/98-nss-dashboard-profile` 验证。

---

### P6（可选）产品层裁剪

这些不是"简化代码"，是"简化功能"，需要你拍板：

| 选项 | 收益 | 代价 |
|---|---:|---|
| `12_nss.js` 从 300 行缩成"3 个数字 + 跳转链接"卡片（~60 行） | −240 | 概览页信息量下降 |
| 删除"端口线速"子页（信息已在流表与状态页） | −150 | 少一个视角 |
| `renderItemExpandPanel`(190) 简化：去掉逐 IP 复制/反查按钮 | −80 | 少两个便利功能 |
| `getDscpMeta`(45) 简化成"名称 + 一档颜色" | −25 | DSCP 语义提示变弱 |

---

## 5. 验收清单

### 5.1 每次提交前的静态检查

```powershell
# 1. JS 语法（LuCI 文件有顶层 return，必须包一层）
$js = [IO.File]::ReadAllText('...\main.js', [Text.Encoding]::UTF8)
[IO.File]::WriteAllText("$env:TEMP\chk.js", "(function(){`n$js`n})();", [Text.Encoding]::UTF8)
node --check "$env:TEMP\chk.js"

# 2. CSS 花括号配平
$css = [IO.File]::ReadAllText('...\nss.css', [Text.Encoding]::UTF8)
($css.ToCharArray() | ? { $_ -eq '{' }).Count  # 应等于 '}'

# 3. 死符号回归
git grep -n 'callGetStatus\|badge-tile-102'
```

### 5.2 设备端手工回归（每阶段都跑一遍）

- [ ] 5 个子页首次进入都能出数据（状态/控制/端口/流表/档案）
- [ ] 子页来回切 3 轮，流表速率不归零
- [ ] 排序 ↑↓、排序箭头与方向一致
- [ ] 流表明细页的列过滤生效，切到客户端聚合不会带过去
- [ ] 客户端展开 → 等 3 个轮询周期 → 行不塌、数字在变
- [ ] 流数 > 100 时出现截断横幅，"显示全部"可展开
- [ ] 顶部三仓在 1920 / 1280 / 800 / 375 四档不塌、不横向溢出
- [ ] 强制刷新按钮：点击后变"刷新中…"并禁用，完成后恢复
- [ ] 轮询三态：4s 实时 / 保持 / 暂停；鼠标移入表格挂起、移出恢复
- [ ] 切到别的浏览器标签页 → 回来不重复叠加请求；失焦 60s 进入 24s 退避
- [ ] 控制页改主频 → 保存 → 顶部与状态页主频同步
- [ ] 端口页：10G/2.5G/1000M/未连接 四种状态显示正确
- [ ] 档案页：未装 nlbwmon 显示提示；装了显示汇总与排行
- [ ] 页面内 → 离开 → 回来 5 次，ubus 请求频率不增长（P3 后必须通过）
- [ ] 三种主题 × 深/浅色，`badge`/`table`/按钮外观一致
- [ ] 手机 375px 宽：只有表格容器内部横向滚动
- [ ] Console 无 error/warning

---

## 6. 提交切分建议

| # | 提交信息 | 内容 | 可独立部署 |
|---|---|---|---:|
| 1 | `refactor: drop dead rpc declaration and unused css tile` | P0（已完成） | ✅ |
| 2 | `refactor: extract shared util/chips, dedupe overview include` | P1 | ✅ |
| 3 | `refactor: config-driven datatable for flows/audit/ports` | P2 | ✅ |
| 4 | `refactor: tab registry, single flows loader, poll teardown` | P3 | ✅ |
| 5 | `style: scope css under dashboard, drop !important` | P4 | ✅ |
| 6 | `refactor(rpcd): single hardware probe library, jshn output` | P5 | ✅ |
| 7 | `refactor: shrink overview include to summary card`（可选） | P6 | ✅ |

每个提交都要能单独 scp 到设备验证；P4 故意放最后，因为它是唯一有视觉风险的阶段，排在所有逻辑重构之后，出问题时能确定不是逻辑引入的。

---

## 7. 非目标

- 不改 ubus/RPC 契约与 JSON 字段（`12_nss.js` 与 acld 依赖它）
- 不引入 ucode/Lua 后端重写，不改 NSS 内核驱动
- 不做响应式重设计、不换主题、不动配色
- 不引构建工具（webpack/rollup）、不转 ES6、不引 Vue/React
- 不为"看起来模块化"而拆文件（见 D1）
- 不追求 0 个 `querySelector`：`patchTableRows` 的展开行定位必须留着

---

## 8. 风险登记表

| # | 风险 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | LuCI 的 `require` 语义与预期不符 | P1 未做 spike | 页面白屏 | 30 分钟探针，先跑通再加代码 |
| R2 | 本版 LuCI 无 `poll.remove` | P3 | 无法彻底卸载轮询 | 用 DOM 存在性做兜底，退化为"不发请求" |
| R3 | `table-layout:fixed` 下删 `td` 宽度 | P2 | 列宽错位 | 宽度只保留在 `th`；四档宽度截图叠加比对 |
| R4 | 客户端展开行在 patch 时塌陷 | P2 | 交互回归 | 保留 `data-key`/`data-expand-for` 契约；手工回归路径写进 5.2 |
| R5 | 去 `!important` 后主题覆盖回来 | P4 | 视觉回归 | 三主题矩阵；出问题整段回滚 |
| R6 | 删 `#nss-sticky-telemetry-bar` id | P4 | 多出 padding | 写进不变量，禁止删 id |
| R7 | 合并 slot 与 main 的条高 | P1 | 状态页变高/变矮 | `size` 参数保留两套尺寸，逐像素对照 |
| R8 | `getStatus` jshn 改造破坏概览页 | P5 | 概览页空白 | 设备上手动跑 uci-defaults + `ubus call` 验证 |
| R9 | 删 `_()` 后菜单标题变英文 | D5 方案 A | 界面不一致 | 同步改 `menu.d` 的 title 为中文 |
| R10 | 阶段间相互依赖导致无法单测 | 全部 | 回滚变难 | 每阶段独立 commit，P4 放最后 |

---

## 9. 附录

### A. RPC 契约（不得变更）

| 方法 | 参数 | 主要返回字段 | 消费方 |
|---|---|---|---|
| `luci.nss_dashboard.getProfile` | — | `soc` `cores` `fw_version` `fw_mask` `nss_freq` `sqm` `modules{}` `router{}`（**每次现取**：router 的 hostname/ips 为实时值，开机档案只作兜底） | main `load()` |
| `getMetrics` | — | `nss_bytes` `cpu_ticks[8]` `core0_load` `core1_load` `cpu_temp` `radios[]` `heartbeat` `ecm_total` `ecm_v4/v6/tcp/udp/other` `conflict_detected` `modules{}`（30s 服务端缓存） | main + `sampleMetricsRate` |
| `getStatus` | — | `getProfile` 字段 + `getMetrics` 字段的合并 | `12_nss.js` |
| `getPorts` | — | `ports[]`：`ifnum` `netdev` `started` `carrier` `speed` `tx/rx_bytes` `tx/rx_host_pkts` `tx/rx_total` `tx/rx_offloaded` `tx/rx_offload_pct` | `fetchPortStats` → 端口页 |
| `getFlows` | — | `installed` `data[]`（10 元组）；**不再返回 `router`**（路由器地址池改由 getProfile 提供，消除每 4s 的 `ip` fork） | `processFlowsData` |
| `getAudit` | — | `installed` `audit.columns[]` `audit.data[][]` | `renderAuditCard` |
| `getSettings` / `setSettings` | 4 个标量 | `enabled` `crypto` `frequency` `auto_block` | 控制页 |
| `network.device.status` | `name` | `up` `carrier` `speed` `statistics` | `fetchPortStats` |
| `luci-rpc.getHostHints` | — | `{mac: {name, ipaddrs[], ip6addrs[]}}` | 流表/档案 |

流元组：`[family(4|6), proto, srcIp, srcPort, dstIp, dstPort, pkts, bytes, mark, state]`。

### B. `processFlowsData` 输出（表格重构后仍需保持）

```
{ isInstalled, rawFlows[], normalizedFlows[], clientsList[], hostnames{}, ipToDevice{},
  totalPkts, totalBytes, globalRateBps, globalPps, tcpCount, udpCount, v4Count, v6Count }
```

`clientsList[]` 每项：`key, mac, hostName, ip, isDevice, isRouter, v6Count, ipv4List[], ipv6List[], totalPkts, totalBytes, totalBps, flowCount, protos{}`。
`normalizedFlows[]` 每项：`key, proto, family, srcRaw, sport, src, dstRaw, dport, dst, pkts, bytes, mark, state, dscpMeta{}, bps, pps`。

### C. CSS 类清单（45 个，按用途分组）

| 组 | 类 |
|---|---|
| 三仓布局 | `three-bay-fixed` `bay-card` `bay-title-bar` `bay-grid-content` `bay-divider-right` `control-bay` `control-panel-fixed` `control-summary-row` |
| 计量单元 | `fit-unit` `fit-unit-bar` `fit-bar-label` `nss-bar` `nss-bar-fill` `nss-bar-warn` `nss-bar-danger` `nss-bar-disabled` `nss-stacked` `nss-grid-3x112` `nss-load-box-348` |
| 徽章 | `badge` `badge-dot` `badge-neutral/info/success/warning/danger` `badge-tile-112` `badge-tile-64` `tcp-proto-badge` `tcp-badge-5char` |
| 表格 | `nss-fixed-table` `nss-num-cell` `nss-scroll-proxy` `table-titles` `tr-empty-placeholder` `client-main-row` `client-expand-row` `client-trigger-box` `client-expand-badge` |
| 其它 | `ip-action-btn` `nss-notice-banner` `nss-status-label` `nss-status-table` `nss-audit-rank-box` `nss-rank-row` `nss-rank-name` `nss-rank-bar` `nss-rank-val` `th-hint` `left/right` (LuCI 原生) |

### D. 内联样式高频模式 → 工具类映射（P4 用）

| 高频写法 | 次数 | 替代 |
|---|---:|---|
| `display:flex; align-items:center; gap:6px`（及 gap 3/4/8） | ~40 | `.nss-row` `.nss-row-3` `.nss-row-4` `.nss-row-8` |
| `width:NNNpx`（`td`/`th`） | ~40 | 只写 `th`（`table-layout:fixed`），或列定义 |
| `font-size:10px/11px/12px` | ~35 | `.nss-fs10` `.nss-fs11` `.nss-fs12` |
| `color:var(--text-color-medium)` | ~25 | `.nss-muted` |
| `font-weight:600/700; color:var(--primary-color-high)` | ~20 | `.nss-strong` `.nss-accent` |
| `white-space:nowrap` | ~12 | `.nss-nowrap` |
| `margin-top:4px/6px/8px` | ~15 | `.nss-mt4` `.nss-mt6` `.nss-mt8` |

> 这段不要机械替换：只替换出现 ≥5 次的模式，其余留在原处，避免为了"消灭内联样式"制造 60 个只用一次的工具类 —— 那是把 127 种内联值换成 60 个类，没简化。

### E. 行数预算汇总

| 项目 | 现在 | P1 后 | P2 后 | P3 后 | P4 后 | 备注 |
|---|---:|---:|---:|---:|---:|---|
| `main.js` | 2977 | ~2490 | ~1890 | ~1736 | ~1736 | P6 可再降 |
| `lib/*.js` | 0 | ~466 | ~666 | ~666 | ~666 | 新增（内含移来的代码） |
| `12_nss.js` | 300 | ~196 | ~196 | ~196 | ~196 | P6 可到 ~60 |
| JS 合计 | 3277 | ~3152 | ~2752 | ~2596 | ~2596 | 净 −20.8% |
| `nss.css` | 577 | 577 | 577 | 577 | ~450 | `!important` 133→0 |
| **前端合计** | **3854** | **~3729** | **~3329** | **~3173** | **~3046** | **−21%** |
| 若再做模块拆分（纯移动，总行数不变） | | | | | `main.js ≈ 350 + 8 个模块` | 仅可读性收益 |

> 说明：行数不是这次的主要收益（P1 有一半只是"搬家"）。真正的收益是四个结构问题被消除：跨文件重复实现（1.4 表）、双份 `activeTab` 状态机、四张手写表、两套 shell 探测。若目标是让 `main.js` 从 2977 行变成 350 行，必须做最后一步"按职责拆文件" —— 它不减总行数，但决定以后还能不能改。

### F. 时间估算（按一个人、每步都在设备上验一遍）

| 阶段 | 纯写码 | 设备验证 | 合计 |
|---|---|---|---|
| P0 | 10 分钟 | 5 分钟 | 已完成 |
| P1 + spike | 3 小时 | 1 小时 | 半天 |
| P2 | 6 小时 | 2 小时 | 1 天 |
| P3 | 3 小时 | 1 小时 | 半天 |
| P4 | 4 小时 | 3 小时（三主题） | 1 天 |
| P5 | 3 小时 | 1 小时 | 半天 |
| P6（可选） | 2 小时 | 1 小时 | 半天 |

---

## 10. 待你拍板的三件事

1. **i18n 走 A 还是 B**（去 `_()` / 补 285 条 po）。影响 P1 的收尾方式，但不影响 P2–P5。
2. **要不要做模块拆分**（`main.js` 3000 → 350 + 若干模块）。不减总行数，只影响可维护性；不做的话 P1 只抽 `lib/` 两个文件、`main.js` 仍有 ~2000 行。
3. **P6 是否砍功能**（概览插槽缩卡片 / 删端口页 / 简化展开面板）。
