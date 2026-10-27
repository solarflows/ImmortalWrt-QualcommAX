'use strict';
'require view';
'require rpc';
'require poll';
'require dom';
'require ui';
'require view.nss_dashboard.lib.util as util';
'require view.nss_dashboard.lib.chips as chips';

var callGetProfile = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getProfile'
});

var callGetMetrics = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getMetrics'
});

var callGetSettings = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getSettings'
});

var callSetSettings = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'setSettings',
	params: [ 'enabled', 'crypto', 'frequency', 'auto_block' ]
});

var callGetPorts = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getPorts'
});

var callGetFlows = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getFlows'
});

var callDeviceStatus = rpc.declare({
	object: 'network.device',
	method: 'status',
	params: [ 'name' ]
});

var callHostHints = rpc.declare({
	object: 'luci-rpc',
	method: 'getHostHints'
});

var callGetAudit = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getAudit'
});

var normIp = util.normIp.bind(util);
var compressIPv6 = util.compressIPv6.bind(util);
var getSessionData = util.getSessionData.bind(util);
var setSessionData = util.setSessionData.bind(util);
var isPrivateIp = util.isPrivateIp.bind(util);

var isResolvingHints = false;
var lastHintProbeTime = 0;

var staticProfile = null;
var activeTab = 'status'; // 'status' | 'control' | 'ports' | 'flows' | 'audit'
var flowSubTab = 'clients'; // 'clients' | 'all' | 'ipv4' | 'ipv6'
var showAllFlows = false;
var MAX_FLOWS_RENDER = 100;
var clientSortKey = 'flowCount';
var clientSortDir = -1; // -1 = desc, 1 = asc
var flowSortKey = 'pkts';
var flowSortDir = -1; // -1 = desc, 1 = asc
var auditSortKey = 'total';
var auditSortDir = -1; // -1 = desc, 1 = asc
var pollMode = getSessionData('nss_poll_mode') || 'auto'; // 'auto' | 'keep' | 'paused'
var isTableHovered = false;
var isPageVisible = !document.hidden;
var isRefreshing = false;
var expandedClientsMap = {}; // 记录条目级展开状态: { clientKey: true }
var lastUserActionTime = Date.now();
var isIdleBackoff = false;
var IDLE_TIMEOUT_MS = 60000; // 60秒无操作进入挂机退避
var POLL_NORMAL_INTERVAL = 4; // 活跃轮询 4s
var POLL_IDLE_INTERVAL = 24; // 挂机退避拉长为 24s

function cyclePollMode(onRefreshToggle) {
	if (pollMode === 'auto') {
		pollMode = 'keep';
		isIdleBackoff = false;
	} else if (pollMode === 'keep') {
		pollMode = 'paused';
	} else {
		pollMode = 'auto';
		isIdleBackoff = false;
		lastUserActionTime = Date.now();
	}
	setSessionData('nss_poll_mode', pollMode);
	if (onRefreshToggle) onRefreshToggle();
}

function makeScrollWrapAttrs(id, onRefreshToggle) {
	return util.makeScrollWrapAttrs(id, function(hovered) {
		isTableHovered = hovered;
		if (onRefreshToggle) onRefreshToggle();
	});
}

var copyTextToClipboard = util.copyTextToClipboard.bind(util);

function traceFlowByIp(targetIp) {
	if (!targetIp) return;
	flowColFilters['src'] = targetIp.toLowerCase();
	activeTab = 'flows';
	flowSubTab = 'all';
	window.location.hash = 'flows';
	var tabMenu = document.querySelector('.nss-dashboard-spa > .cbi-section > .cbi-tabmenu');
	var flowsTabLink = tabMenu ? tabMenu.querySelector('a[href="#flows"]') : null;
	if (flowsTabLink) {
		flowsTabLink.click();
	} else {
		renderSubTabs();
		renderActiveCard();
	}
}

function renderItemExpandPanel(clientObj, onToggle) {
	var ipv4List = clientObj.ipv4List || [];
	var ipv6List = clientObj.ipv6List || [];
	var allIps = [].concat(ipv4List, ipv6List.map(compressIPv6)).filter(Boolean);
	var allIpsText = allIps.join('\n');

	// 1. 顶部 Header 栏 (主机名、MAC、类型、操作按钮)
	var macDisplay = clientObj.mac ? clientObj.mac.toUpperCase() : (clientObj.isDevice ? _('虚拟/本地总线') : _('未知 MAC'));
	var headerBar = E('div', {
		'style': 'display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; border-bottom: 1px dashed var(--border-color-medium, rgba(255,255,255,0.1)); padding-bottom: 6px;'
	}, [
		E('div', { 'style': 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;' }, [
			E('span', { 'style': 'font-size: 11px; color: var(--text-color-medium);' }, [ 'MAC: ' ]),
			E('code', { 'style': 'font-size: 11px; padding: 1px 5px; background: var(--background-color-low, rgba(0,0,0,0.2)); border-radius: 3px;' }, [ macDisplay ]),
			clientObj.isRouter ? E('span', { 'class': 'badge badge-info' }, [ _('路由器本机') ]) : ''
		]),
		E('div', { 'style': 'display: flex; gap: 6px; align-items: center;' }, [
			E('button', {
				'class': 'ip-action-btn',
				'style': 'font-weight: 600; color: var(--primary-color-high);',
				'title': _('复制该客户端拥有的全部 IP 地址'),
				'click': function(ev) {
					ev.stopPropagation();
					copyTextToClipboard(allIpsText, this, _('全部已复制'));
				}
			}, [ '📋 ' + _('复制全部 IP') ]),
			E('button', {
				'class': 'ip-action-btn',
				'title': _('收起此客户端的详细地址行'),
				'click': function(ev) {
					ev.stopPropagation();
					if (onToggle) onToggle();
				}
			}, [ '▲ ' + _('收起') ])
		])
	]);

	// 2. 指标徽章条 (自适应实时流表聚合与历史流量审计)
	var metricsItems;
	if (clientObj.totalBytes != null) {
		var protoList = Object.keys(clientObj.protos || {}).sort().join(', ') || 'TCP/UDP';
		metricsItems = [
			E('div', { 'style': 'display: inline-flex; align-items: center; gap: 4px;' }, [
				E('span', { 'style': 'color: var(--text-color-medium);' }, [ _('硬件流量:') ]),
				E('strong', { 'style': 'color: var(--text-color-high);' }, [ String.format('%1024.1mB', clientObj.totalBytes || 0) ]),
				E('span', { 'style': 'color: var(--text-color-medium); font-size: 10px;' }, [ '(' + (clientObj.totalPkts || 0).toLocaleString() + ' pkts)' ])
			]),
			E('div', { 'style': 'display: inline-flex; align-items: center; gap: 4px;' }, [
				E('span', { 'style': 'color: var(--text-color-medium);' }, [ _('实时速率:') ]),
				E('strong', { 'style': (clientObj.totalBps > 1e6) ? 'color: var(--primary-color-high);' : 'color: var(--text-color-high); font-variant-numeric: tabular-nums;' }, [
					(clientObj.totalBps > 0) ? fmtRate(clientObj.totalBps) : '—'
				])
			]),
			E('div', { 'style': 'display: inline-flex; align-items: center; gap: 4px;' }, [
				E('span', { 'style': 'color: var(--text-color-medium);' }, [ _('活跃连接:') ]),
				E('strong', { 'style': 'color: var(--text-color-high);' }, [ (clientObj.flowCount || 0) + ' ' + _('条并发') ])
			]),
			E('div', { 'style': 'display: inline-flex; align-items: center; gap: 4px;' }, [
				E('span', { 'style': 'color: var(--text-color-medium);' }, [ _('协议分布:') ]),
				E('strong', { 'style': 'color: var(--text-color-high);' }, [ protoList ])
			])
		];
	} else {
		metricsItems = [
			E('div', { 'style': 'display: inline-flex; align-items: center; gap: 4px;' }, [
				E('span', { 'style': 'color: var(--text-color-medium);' }, [ _('历史总流量:') ]),
				E('strong', { 'style': 'color: var(--primary-color-high);' }, [ String.format('%1024.1mB', clientObj.total || 0) ])
			]),
			E('div', { 'style': 'display: inline-flex; align-items: center; gap: 4px;' }, [
				E('span', { 'style': 'color: var(--text-color-medium);' }, [ _('下行 / 上行:') ]),
				E('strong', { 'style': 'color: var(--text-color-high);' }, [
					String.format('%1024.1mB', clientObj.rx || 0) + ' / ' + String.format('%1024.1mB', clientObj.tx || 0)
				])
			]),
			E('div', { 'style': 'display: inline-flex; align-items: center; gap: 4px;' }, [
				E('span', { 'style': 'color: var(--text-color-medium);' }, [ _('记录会话数:') ]),
				E('strong', { 'style': 'color: var(--text-color-high);' }, [ (clientObj.conns || 0).toLocaleString() + ' ' + _('条') ])
			])
		];
	}
	var metricsBar = E('div', {
		'style': 'display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 11px; padding: 6px 10px; background: var(--background-color-medium, rgba(255,255,255,0.04)); border: 1px solid var(--border-color-low, rgba(255,255,255,0.06)); border-radius: 4px;'
	}, metricsItems);

	// 3. IPv4 地址池区域
	var v4Section = null;
	if (ipv4List.length > 0) {
		var v4Items = ipv4List.map(function(ip) {
			var note = (ip === '127.0.0.1') ? 'Loopback' : (ip.indexOf('100.') === 0) ? 'WAN' : (ip === clientObj.ip ? _('主IP') : '');
			var noteBadge = note ? E('span', {
				'class': 'badge ' + (note === _('主IP') ? 'badge-info' : 'badge-neutral'),
				'style': 'font-size: 9px; padding: 0 4px; line-height: 14px; height: 14px;'
			}, [ note ]) : '';

			return E('div', {
				'style': 'display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px; background: var(--background-color-medium, rgba(255,255,255,0.05)); border: 1px solid var(--border-color-low, rgba(255,255,255,0.08)); border-radius: 4px; min-width: 190px;'
			}, [
				E('div', { 'style': 'display: inline-flex; align-items: center; gap: 6px;' }, [
					E('code', { 'style': 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 500;' }, [ ip ]),
					noteBadge
				]),
				E('div', { 'style': 'display: inline-flex; gap: 3px;' }, [
					E('button', {
						'class': 'ip-action-btn',
						'title': _('复制此 IPv4 地址: ') + ip,
						'click': function(ev) {
							ev.stopPropagation();
							copyTextToClipboard(ip, this, 'OK');
						}
					}, [ '📋' ]),
					E('button', {
						'class': 'ip-action-btn',
						'title': _('在流表中查寻此 IP 流量: ') + ip,
						'click': function(ev) {
							ev.stopPropagation();
							traceFlowByIp(ip);
						}
					}, [ '🎯' ])
				])
			]);
		});
		v4Section = E('div', { 'style': 'display: flex; flex-direction: column; gap: 5px;' }, [
			E('div', { 'style': 'font-size: 11px; font-weight: 700; color: var(--text-color-medium); display: flex; align-items: center; gap: 6px;' }, [
				E('span', { 'class': 'badge-dot', 'style': 'width:5px; height:5px; background:var(--primary-color-high);' }),
				_('IPv4 地址池 (%d 个):').format(ipv4List.length)
			]),
			E('div', { 'style': 'display: flex; flex-wrap: wrap; gap: 6px;' }, v4Items)
		]);
	}

	// 4. IPv6 地址池区域
	var v6Section = null;
	if (ipv6List.length > 0) {
		var v6Grid = E('div', { 'style': 'display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 6px;' });
		ipv6List.forEach(function(ip6) {
			var norm = compressIPv6(ip6);
			var note = (norm === '::1') ? 'Loopback' : (ip6.indexOf('fe80:') === 0) ? 'Link-Local' : '';
			var noteBadge = note ? E('span', {
				'class': 'badge badge-neutral',
				'style': 'font-size: 9px; padding: 0 4px; line-height: 14px; height: 14px;'
			}, [ note ]) : '';

			v6Grid.appendChild(E('div', {
				'style': 'display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px; background: var(--background-color-medium, rgba(255,255,255,0.05)); border: 1px solid var(--border-color-low, rgba(255,255,255,0.08)); border-radius: 4px;'
			}, [
				E('div', { 'style': 'display: inline-flex; align-items: center; gap: 6px; min-width: 0;' }, [
					E('code', { 'style': 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; word-break: break-all;' }, [ norm ]),
					noteBadge
				]),
				E('div', { 'style': 'display: inline-flex; gap: 3px; flex-shrink: 0;' }, [
					E('button', {
						'class': 'ip-action-btn',
						'title': _('复制此 IPv6 地址: ') + norm,
						'click': function(ev) {
							ev.stopPropagation();
							copyTextToClipboard(norm, this, 'OK');
						}
					}, [ '📋' ]),
					E('button', {
						'class': 'ip-action-btn',
						'title': _('在流表中查寻此 IP 流量: ') + norm,
						'click': function(ev) {
							ev.stopPropagation();
							traceFlowByIp(norm);
						}
					}, [ '🎯' ])
				])
			]));
		});
		v6Section = E('div', { 'style': 'display: flex; flex-direction: column; gap: 5px;' }, [
			E('div', { 'style': 'font-size: 11px; font-weight: 700; color: var(--text-color-medium); display: flex; align-items: center; gap: 6px;' }, [
				E('span', { 'class': 'badge-dot', 'style': 'width:5px; height:5px; background:var(--success-color-high);' }),
				_('IPv6 地址池 (%d 个):').format(ipv6List.length)
			]),
			v6Grid
		]);
	}

	var panel = E('div', {
		'class': 'client-tree-panel'
	}, [
		headerBar,
		metricsBar,
		v4Section,
		v6Section
	].filter(Boolean));

	return panel;
}

var ensureCss = util.ensureCss.bind(util);
var calcCpuLoad = chips.calcCpuLoad.bind(chips);
var sampleMetricsRate = chips.sampleMetricsRate.bind(chips);

function progressbar(value, max, label) {
	return chips.bar({ value: value, max: max, label: label, height: 13 });
}

function hostCpuProgressbar(total, usr, sys, sirq) {
	return chips.stack({ total: total, usr: usr, sys: sys, sirq: sirq, height: 14 });
}

function miniCpuStackedBlock(cpu) {
	var vn = parseFloat(cpu.total) || 0;
	var u = Math.max(0, parseFloat(cpu.usr) || 0);
	var s = Math.max(0, parseFloat(cpu.sys) || 0);
	var si = Math.max(0, parseFloat(cpu.sirq) || 0);
	return E('div', {
		'class': 'fit-unit fit-unit-bar',
		'title': 'CPU 总占用: ' + vn.toFixed(1) + '% (usr 用户态: ' + u.toFixed(1) + '% • sys 内核态: ' + s.toFixed(1) + '% • sirq 软中断: ' + si.toFixed(1) + '%)'
	}, [
		E('span', { 'class': 'fit-bar-label' }, [ 'CPU' ]),
		chips.stack({ total: cpu.total, usr: cpu.usr, sys: cpu.sys, sirq: cpu.sirq, compact: true, height: 14, style: 'flex:1; min-width:0;' })
	]);
}

function miniBarBlock(label, value, isCpu, disabledText, titleText) {
	return E('div', {
		'class': 'fit-unit fit-unit-bar',
		'title': titleText || (label + ': ' + (value != null ? (value + '%') : (disabledText || _('待机'))))
	}, [
		E('span', { 'class': 'fit-bar-label' }, [ label ]),
		chips.bar({ value: value, max: 100, disabledText: disabledText, title: titleText, height: 14, style: 'flex:1; min-width:0;' })
	]);
}

var badge = chips.badge.bind(chips);

function tempBadge(label, temp) {
	return chips.tempBadge(label, temp, { tile: 'badge-tile-112' });
}

function moduleChip(name, state, customLabel, customTitle) {
	return chips.moduleChip(name, state, customLabel, customTitle, { tile: 'badge-tile-112' });
}

// ── 1. 顶置常驻遥测总线状态栏 (路子 A：三仓等高对称分栏，响应式铺满无死黑) ──
function renderStickyBar(d, p, onRefreshToggle, onForceRefresh) {
	var spec = chips.buildSpec(d, p);
	var t = spec.temp;
	var tempClass = (t >= 75) ? 'badge-danger' : (t >= 60) ? 'badge-warning' : 'badge-success';
	var soc = spec.soc;
	var cores = spec.cores;
	var isDualNpu = spec.isDualNpu;
	var freqFull = spec.freq;
	var totalConns = spec.conns;

	var cpuLoad = calcCpuLoad(d ? d.cpu_ticks : null);
	var activeRateBps = (chips.nssMetricsRateBps > 0) ? chips.nssMetricsRateBps : (nssGlobalRateBps || 0);
	var throughputStr = fmtRate(activeRateBps);

	var header = document.querySelector('header');
	var navHeight = header ? header.offsetHeight : 40;

	var refreshBadge;
	if (pollMode === 'paused') {
		refreshBadge = E('span', {
			'class': 'badge badge-warning fit-unit',
			'style': 'cursor:pointer; height:24px;',
			'title': _('当前档位：已手动暂停轮询。点击切换至「4s 实时更新 (自适应)」'),
			'click': function(ev) {
				ev.stopPropagation();
				cyclePollMode(onRefreshToggle);
			}
		}, [ '⏸ ' + _('已暂停') ]);
	} else if (isTableHovered) {
		refreshBadge = E('span', {
			'class': 'badge badge-warning fit-unit',
			'style': 'cursor:pointer; height:24px;',
			'title': _('鼠标正在表格内浏览，已自动挂起刷新以防打断；移出表格自动恢复，或点击切换轮询档位'),
			'click': function(ev) {
				ev.stopPropagation();
				cyclePollMode(onRefreshToggle);
			}
		}, [ '⏸ ' + _('移入挂起') ]);
	} else if (pollMode === 'keep') {
		refreshBadge = E('span', {
			'class': 'badge badge-info fit-unit',
			'style': 'cursor:pointer; height:24px;',
			'title': _('当前档位：保持 4s 更新（常亮盯盘模式，禁用空闲退避与失焦降频）。点击切换至「暂停轮询」'),
			'click': function(ev) {
				ev.stopPropagation();
				cyclePollMode(onRefreshToggle);
			}
		}, [
			E('span', { 'class': 'badge-dot' }),
			_('保持 4s 更新')
		]);
	} else if (!isPageVisible) {
		refreshBadge = E('span', {
			'class': 'badge badge-neutral fit-unit',
			'style': 'height:24px;'
		}, [ _('后台休眠') ]);
	} else if (isIdleBackoff) {
		refreshBadge = E('span', {
			'class': 'badge badge-neutral fit-unit',
			'style': 'cursor:pointer; height:24px;',
			'title': _('当前处于挂机省电模式（24s 轮询）。移动鼠标立即唤醒，或点击切换至「保持 4s 更新 (不休眠)」'),
			'click': function(ev) {
				ev.stopPropagation();
				cyclePollMode(onRefreshToggle);
			}
		}, [ _('⏱️ 挂机省电') ]);
	} else {
		refreshBadge = E('span', {
			'class': 'badge badge-neutral fit-unit',
			'style': 'cursor:pointer; height:24px;',
			'title': _('当前档位：4s 实时更新（自适应省电）。点击切换至「保持 4s 更新 (不休眠)」'),
			'click': function(ev) {
				ev.stopPropagation();
				cyclePollMode(onRefreshToggle);
			}
		}, [
			E('span', { 'class': 'badge-dot', 'style': 'background:var(--success-color-high, #00ac59);' }),
			_('4s 实时更新')
		]);
	}

	var forceRefreshBtn = E('button', {
		'class': 'btn cbi-button cbi-button-action fit-unit',
		'id': 'btn-force-refresh',
		'style': 'height:24px !important; min-height:24px !important; max-height:24px !important; padding:0 8px !important; line-height:22px !important;',
		'disabled': isRefreshing ? 'disabled' : null,
		'title': _('跳过轮询等待，立即抓取最新遥测与当前子卡数据'),
		'click': function(ev) {
			ev.preventDefault();
			ev.stopPropagation();
			if (onForceRefresh) onForceRefresh();
		}
	}, [
		isRefreshing ? _('刷新中…') : _('强制刷新')
	]);

	// ── 仓 1: 核心算力 (Computing) ──
	var bayCompute = E('div', { 'class': 'bay-card bay-divider-right' }, [
		E('div', { 'class': 'bay-title-bar' }, [
			E('span', { 'class': 'th-hint', 'title': _('高通 SoC 硬件架构、工作主频、CPU 三态负载、芯片结温与 NPU 负载') }, [
				'⚡ ' + _('核心算力')
			]),
			E('span', { 'style': 'font-weight:400; color:var(--text-color-medium); font-size:10px;' }, [
				isDualNpu ? _('双核硬件加速') : _('单核硬件加速')
			])
		]),
		E('div', { 'class': 'bay-grid-content' }, [
			E('span', {
				'class': 'badge badge-neutral fit-unit',
				'title': _('高通网络子系统 (NSS) 硬件加速协处理器架构规格')
			}, [ E('strong', {}, [ 'SoC:' ]), soc + ' ×' + cores ]),
			E('span', {
				'class': 'badge badge-neutral fit-unit',
				'title': _('NSS 锁相环时钟频率')
			}, [ E('strong', {}, [ _('主频:') ]), freqFull ]),
			miniCpuStackedBlock(cpuLoad),
			E('span', {
				'class': 'badge ' + tempClass + ' fit-unit',
				'title': _('路由器 SoC 物理结温，来自内核热敏传感器实时监测')
			}, [ E('strong', {}, [ _('结温:') ]), t.toFixed(1) + '°C' ]),
			miniBarBlock('C0', d.core0_load || 0, false, null, 'NPU Core 0: ' + (d.core0_load || 0) + '%'),
			isDualNpu
				? ((d.core1_load !== null && d.core1_load !== undefined)
					? miniBarBlock('C1', d.core1_load, false, null, 'NPU Core 1: ' + d.core1_load + '%')
					: miniBarBlock('C1', null, false, _('待机'), _('NPU Core 1 物理待机 (无蜂窝/IPsec服务固件)')))
				: miniBarBlock('C1', null, false, _('单核'), _('当前 SoC 为单核 NPU 架构'))
		])
	]);

	// ── 仓 2: 硬件遥测 (Telemetry) ──
	var bayTelemetry = E('div', { 'class': 'bay-card bay-divider-right' }, [
		E('div', { 'class': 'bay-title-bar' }, [
			E('span', { 'class': 'th-hint', 'title': _('硬件线速吞吐速率、微码心跳、ECM 并发流数、双栈分布、直通状态与安全协同防御') }, [
				'📊 ' + _('硬件遥测')
			]),
			E('span', { 'style': 'font-weight:400; color:var(--text-color-medium); font-size:10px;' }, [
				_('ECM 硬件直通中')
			])
		]),
		E('div', { 'class': 'bay-grid-content' }, [
			E('span', {
				'class': 'badge badge-info fit-unit',
				'title': _('当前经由 NSS 硬件卸载转发的实时线速吞吐速率')
			}, [ E('strong', {}, [ _('吞吐:') ]), throughputStr ]),
			E('span', {
				'class': 'badge badge-info fit-unit',
				'title': _('NSS 协处理器微码与 Linux 驱动之间的高频心跳计数 (pkts/s)')
			}, [ E('span', { 'class': 'badge-dot' }), E('strong', {}, [ _('心跳:') ]), (d.heartbeat || 0).toLocaleString() + ' pkts/s' ]),
			E('span', {
				'class': 'badge badge-info fit-unit',
				'title': _('当前经由高通增强连接管理器 (ECM) 卸载到硬件层线速转发的活跃流总数')
			}, [ E('span', { 'class': 'badge-dot' }), E('strong', {}, [ 'ECM:' ]), totalConns.toLocaleString() + ' ' + _('流') ]),
			E('span', {
				'class': 'badge badge-neutral fit-unit',
				'title': 'IPv4: ' + (d.ecm_v4 || 0) + ' • IPv6: ' + (d.ecm_v6 || 0)
			}, [ E('strong', {}, [ 'v4/v6:' ]), (d.ecm_v4 || 0) + ' / ' + (d.ecm_v6 || 0) ]),
			E('span', {
				'class': 'badge badge-success fit-unit',
				'title': _('数据包由 NSS 硬件层线速路由与桥接，完全绕过 Linux 内核协议栈与 CPU 软中断')
			}, [ E('span', { 'class': 'badge-dot' }), _('直通加速生效') ]),
			E('span', {
				'class': 'badge ' + ((d.conflict_detected === 1) ? 'badge-danger' : 'badge-neutral') + ' fit-unit',
				'title': _('检测并阻断内核软分流 (flow_offloading) 等可能破坏 NSS ECM 硬件加速的冲突配置')
			}, [ (d.conflict_detected === 1) ? ('⚠️ ' + _('已阻断冲突项')) : ('🛡️ ' + _('冲突阻断生效')) ])
		])
	]);

	// ── 仓 3: 运行控制与流表概要 (Control) ──
	var bayControl = E('div', { 'class': 'bay-card control-bay' }, [
		E('div', { 'class': 'bay-title-bar' }, [
			E('span', { 'class': 'th-hint', 'title': _('调度周期控制、强制刷新与全网并发流汇总') }, [
				'🎛️ ' + _('运行控制')
			]),
			E('span', { 'style': 'font-weight:400; color:var(--text-color-medium); font-size:10px;' }, [
				p.fw_version ? ('FW ' + (p.fw_version || '').replace(/^NSS\.(FW\.)?/, '')) : ''
			])
		]),
		E('div', { 'class': 'control-panel-fixed' }, [
			E('div', { 'class': 'control-summary-row' }, [
				E('span', { 'style': 'color:var(--text-color-medium);' }, [ _('当前并发流:') ]),
				E('strong', { 'style': 'color:var(--text-color-high); font-variant-numeric:tabular-nums;' }, [
					totalConns.toLocaleString() + ' ' + _('条活跃流')
				])
			]),
			E('div', { 'style': 'display:grid; grid-template-columns:1fr 1fr; gap:6px;' }, [
				refreshBadge,
				forceRefreshBtn
			]),
			E('div', { 'style': 'font-size:10px; color:var(--text-color-medium); text-align:center;' }, [
				_('移入表格自动挂起 · 移出自动恢复')
			])
		])
	]);

	return E('div', {
		'id': 'nss-sticky-telemetry-bar',
		'class': 'cbi-section',
		'style': 'top:' + navHeight + 'px;'
	}, [
		E('div', { 'class': 'three-bay-fixed' }, [
			bayCompute,
			bayTelemetry,
			bayControl
		])
	]);
}

// ── 2. 冲突警告横幅 ──
function renderConflictBanner(d) {
	if (d.conflict_detected !== 1) return E('div');

	return E('div', {
		'class': 'alert-message warning',
		'style': 'margin-bottom:14px;'
	}, [
		E('strong', {}, [ '⚠️ ' + _('内核协议栈配置与 NSS 硬件加速冲突') ]),
		E('div', { 'style': 'margin-top:4px;' }, [
			_('检测到系统开启了软件流量分流 (flow_offloading=1)。数据包将被提前截获跳过 Conntrack 通知链，导致 ECM 硬件加速失效与连接撕裂。系统安全防护已自动阻断该项影响。建议手动关闭此冲突项：可直接前往'),
			E('a', {
				'href': L.url('admin/network/network'),
				'style': 'color:var(--primary-color-high); font-weight:bold; text-decoration:underline; margin-left:4px;'
			}, [ _('网络 → 接口 → 全局网络选项') ]),
			_('。')
		])
	]);
}

// ── 3. 子卡 A：状态总览 (Status) ──
function renderStatusCard(d, p) {
	var mods = (d && d.modules) ? d.modules : ((p && p.modules) ? p.modules : {});
	var spec = chips.buildSpec(d, p);
	var mods = (d && d.modules) ? d.modules : ((p && p.modules) ? p.modules : {});
	var totalConns = spec.conns;
	var isDualNpu = spec.isDualNpu;
	var npuLabel = spec.npuLabel;
	var freqVal = spec.freq;

	// 1. 协处理器与微码规格 (统一 3列 × 2行 112px 等宽卡片网格，突出 NPU 频率)
	var rawFw = spec.rawFw;
	var fwMask = spec.fwMask;
	var fwShort = spec.fwShort;
	var fwDisplay = spec.fwDisplay;
	var heartbeatNum = spec.heartbeat.toLocaleString();

	var specView = E('div', { 'class': 'nss-grid-3x112' }, [
		E('span', {
			'class': 'badge badge-neutral badge-tile-112',
			'title': _('高通网络子系统 (NSS) SoC 芯片型号')
		}, [ E('strong', {}, [ 'SoC:' ]), spec.soc ]),
		E('span', {
			'class': 'badge badge-info badge-tile-112',
			'title': _('独立硬件网络协处理器核心拓扑')
		}, [ E('strong', {}, [ _('架构:') ]), npuLabel ]),
		E('span', {
			'class': 'badge badge-success badge-tile-112',
			'title': _('当前 NSS NPU 锁相环工作主频')
		}, [ E('span', { 'class': 'badge-dot' }), E('strong', {}, [ _('主频:') ]), freqVal ]),
		E('span', {
			'class': 'badge badge-neutral badge-tile-112',
			'title': _('NSS 硬件加速微码版本: ') + rawFw
		}, [ E('strong', {}, [ 'FW:' ]), fwShort ]),
		E('span', {
			'class': 'badge badge-neutral badge-tile-112',
			'title': _('微码特性掩码 (fw_mask)')
		}, [ E('strong', {}, [ _('掩码:') ]), fwMask ]),
		E('span', {
			'class': 'badge badge-success badge-tile-112',
			'title': _('NPU 微码与内核驱动每秒高频心跳包采样 (pkts/s)')
		}, [ E('strong', {}, [ _('心跳:') ]), heartbeatNum + '/s' ])
	]);

	// 2. 核心计算负载 (总宽锁死 348px，与 3×112px 网格右边缘严丝合缝对齐)
	var computeLoadElements = [];
	if (Array.isArray(d.cpu_ticks) && d.cpu_ticks.length >= 7) {
		var cpu = calcCpuLoad(d.cpu_ticks);
		computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
			E('span', { 'style': 'width:45px; min-width:45px; font-size:11px;' }, [ 'CPU:' ]),
			E('div', { 'style': 'flex:1;' }, [
				hostCpuProgressbar(cpu.total, cpu.usr, cpu.sys, cpu.sirq)
			]),
			E('span', { 'class': 'nss-num-cell', 'style': 'font-size:11px; font-weight:600; width:32px; min-width:32px; text-align:right;' }, [ cpu.total.toFixed(0) + '%' ])
		]));
	}

	if (!isDualNpu) {
		computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
			E('span', { 'style': 'width:45px; min-width:45px; font-size:11px;' }, [ 'Core 0:' ]),
			E('div', { 'style': 'flex:1;' }, [ progressbar(d.core0_load || 0, 100) ]),
			E('span', { 'class': 'nss-num-cell', 'style': 'font-size:11px; font-weight:600; width:32px; min-width:32px; text-align:right;' }, [ (d.core0_load || 0) + '%' ])
		]));
	} else {
		var isCore1Active = (d.core1_load !== null && d.core1_load !== undefined);
		computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
			E('span', { 'style': 'width:45px; min-width:45px; font-size:11px;' }, [ 'Core 0:' ]),
			E('div', { 'style': 'flex:1;' }, [ progressbar(d.core0_load || 0, 100) ]),
			E('span', { 'class': 'nss-num-cell', 'style': 'font-size:11px; font-weight:600; width:32px; min-width:32px; text-align:right;' }, [ (d.core0_load || 0) + '%' ])
		]));
		computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
			E('span', { 'style': 'width:45px; min-width:45px; font-size:11px;' }, [ 'Core 1:' ]),
			E('div', { 'style': 'flex:1;' }, [
				isCore1Active ? progressbar(d.core1_load, 100) : progressbar(null, 100, _('休眠待机'))
			]),
			E('span', {
				'class': 'nss-num-cell',
				'style': 'font-size:11px; font-weight:600; width:32px; min-width:32px; text-align:right; color:' + (isCore1Active ? 'inherit' : 'var(--text-color-medium)') + ';',
				'title': isCore1Active ? '' : _('NPU Core 1 物理待机 (无蜂窝/IPsec服务固件)')
			}, [
				isCore1Active ? ((d.core1_load || 0) + '%') : _('待机')
			])
		]));
	}

	var computeLoadView = E('div', { 'class': 'nss-load-box-348' }, computeLoadElements);

	// 3. 模块状态 (7 大加速引擎徽章，严格统一 3×112px 等宽网格)
	var wifiChip = (d.wifi_offload === 1)
		? moduleChip('Wi-Fi', 2, _('已加速'), _('ath11k wifili 硬件加速已就绪 (802.11s Mesh 支持)'))
		: moduleChip('Wi-Fi', 0, _('主机模式'), _('无线数据流未经 NSS 卸载'));

	var sqmVal = (p && p.sqm != null) ? p.sqm : (d.sqm != null ? d.sqm : -1);
	var sqmChip;
	if (sqmVal === 2) {
		sqmChip = moduleChip('SQM', 2, _('硬件队列'), _('NSS 硬件队列加速运行中 (CAKE/FQ-CoDel 硬件调度)'));
	} else if (sqmVal === 1) {
		sqmChip = moduleChip('SQM', 1, _('主机队列'), _('主机软件队列整形运行中'));
	} else if (sqmVal === 0) {
		sqmChip = moduleChip('SQM', 0, _('未启用'), _('未启用 (已配置备用)'));
	} else {
		sqmChip = moduleChip('SQM', 0, _('未安装'), _('未安装 sqm-scripts'));
	}

	var modulesView = E('div', { 'class': 'nss-grid-3x112' }, [
		moduleChip('Bridge', mods.bridge),
		moduleChip('PPPoE', mods.pppoe),
		wifiChip,
		sqmChip,
		moduleChip('VLAN', mods.vlan),
		moduleChip('Qdisc', mods.qdisc),
		moduleChip('EIP-197', mods.crypto)
	]);

	var section1 = E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('核心算力与驱动模块') ]),
			E('span', {
				'class': 'badge badge-info',
				'title': _('当前 NSS 锁相环运行主频')
			}, [ npuLabel + ' @ ' + freqVal ]),
			E('span', {
				'class': 'badge badge-success',
				'title': rawFw + (fwMask ? ' (fw_mask: ' + fwMask + ')' : '')
			}, [ fwDisplay ])
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('table', { 'class': 'table nss-status-table' }, [
				E('tbody', {}, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left nss-status-label', 'title': _('高通独立网络子系统架构规格、NPU 频率与微码版本') }, [
							E('span', { 'class': 'th-hint' }, [ _('协处理器') ])
						]),
						E('td', { 'class': 'td left' }, [ specView ])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left nss-status-label', 'title': _('Linux 主机通用处理器 (usr/sys/sirq) 与 NSS 协处理器独立算力负载') }, [
							E('span', { 'class': 'th-hint' }, [ _('核心负载') ])
						]),
						E('td', { 'class': 'td left' }, [ computeLoadView ])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left nss-status-label', 'title': _('底层驱动与加速子系统卸载状态：Bridge(桥接)、PPPoE(拨号)、Wi-Fi(无线通道)、SQM(队列整形)、VLAN(虚网)、Qdisc(流量控制)、EIP-197(硬件加解密)') }, [
							E('span', { 'class': 'th-hint' }, [ _('模块状态') ])
						]),
						E('td', { 'class': 'td left' }, [ modulesView ])
					])
				])
			])
		])
	]);

	// 4. 流表与环境温度 (每行 3 个 112px 等宽卡片网格)
	var ecmTotalChip = E('span', {
		'class': 'badge badge-info badge-tile-112',
		'title': _('当前经由高通增强连接管理器 (ECM) 卸载的硬件并发流总数')
	}, [
		E('span', { 'class': 'badge-dot' }),
		E('strong', {}, [ 'ECM:' ]),
		totalConns.toLocaleString() + ' ' + _('流')
	]);

	var ecmDistChip = E('span', {
		'class': 'badge badge-neutral badge-tile-112',
		'title': 'IPv4: ' + (d.ecm_v4 || 0) + ' • IPv6: ' + (d.ecm_v6 || 0)
	}, [
		E('strong', {}, [ 'v4/v6:' ]),
		(d.ecm_v4 || 0) + '/' + (d.ecm_v6 || 0)
	]);

	var flowChips = [
		E('span', { 'class': 'badge badge-info badge-tile-112' }, [ E('strong', {}, [ 'IPv4:' ]), (d.ecm_v4 || 0) ]),
		E('span', { 'class': 'badge badge-info badge-tile-112' }, [ E('strong', {}, [ 'IPv6:' ]), (d.ecm_v6 || 0) ]),
		E('span', { 'class': 'badge badge-neutral badge-tile-112' }, [ E('strong', {}, [ 'TCP:' ]), (d.ecm_tcp || 0) ]),
		E('span', { 'class': 'badge badge-neutral badge-tile-112' }, [ E('strong', {}, [ 'UDP:' ]), (d.ecm_udp || 0) ]),
		E('span', { 'class': 'badge badge-neutral badge-tile-112' }, [ E('strong', {}, [ 'Other:' ]), (d.ecm_other || 0) ])
	];

	var tempElements = [];
	if (d.cpu_temp && parseFloat(d.cpu_temp) > 0)
		tempElements.push(tempBadge('CPU', d.cpu_temp));

	var radios = d.radios || [];
	for (var i = 0; i < radios.length; i++) {
		if (radios[i].temp && parseFloat(radios[i].temp) > 0)
			tempElements.push(tempBadge(radios[i].id, radios[i].temp));
	}
	if (!tempElements.length)
		tempElements.push(badge('badge-neutral badge-tile-112', _('未检测到温度')));

	var section2 = E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('流表引擎与环境遥测') ]),
			badge('badge-info', totalConns.toLocaleString() + ' ' + _('活动流'))
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('table', { 'class': 'table nss-status-table' }, [
				E('tbody', {}, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left nss-status-label', 'title': _('当前经由高通增强连接管理器 (ECM) 卸载到硬件层线速转发的活跃流数与 v4/v6 概况') }, [
							E('span', { 'class': 'th-hint' }, [ _('流表状态') ])
						]),
						E('td', { 'class': 'td left' }, [
							E('div', { 'class': 'nss-grid-3x112' }, [
								ecmTotalChip,
								ecmDistChip,
								badge('badge-success badge-tile-112', _('硬件直通中'), true)
							])
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left nss-status-label', 'title': _('当前经由 NSS 硬件卸载的 IPv4 / IPv6 及 TCP / UDP 活跃连接流详细分布') }, [
							E('span', { 'class': 'th-hint' }, [ _('协议分布') ])
						]),
						E('td', { 'class': 'td left' }, [
							E('div', { 'class': 'nss-grid-3x112' }, flowChips)
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left nss-status-label', 'title': _('路由器 SoC 物理结温与 Wi-Fi 射频芯片温度实时监控') }, [
							E('span', { 'class': 'th-hint' }, [ _('硬件结温') ])
						]),
						E('td', { 'class': 'td left' }, [
							E('div', { 'class': 'nss-grid-3x112' }, tempElements)
						])
					])
				])
			])
		])
	]);

	return E('div', {}, [ section1, section2 ]);
}

// ── 4. 子卡 B：控制与防御 (Controls) ──
function renderControlCard(s, d, p, onSaved) {
	var isDualNpu = (d.cores !== 1);
	var npuLabel = isDualNpu ? 'NPU ×2' : 'NPU ×1';

	var cbEnabled = E('input', {
		'type': 'checkbox',
		'class': 'cbi-checkbox',
		'style': 'width:18px; height:18px; cursor:pointer;',
		'checked': (s.enabled === 1) ? '' : null
	});

	var cbCrypto = E('input', {
		'type': 'checkbox',
		'class': 'cbi-checkbox',
		'style': 'width:18px; height:18px; cursor:pointer;',
		'checked': (s.crypto === 1) ? '' : null
	});

	var selectFreq = E('select', {
		'class': 'cbi-input-select',
		'style': 'padding:4px 8px; font-size:13px; width:240px;'
	}, [
		E('option', { 'value': '748.8 MHz', 'selected': (s.frequency && s.frequency.indexOf('748') !== -1) ? '' : null }, [ _('稳健节能 (748.8 MHz)') ]),
		E('option', { 'value': '1056.0 MHz', 'selected': (s.frequency && s.frequency.indexOf('1056') !== -1) ? '' : null }, [ _('IPQ60xx 默认 (1056.0 MHz)') ]),
		E('option', { 'value': '1478.4 MHz', 'selected': (!s.frequency || s.frequency.indexOf('1478') !== -1) ? '' : null }, [ _('IPQ807x 标准 (1478.4 MHz - 推荐)') ]),
		E('option', { 'value': '1689.6 MHz', 'selected': (s.frequency && s.frequency.indexOf('1689') !== -1) ? '' : null }, [ _('极速超频 (1689.6 MHz - 满血)') ])
	]);

	var cbAutoBlock = E('input', {
		'type': 'checkbox',
		'class': 'cbi-checkbox',
		'style': 'width:18px; height:18px; cursor:pointer;',
		'checked': (s.auto_block !== 0) ? '' : null
	});

	var table = E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left', 'style': 'width:35%' }, [
				E('label', {}, [ E('strong', {}, [ _('NSS 硬件网络加速总开关') ]) ]),
				E('div', { 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:2px;' }, [
					_('开启后由 NSS 协处理器接管有线与无线网络流量线速转发')
				])
			]),
			E('td', { 'class': 'td left' }, [
				E('label', { 'style': 'display:inline-flex; align-items:center; gap:8px; cursor:pointer;' }, [
					cbEnabled,
					E('span', { 'style': 'font-weight:600; color:var(--success-color-high);' }, [ _('启用 (即时生效)') ])
				])
			])
		]),
		E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left' }, [
				E('label', {}, [ E('strong', {}, [ _('NSS EIP-197 硬件加解密引擎 (Crypto Offload)') ]) ]),
				E('div', { 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:2px;' }, [
					_('启用高通独立安全协处理器，卸载 IPsec 与网络大包加解密 (关闭时使用 CPU ARMv8 CE 纳秒级指令)')
				])
			]),
			E('td', { 'class': 'td left' }, [
				E('div', { 'style': 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;' }, [
					E('label', { 'style': 'display:inline-flex; align-items:center; gap:8px; cursor:pointer;' }, [
						cbCrypto,
						E('span', { 'style': 'font-weight:600;' }, [ _('启用 EIP-197 加速') ])
					]),
					E('span', { 'class': 'badge badge-warning' }, [ '⚠️ ' + _('修改后需重启生效') ])
				])
			])
		]),
		E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left' }, [
				E('label', {}, [ E('strong', {}, [ _('NSS 核心主频调节') ]) ]),
				E('div', { 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:2px;' }, [
					_('调节 NSS 锁相环时钟频率 (当前识别目标: ') + npuLabel + ')'
				])
			]),
			E('td', { 'class': 'td left' }, [ selectFreq ])
		]),
		E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left' }, [
				E('label', {}, [ E('strong', {}, [ _('内核冲突配置自动阻断墙 (Auto-Block Protection)') ]) ]),
				E('div', { 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:2px;' }, [
					_('主动拦截外部 flow_offloading 与 packet_steering，防止硬件流表撕裂丢包')
				])
			]),
			E('td', { 'class': 'td left' }, [
				E('label', { 'style': 'display:inline-flex; align-items:center; gap:8px; cursor:pointer;' }, [
					cbAutoBlock,
					E('span', { 'style': 'font-weight:600; color:var(--success-color-high);' }, [ _('启用主动阻断防御') ])
				])
			])
		])
	]);

	var btnSave = E('button', {
		'class': 'cbi-button cbi-button-apply',
		'style': 'margin-top:12px;',
		'click': function(ev) {
			ev.preventDefault();
			var enabled = cbEnabled.checked ? 1 : 0;
			var crypto = cbCrypto.checked ? 1 : 0;
			var freq = selectFreq.value;
			var auto_block = cbAutoBlock.checked ? 1 : 0;

			ui.showModal(_('正在保存 NSS 配置…'), [
				E('p', { 'class': 'spinning' }, [ _('正在写入配置并执行状态对齐…') ])
			]);

			callSetSettings(enabled, crypto, freq, auto_block).then(function() {
				s.enabled = enabled;
				s.crypto = crypto;
				s.frequency = freq;
				s.auto_block = auto_block;
				if (d) d.nss_freq = freq;
				if (p) p.nss_freq = freq;
				if (onSaved) onSaved();
				ui.addNotification(null, E('p', {}, [ _('NSS 硬件控制配置已成功保存并应用。') ]), 'info');
				ui.hideModal();
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, [ _('保存配置失败: ') + err.message ]), 'danger');
				ui.hideModal();
			});
		}
	}, [ _('保存并应用 (Save & Apply)') ]);

	var moduleBox = E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('NSS 硬件协同控制与冲突防御') ]),
			badge('badge-info', _('热生效 / 重启约束'))
		]),
		E('div', { 'class': 'cbi-section-node' }, [ table ])
	]);

	return E('div', {}, [
		moduleBox,
		E('div', { 'style': 'display:flex; justify-content:flex-end;' }, [ btnSave ])
	]);
}

// ── 5. 子卡 C：端口线速 (Ports) ──
function fetchPortStats(portsData) {
	var ports = portsData.ports || [];
	var tasks = ports.map(function(p) {
		if (p.netdev) {
			return L.resolveDefault(callDeviceStatus(p.netdev), null);
		}
		return Promise.resolve(null);
	});

	return Promise.all(tasks).then(function(devList) {
		for (var i = 0; i < ports.length; i++) {
			var dev = devList[i];
			if (dev) {
				if (dev.carrier === false || dev.up === false) {
					ports[i].speed = _('未连接');
				} else if (dev.speed) {
					var rawSp = String(dev.speed).replace(/[FfHh]/g, '');
					var numSp = parseInt(rawSp) || 0;
					if (numSp >= 10000) ports[i].speed = '10G';
					else if (numSp >= 2500) ports[i].speed = '2.5G';
					else if (numSp == 1000) ports[i].speed = '1000M';
					else if (numSp > 1000) ports[i].speed = (numSp / 1000).toFixed(1) + 'G';
					else if (numSp > 0) ports[i].speed = numSp + 'M';
					else ports[i].speed = String(dev.speed);
				}
				if (dev.statistics) {
					if (dev.statistics.rx_bytes != null) ports[i].rx_bytes = dev.statistics.rx_bytes;
					if (dev.statistics.tx_bytes != null) ports[i].tx_bytes = dev.statistics.tx_bytes;
				}
			}
		}
		return portsData;
	});
}

function renderPortsCard(d, onRefreshToggle) {
	var ports = d.ports || [];

	var rows = ports.map(function(p) {
		var hwRatio = parseFloat(p.tx_offload_pct || p.rx_offload_pct || 0);
		var offloaded = (parseInt(p.tx_offloaded || 0) + parseInt(p.rx_offloaded || 0));
		var hostPkts = (parseInt(p.tx_host_pkts || 0) + parseInt(p.rx_host_pkts || 0));
		var isUp = (p.started === 1 && p.speed !== '未连接');
		var speedText = p.speed || (isUp ? _('已连接') : _('未连接'));
		var speedCls = isUp ? 'badge-success' : 'badge-neutral';

		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': 'width:80px;' }, [ E('strong', {}, [ p.netdev || ('eth' + p.ifnum) ]) ]),
			E('td', { 'class': 'td', 'style': 'width:86px;' }, [
				E('span', { 'class': 'badge ' + speedCls + ' badge-tile-64' }, [ speedText ])
			]),
			E('td', { 'class': 'td nss-num-cell', 'style': 'width:165px;' }, [
				E('div', { 'style': 'display:flex; align-items:center; gap:6px;' }, [
					E('div', { 'style': 'width:100px; flex-shrink:0;' }, [ progressbar(hwRatio, 100) ]),
					E('span', { 'style': 'font-size:11px; font-weight:bold; width:40px; text-align:right;' }, [ hwRatio + '%' ])
				])
			]),
			E('td', { 'class': 'td nss-num-cell', 'style': 'width:140px;' }, [ offloaded.toLocaleString() + ' pkts' ]),
			E('td', { 'class': 'td nss-num-cell', 'style': 'width:140px;' }, [ hostPkts.toLocaleString() + ' pkts' ]),
			E('td', { 'class': 'td nss-num-cell', 'style': 'width:155px;' }, [
				String.format('%1024.1mB', (p.rx_bytes || 0)) + ' / ' + String.format('%1024.1mB', (p.tx_bytes || 0))
			])
		]);
	});

	if (!rows.length) {
		rows = [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'colspan': '6', 'style': 'text-align:center; color:var(--text-color-medium);' }, [
					_('当前暂未探测到已挂载的 NSS 物理以太网接口 (Host Stack Mode)')
				])
			])
		];
	}

	var moduleBox = E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('以太网物理端口线速卸载矩阵') ]),
			badge('badge-success', _('硬件线速卸载监测'))
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('div', makeScrollWrapAttrs('ports-scroll-wrap', onRefreshToggle), [
				E('table', { 'class': 'table nss-fixed-table' }, [
					E('thead', {}, [
						E('tr', { 'class': 'tr table-titles' }, [
							E('th', { 'class': 'th', 'style': 'width:80px;' }, [ 'Port' ]),
							E('th', { 'class': 'th', 'style': 'width:86px;' }, [ 'Speed' ]),
							E('th', { 'class': 'th', 'style': 'width:165px;' }, [ 'HW %' ]),
							E('th', { 'class': 'th', 'style': 'width:140px;' }, [ 'HW Pkts' ]),
							E('th', { 'class': 'th', 'style': 'width:140px;' }, [ 'Host Pkts' ]),
							E('th', { 'class': 'th', 'style': 'width:155px;' }, [ 'RX / TX' ])
						])
					]),
					E('tbody', {}, rows)
				])
			])
		])
	]);

	return E('div', {}, [
		moduleBox,
		E('div', { 'class': 'cbi-map-descr', 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:6px;' }, [
			_('说明: “HW Pkts”代表由芯片固件硬件线速转发的数据包；“Host Pkts”代表建链首包握手、广播发现或路由器本机流量；HW % 接近 100% 表明硬件卸载完全生效。鼠标移入表格区域自动挂起轮询。')
		])
	]);
}

// ── 6. 子卡 D：硬件流表与聚合 (Flows) ──
var WELL_KNOWN_PORTS = util.WELL_KNOWN_PORTS;
var formatEndpoint = util.formatEndpoint.bind(util);

/* ── DataTable Core Primitives ── */
function renderTableHeaders(cols, sortKey, sortDir, onSort) {
	return cols.map(function(col) {
		var isSorted = (sortKey === col.key);
		var arrow = isSorted ? (sortDir > 0 ? ' ▲' : ' ▼') : '';
		return E('th', {
			'class': 'th' + (isSorted ? ' sorted' : ''),
			'style': 'width:' + col.width + '; cursor:pointer; user-select:none;',
			'title': (col.hint ? (col.hint + ' • ') : '') + _('点击排序'),
			'click': function() {
				if (sortKey === col.key) {
					onSort(col.key, -sortDir);
				} else {
					onSort(col.key, col.num ? -1 : 1);
				}
			}
		}, [ col.title + arrow ]);
	});
}

function sortTableItems(items, cols, sortKey, sortDir) {
	var curCol = cols.find(function(c) { return c.key === sortKey; }) || cols[0];
	return items.sort(function(a, b) {
		var va = curCol.get ? curCol.get(a) : a[curCol.key];
		var vb = curCol.get ? curCol.get(b) : b[curCol.key];
		if (curCol.num) return ((va || 0) - (vb || 0)) * sortDir;
		return String(va || '').localeCompare(String(vb || '')) * sortDir;
	});
}

function patchTableRows(tbody, items, renderRow, patchRow, emptyText, colSpan) {
	if (!items.length) {
		dom.content(tbody, [
			E('tr', { 'class': 'tr tr-empty-placeholder', 'data-empty': 'true' }, [
				E('td', { 'class': 'td', 'colspan': String(colSpan || 6), 'style': 'text-align:center; color:var(--text-color-medium);' }, [ emptyText ])
			])
		]);
		return;
	}

	tbody.querySelectorAll('tr[data-empty], .tr-empty-placeholder, tr.tr-empty-placeholder').forEach(function(ph) {
		if (ph.parentNode === tbody) tbody.removeChild(ph);
	});

	var existing = {};
	tbody.querySelectorAll('tr[data-key]').forEach(function(r) {
		existing[r.getAttribute('data-key')] = r;
	});

	items.forEach(function(item) {
		var row = existing[item.key];
		if (row) {
			delete existing[item.key];
			if (patchRow) patchRow(row, item);
		} else {
			row = renderRow(item);
		}
		tbody.appendChild(row);

		// 若该项存在展开中的详情子行，将其按正确从属顺序紧随主行挂载，防止被全表 diff 覆盖冲刷
		var expandRow = tbody.querySelector('tr[data-expand-for="' + item.key + '"]');
		if (expandRow) {
			tbody.appendChild(expandRow);
		}
	});

	Object.keys(existing).forEach(function(k) {
		if (existing[k].parentNode === tbody) {
			var expandRow = tbody.querySelector('tr[data-expand-for="' + k + '"]');
			if (expandRow && expandRow.parentNode === tbody) expandRow.parentNode.removeChild(expandRow);
			tbody.removeChild(existing[k]);
		}
	});
}

function renderClientCell(c, expandKey, onToggle) {
	var isExpanded = !!expandedClientsMap[expandKey];
	var arrow = isExpanded ? '▾' : '▸';
	var v6Badge = (c.v6Count > 0)
		? E('span', {
			'class': 'badge badge-neutral',
			'style': 'font-size:10px; padding:0 4px; margin-left:4px;',
			'title': _('该终端拥有 %d 个 IPv6 地址').format(c.v6Count)
		}, [ '+' + c.v6Count + ' IPv6' ])
		: '';

	return E('div', {
		'class': 'client-trigger-box' + (isExpanded ? ' no-hover' : ''),
		'style': 'user-select:none;',
		'title': isExpanded ? _('点击收起详情面板') : _('点击展开该终端地址池')
	}, [
		E('div', { 'style': 'display:flex; align-items:center; gap:6px; flex-wrap:wrap;' }, [
			E('span', {
				'class': 'badge ' + (isExpanded ? 'badge-info' : 'badge-neutral') + ' client-expand-badge',
				'style': 'font-size:11px; padding:2px 8px; display:inline-flex; align-items:center; gap:5px; font-weight:600;'
			}, [
				E('span', { 'style': 'font-size:10px; line-height:1;' }, [ arrow ]),
				c.hostName
			]),
			v6Badge
		]),
		E('div', { 'style': 'font-size:11px; margin-top:3px; padding-left:4px;' }, [
			E('code', {}, [ c.ip ])
		])
	]);
}

function renderExpandRow(c, colSpan, expandKey, onToggle) {
	return E('tr', { 'class': 'tr client-expand-row', 'data-expand-for': c.key }, [
		E('td', { 'class': 'td', 'colspan': String(colSpan) }, [
			renderItemExpandPanel(c, function() {
				expandedClientsMap[expandKey] = false;
				if (onToggle) onToggle();
			})
		])
	]);
}

var flowColFilters = {};

function renderTableFilters(cols, filterMap, onFilterChange) {
	return E('tr', { 'class': 'tr' }, cols.map(function(col) {
		return E('td', { 'class': 'td' }, [
			E('input', {
				'type': 'text',
				'class': 'cbi-input-text',
				'style': 'width:100%; min-width:3em;',
				'placeholder': _('过滤…'),
				'value': filterMap[col.key] || '',
				'input': function(ev) {
					filterMap[col.key] = ev.target.value.trim().toLowerCase();
					onFilterChange();
				}
			})
		]);
	}));
}

function getFilteredFlows(normalizedFlows, subtab, hostnames) {
	var list = normalizedFlows;
	if (subtab === 'ipv4') {
		list = list.filter(function(f) { return f.family === 'ipv4' || f.srcRaw.indexOf('.') !== -1; });
	} else if (subtab === 'ipv6') {
		list = list.filter(function(f) { return f.family === 'ipv6' || f.srcRaw.indexOf(':') !== -1; });
	}

	var hasFilter = false;
	for (var k in flowColFilters) {
		if (flowColFilters[k]) { hasFilter = true; break; }
	}
	if (!hasFilter) return list;

	return list.filter(function(f) {
		for (var k in flowColFilters) {
			var q = flowColFilters[k];
			if (!q) continue;
			if (k === 'proto') {
				if ((f.proto || '').toLowerCase().indexOf(q) === -1) return false;
			} else if (k === 'src') {
				var srcName = hostnames ? (hostnames[f.srcRaw] || '') : '';
				var sText = (f.src || '') + ' ' + (f.srcRaw || '') + ' ' + srcName;
				if (sText.toLowerCase().indexOf(q) === -1) return false;
			} else if (k === 'dst') {
				var dstName = hostnames ? (hostnames[f.dstRaw] || '') : '';
				var dText = (f.dst || '') + ' ' + (f.dstRaw || '') + ' ' + dstName;
				if (dText.toLowerCase().indexOf(q) === -1) return false;
			} else if (k === 'dscp') {
				var dName = f.dscpMeta ? (f.dscpMeta.name + ' ' + f.dscpMeta.label + ' ' + f.dscpMeta.category) : '';
				if (dName.toLowerCase().indexOf(q) === -1) return false;
			} else if (k === 'rate') {
				if (fmtRate(f.bps || 0).toLowerCase().indexOf(q) === -1) return false;
			} else if (k === 'pkts') {
				if (String(f.pkts || 0).indexOf(q) === -1) return false;
			} else if (k === 'bytes') {
				if (String.format('%1024.1mB', f.bytes || 0).toLowerCase().indexOf(q) === -1) return false;
			}
		}
		return true;
	});
}

var CLIENT_COLS = [
	{ key: 'client',     width: '210px', title: _('终端设备'), hint: _('局域网在线设备，依据 MAC/ARP/DHCP 自动识别。支持点击展开全部 IPv6 地址与流表反查穿透'), num: false, get: function(c) { return (c.hostName || '') + ' ' + (c.ip || ''); } },
	{ key: 'rate',       width: '108px', title: _('实时速率'), hint: _('客户端 V8 两帧差分计算的该终端实时双向吞吐速率'), num: true,  get: function(c) { return c.totalBps || 0; } },
	{ key: 'flowCount',  width: '92px',  title: _('并发流'),   hint: _('该终端当前活跃的双向 TCP/UDP 会话总数'), num: true,  get: function(c) { return c.flowCount || 0; } },
	{ key: 'totalPkts',  width: '115px', title: _('报文数'),   hint: _('该终端所有活跃流的累计硬件转发数据包总数'), num: true,  get: function(c) { return c.totalPkts || 0; } },
	{ key: 'totalBytes', width: '96px',  title: _('数据量'),   hint: _('该终端所有活跃流的累计硬件转发网络流量'), num: true,  get: function(c) { return c.totalBytes || 0; } },
	{ key: 'proto',      width: '110px', title: _('协议'),     hint: _('该终端当前使用的传输层协议分布 (TCP/UDP)'), num: false, get: function(c) { return Object.keys(c.protos).sort().join(','); } }
];

var prevFlowsCache = {};
var prevFlowsTime = 0;
var nssGlobalRateBps = 0;

var DSCP_NAMES = {
	0: 'CS0', 1: 'LE', 8: 'CS1', 10: 'AF11', 12: 'AF12', 14: 'AF13',
	16: 'CS2', 18: 'AF21', 20: 'AF22', 22: 'AF23', 24: 'CS3', 26: 'AF31',
	28: 'AF32', 30: 'AF33', 32: 'CS4', 34: 'AF41', 36: 'AF42', 38: 'AF43',
	40: 'CS5', 44: 'VA', 46: 'EF', 48: 'CS6', 56: 'CS7'
};



var fmtRate = util.fmtRate.bind(util);
var fmtPps = util.fmtPps.bind(util);

function getDscpMeta(mark) {
	if (!mark || mark === 0) {
		return { dscp: 0, name: 'CS0', label: '— #CS0', cls: 'badge-neutral', icon: '', category: _('尽力而为') };
	}
	var d = (mark & 0x80) ? (mark & 0x7f) : (mark <= 63 ? mark : 0);
	var name = DSCP_NAMES[d] || ('0x' + d.toString(16).toUpperCase());

	var cls = 'badge-neutral';
	var icon = '🏷️';
	var category = _('非标标记');

	if (d === 46 || d === 44) {
		cls = 'badge-danger';
		icon = '📞';
		category = _('VoIP 实时语音');
	} else if (d === 34 || d === 36 || d === 38 || d === 26 || d === 28 || d === 30 || d === 32 || d === 40) {
		cls = 'badge-warning';
		icon = '🎬';
		category = _('流媒体视频');
	} else if (d === 18 || d === 20 || d === 22 || d === 10 || d === 12 || d === 14 || d === 16 || d === 24) {
		cls = 'badge-info';
		icon = '💼';
		category = _('关键事务交互');
	} else if (d === 48 || d === 56) {
		cls = 'badge-success';
		icon = '🛡️';
		category = _('网络协议控制');
	} else if (d === 1 || d === 8) {
		cls = 'badge-neutral';
		icon = '🔽';
		category = _('低优清道夫');
	} else if (d === 0) {
		return { dscp: 0, name: 'CS0', label: '— #CS0', cls: 'badge-neutral', icon: '', category: _('尽力而为') };
	}

	return {
		dscp: d,
		name: name,
		label: '#' + name,
		cls: cls,
		icon: icon,
		category: category
	};
}

var TCP_STATE_MAP = {
	'ESTABLISHED': { text: 'ESTAB', cls: 'badge-success', title: _('连接稳态: ESTABLISHED (硬件全速线速转发中)') },
	'SYN_SENT':    { text: 'SYN-S', cls: 'badge-warning', title: _('连接握手: SYN_SENT (客户端主动握手，等待 ACK)') },
	'SYN_RECV':    { text: 'SYN-R', cls: 'badge-warning', title: _('连接握手: SYN_RECV (服务端收到 SYN，已回应)') },
	'FIN_WAIT':    { text: 'FIN-W', cls: 'badge-neutral', title: _('连接释放: FIN_WAIT (等待对端释放确认)') },
	'TIME_WAIT':   { text: 'TIM-W', cls: 'badge-neutral', title: _('等待超时: TIME_WAIT (已关闭，防旧分节干扰)') },
	'CLOSE':       { text: 'CLOSE', cls: 'badge-neutral', title: _('连接已关: CLOSE (已断开，套接字已销毁)') },
	'CLOSE_WAIT':  { text: 'CLS-W', cls: 'badge-neutral', title: _('等待关闭: CLOSE_WAIT (等待本地应用关闭套接字)') },
	'LAST_ACK':    { text: 'L-ACK', cls: 'badge-neutral', title: _('最后确认: LAST_ACK (等待最后的断开确认)') }
};

var FLOW_COLS = [
	{ key: 'proto', width: '98px',  title: _('协议'),     hint: _('传输层网络协议类型 (TCP/UDP/ICMP)'), num: false, get: function(f) { return (f.proto || 'TCP').toUpperCase(); } },
	{ key: 'src',   width: '185px', title: _('源地址'),   hint: _('会话发起端 IP 地址与端口号'), num: false, get: function(f) { return (f.src || ''); } },
	{ key: 'dst',   width: '185px', title: _('目的地址'), hint: _('会话对端/目标服务 IP 地址与端口号'), num: false, get: function(f) { return (f.dst || ''); } },
	{ key: 'dscp',  width: '58px',  title: 'DSCP',        hint: _('IETF DiffServ 业务分级标牌与服务质量标识'), num: false, get: function(f) { return (f.dscpMeta ? f.dscpMeta.name : ''); } },
	{ key: 'rate',  width: '132px', title: _('实时速率'), hint: _('客户端 V8 两帧差分计算的实时双向吞吐速率'), num: true,  get: function(f) { return f.bps || 0; } },
	{ key: 'pkts',  width: '86px',  title: _('报文数'),   hint: _('该连接双向累计传输的数据包总数 (包含 NSS 硬件计数)'), num: true,  get: function(f) { return parseInt(f.pkts) || 0; } },
	{ key: 'bytes', width: '74px',  title: _('数据量'),   hint: _('该连接双向累计传输的数据字节总数 (包含 NSS 硬件计数)'), num: true,  get: function(f) { return parseInt(f.bytes) || 0; } }
];

// 幂等流表处理：同一份 RPC 响应对象仅计算一次速率差分并缓存于 d._processed，彻底根除切 Tab/排序/展开时速率归零 Bug
function processFlowsData(d, hostHints) {
	d = d || {};
	if (d._processed) {
		return d._processed;
	}

	var hostnames = d.hostnames || {};
	var isInstalled = (d.installed !== 0);
	var clientMap = {};
	var totalPkts = 0;
	var totalBytes = 0;

	var ipToDevice = {};
	Object.keys(hostHints || {}).forEach(function(mac) {
		var devEntry = hostHints[mac];
		var dev = {
			mac: mac,
			name: (devEntry.name || '').replace(/\.lan$/i, ''),
			ipv4: devEntry.ipaddrs ? [].concat(devEntry.ipaddrs) : [],
			ipv6: devEntry.ip6addrs ? [].concat(devEntry.ip6addrs) : []
		};
		(devEntry.ipaddrs || []).forEach(function(ip) { ipToDevice[ip] = dev; });
		(devEntry.ip6addrs || []).forEach(function(ip) { ipToDevice[normIp(ip)] = dev; });
	});

	var routerInfo = d.router || (staticProfile && staticProfile.router) || getSessionData('nss_router_device') || {};
	var routerHostname = (routerInfo.hostname || window.location.hostname || 'czw').replace(/\.lan$/i, '');
	var routerIps = Array.isArray(routerInfo.ips) ? routerInfo.ips.slice() : [];
	if (d.router && Array.isArray(d.router.ips)) {
		d.router.ips.forEach(function(rip) {
			if (routerIps.indexOf(rip) === -1) routerIps.push(rip);
		});
	}
	['127.0.0.1', '::1', 'localhost'].forEach(function(lip) {
		if (routerIps.indexOf(lip) === -1) routerIps.push(lip);
	});

	var routerDev = null;
	for (var ri = 0; ri < routerIps.length; ri++) {
		var rip = routerIps[ri];
		if (ipToDevice[rip] || ipToDevice[normIp(rip)]) {
			routerDev = ipToDevice[rip] || ipToDevice[normIp(rip)];
			break;
		}
	}
	if (!routerDev) {
		Object.keys(ipToDevice).forEach(function(k) {
			var candidate = ipToDevice[k];
			if (candidate && candidate.name && candidate.name.toLowerCase() === routerHostname.toLowerCase()) {
				routerDev = candidate;
			}
		});
	}

	if (routerDev) {
		routerDev.isRouter = true;
		routerDev.name = routerHostname + ' (' + _('路由器本机') + ')';
		if (!routerDev.ipv4) routerDev.ipv4 = [];
		if (!routerDev.ipv6) routerDev.ipv6 = [];
	} else {
		routerDev = {
			mac: '',
			name: routerHostname + ' (' + _('路由器本机') + ')',
			ipv4: [],
			ipv6: [],
			isRouter: true
		};
	}

	routerIps.forEach(function(rip) {
		if (!rip || rip === 'localhost') return;
		if (rip.indexOf(':') !== -1) {
			var nrip = normIp(rip);
			if (routerDev.ipv6.indexOf(rip) === -1 && routerDev.ipv6.indexOf(nrip) === -1) {
				routerDev.ipv6.push(rip);
			}
			ipToDevice[nrip] = routerDev;
			ipToDevice[rip] = routerDev;
		} else {
			if (routerDev.ipv4.indexOf(rip) === -1) {
				routerDev.ipv4.push(rip);
			}
			ipToDevice[rip] = routerDev;
		}
	});

	routerDev.ipv4.sort(function(a, b) {
		function score(ip) {
			if (ip.indexOf('192.168.') === 0) return 1;
			if (ip.indexOf('10.') === 0 && ip.indexOf('100.') !== 0) return 2;
			if (ip.indexOf('172.') === 0) return 3;
			if (ip.indexOf('100.') === 0) return 4;
			if (ip === '127.0.0.1') return 5;
			return 6;
		}
		return score(a) - score(b);
	});

	var normalizedFlows = [];
	var tupleList = Array.isArray(d.data) ? d.data : [];
	for (var ti = 0; ti < tupleList.length; ti++) {
		var t = tupleList[ti];
		var fam = (t[0] === 6) ? 'ipv6' : 'ipv4';
		var pStr = String(t[1] || 'TCP').toUpperCase();
		var rSrc = String(t[2] || '');
		var sp = t[3] || '';
		var rDst = String(t[4] || '');
		var dp = t[5] || '';
		var pCount = parseInt(t[6]) || 0;
		var bCount = parseInt(t[7]) || 0;
		var mark = parseInt(t[8]) || 0;
		var state = String(t[9] || '');

		normalizedFlows.push({
			key: pStr + '_' + rSrc + ':' + sp + '_' + rDst + ':' + dp,
			proto: pStr,
			family: fam,
			srcRaw: rSrc,
			sport: sp,
			src: formatEndpoint(rSrc, sp),
			dstRaw: rDst,
			dport: dp,
			dst: formatEndpoint(rDst, dp),
			pkts: pCount,
			bytes: bCount,
			mark: mark,
			state: state
		});
	}

	var now = Date.now();
	var dt = (prevFlowsTime > 0) ? (now - prevFlowsTime) / 1000 : 0;
	var nextCache = {};

	normalizedFlows.forEach(function(f) {
		f.dscpMeta = getDscpMeta(f.mark);
		var pf = prevFlowsCache[f.key];
		f.bps = 0;
		f.pps = 0;
		if (pf && dt > 0.2) {
			f.bps = Math.max(0, (f.bytes - pf.bytes) * 8 / dt);
			f.pps = Math.max(0, (f.pkts - pf.pkts) / dt);
		}
		nextCache[f.key] = { bytes: f.bytes, pkts: f.pkts };
	});
	prevFlowsCache = nextCache;
	prevFlowsTime = now;

	var unknownPrivateIpFound = false;
	var calcGlobalRate = 0;
	var calcGlobalPps = 0;
	var tcpCount = 0;
	var udpCount = 0;
	var v4Count = 0;
	var v6Count = 0;

	normalizedFlows.forEach(function(f) {
		totalPkts += f.pkts;
		totalBytes += f.bytes;
		calcGlobalRate += (f.bps || 0);
		calcGlobalPps += (f.pps || 0);

		var p = (f.proto || '').toUpperCase();
		if (p === 'TCP') tcpCount++;
		else if (p === 'UDP') udpCount++;

		if (f.family === 'ipv6' || (f.srcRaw && f.srcRaw.indexOf(':') !== -1)) v6Count++;
		else v4Count++;

		var rawSrc = f.srcRaw;
		var dev = ipToDevice[rawSrc] || ipToDevice[normIp(rawSrc)];

		if (!dev && isPrivateIp(rawSrc)) {
			unknownPrivateIpFound = true;
		}

		var clientKey = dev ? (dev.mac || (dev.isRouter ? 'ROUTER_LOCAL' : dev.name)) : rawSrc;
		var clientName = dev ? dev.name : (hostnames[rawSrc] || rawSrc);
		var primaryIp = dev ? (dev.ipv4[0] || compressIPv6(dev.ipv6[0]) || rawSrc) : compressIPv6(rawSrc);

		if (!clientMap[clientKey]) {
			clientMap[clientKey] = {
				key: clientKey,
				mac: dev ? dev.mac : '',
				hostName: clientName,
				ip: primaryIp,
				isDevice: !!dev,
				isRouter: dev ? !!dev.isRouter : false,
				v6Count: dev ? dev.ipv6.length : 0,
				ipv4List: dev ? dev.ipv4 : (rawSrc.indexOf('.') !== -1 ? [rawSrc] : []),
				ipv6List: dev ? dev.ipv6 : (rawSrc.indexOf(':') !== -1 ? [rawSrc] : []),
				totalPkts: 0,
				totalBytes: 0,
				totalBps: 0,
				flowCount: 0,
				protos: {}
			};
		}
		clientMap[clientKey].totalPkts += f.pkts;
		clientMap[clientKey].totalBytes += f.bytes;
		clientMap[clientKey].totalBps += (f.bps || 0);
		clientMap[clientKey].flowCount++;
		clientMap[clientKey].protos[f.proto] = true;
	});
	nssGlobalRateBps = calcGlobalRate;

	var clientsList = Object.keys(clientMap).map(function(k) { return clientMap[k]; });

	if (unknownPrivateIpFound && !isResolvingHints) {
		if (now - lastHintProbeTime > 15000) {
			lastHintProbeTime = now;
			isResolvingHints = true;
			callHostHints().then(function(newHints) {
				if (newHints) {
					setSessionData('nss_host_hints', newHints);
				}
			}).finally(function() {
				isResolvingHints = false;
			});
		}
	}

	d._processed = {
		isInstalled: isInstalled,
		rawFlows: normalizedFlows,
		totalPkts: totalPkts,
		totalBytes: totalBytes,
		clientsList: clientsList,
		normalizedFlows: normalizedFlows,
		hostnames: hostnames,
		ipToDevice: ipToDevice,
		globalRateBps: calcGlobalRate,
		globalPps: calcGlobalPps,
		tcpCount: tcpCount,
		udpCount: udpCount,
		v4Count: v4Count,
		v6Count: v6Count
	};
	return d._processed;
}

function renderClientRateContent(c) {
	return (c.totalBps > 0)
		? E('strong', { 'style': (c.totalBps > 1e6) ? 'color:var(--primary-color-high);' : '' }, [ fmtRate(c.totalBps) ])
		: E('span', { 'style': 'color:var(--text-color-medium);' }, [ '—' ]);
}

function renderClientRow(c, onToggleExpand) {
	var isExpanded = !!expandedClientsMap[c.key];
	var protoBadges = Object.keys(c.protos).sort().map(function(pr) {
		var protoCls = (pr === 'TCP') ? 'badge-info' : (pr === 'UDP') ? 'badge-warning' : 'badge-neutral';
		return badge(protoCls, pr);
	});

	return E('tr', {
		'class': 'tr client-main-row' + (isExpanded ? ' expanded' : ''),
		'data-key': c.key,
		'title': isExpanded ? _('点击收起此终端详情') : _('点击展开此终端详情与地址池'),
		'click': function(ev) {
			if (ev.target.closest('button, a, input')) return;
			expandedClientsMap[c.key] = !isExpanded;
			if (onToggleExpand) onToggleExpand();
		}
	}, [
		E('td', { 'class': 'td', 'style': 'width:210px;' }, [ renderClientCell(c, c.key, onToggleExpand) ]),
		E('td', { 'class': 'td nss-num-cell', 'data-col': 'rate', 'style': 'width:108px;' }, [ renderClientRateContent(c) ]),
		E('td', { 'class': 'td nss-num-cell', 'data-col': 'conns', 'style': 'width:92px;' }, [ c.flowCount + ' ' + _('条连接') ]),
		E('td', { 'class': 'td nss-num-cell', 'data-col': 'pkts', 'style': 'width:115px;' }, [ c.totalPkts.toLocaleString() + ' pkts' ]),
		E('td', { 'class': 'td nss-num-cell', 'data-col': 'bytes', 'style': 'width:96px;' }, [ String.format('%1024.1mB', c.totalBytes) ]),
		E('td', { 'class': 'td', 'data-col': 'protos', 'style': 'width:110px;' }, [
			E('div', { 'style': 'display:inline-flex; gap:4px; flex-wrap:wrap;' }, protoBadges)
		])
	]);
}

function renderFlowProtoContent(f) {
	var protoName = (f.proto || 'TCP').toUpperCase();
	var protoCls = (protoName === 'TCP') ? 'badge-info' : (protoName === 'UDP') ? 'badge-warning' : 'badge-neutral';
	var protoBadge = E('span', {
		'class': 'badge ' + protoCls + ' tcp-proto-badge',
		'title': _('传输层协议: %s').format(protoName)
	}, [ protoName ]);

	var stateMeta = (protoName === 'TCP' && f.state && f.state !== '—')
		? (TCP_STATE_MAP[f.state] || { text: f.state.slice(0, 5), cls: 'badge-neutral', title: _('连接状态: ') + f.state })
		: null;
	var stateBadge = stateMeta ? E('span', {
		'class': 'badge ' + stateMeta.cls + ' tcp-badge-5char',
		'title': stateMeta.title
	}, [ stateMeta.text ]) : '';

	return E('div', { 'style': 'display:inline-flex; align-items:center; gap:3px;' }, [ protoBadge, stateBadge ].filter(Boolean));
}

function renderFlowRateContent(f) {
	var rateText = fmtRate(f.bps || 0);
	var ppsText = fmtPps(f.pps);
	return [
		E('strong', { 'style': (f.bps > 1e6) ? 'color:var(--primary-color-high);' : '' }, [ rateText ]),
		ppsText ? E('span', { 'style': 'font-size:10px; color:var(--text-color-medium); margin-left:4px;' }, [ '(' + ppsText + ')' ]) : ''
	];
}

function renderFlowRow(f, hostnames, ipToDevice) {
	var dev = ipToDevice[f.srcRaw] || ipToDevice[normIp(f.srcRaw)];
	var srcFullName = dev ? (dev.name || dev.mac) : hostnames[f.srcRaw];
	var srcShortName = srcFullName ? srcFullName.replace(/\s*\([^)]*\)$/, '') : '';
	var dstDev = ipToDevice[f.dstRaw] || ipToDevice[normIp(f.dstRaw)];
	var dstFullName = dstDev ? (dstDev.name || dstDev.mac) : hostnames[f.dstRaw];
	var dstShortName = dstFullName ? dstFullName.replace(/\s*\([^)]*\)$/, '') : '';

	var dmeta = f.dscpMeta || getDscpMeta(f.mark);
	var dscpLabel = (dmeta.icon ? (dmeta.icon + ' ') : '') + dmeta.label;
	var dscpEl = E('span', {
		'class': 'badge ' + dmeta.cls,
		'style': 'white-space:nowrap; display:inline-flex; align-items:center; font-size:10px; padding:1px 6px;',
		'title': (dmeta.category ? (dmeta.category + ' • ') : '') + 'mark: ' + (f.mark || 0) + ' (DSCP ' + dmeta.dscp + ')'
	}, [ dscpLabel ]);

	return E('tr', { 'class': 'tr', 'data-key': f.key }, [
		E('td', { 'class': 'td', 'data-col': 'proto', 'style': 'width:98px; padding-left:4px !important; padding-right:4px !important;' }, [ renderFlowProtoContent(f) ]),
		E('td', {
			'class': 'td',
			'style': 'width:185px;',
			'title': (srcFullName ? (srcFullName + ' • ') : '') + (f.src || '-')
		}, [
			srcShortName ? E('strong', { 'style': 'margin-right:5px;' }, [ srcShortName ]) : '',
			E('code', { 'style': 'font-size:11px;' }, [ f.src || '-' ])
		]),
		E('td', {
			'class': 'td',
			'style': 'width:185px;',
			'title': (dstFullName ? (dstFullName + ' • ') : '') + (f.dst || '-')
		}, [
			dstShortName ? E('strong', { 'style': 'margin-right:5px;' }, [ dstShortName ]) : '',
			E('code', { 'style': 'font-size:11px;' }, [ f.dst || '-' ])
		]),
		E('td', { 'class': 'td', 'data-col': 'dscp', 'style': 'width:58px;' }, [ dscpEl ]),
		E('td', { 'class': 'td nss-num-cell', 'data-col': 'rate', 'style': 'width:132px;' }, renderFlowRateContent(f)),
		E('td', { 'class': 'td nss-num-cell', 'data-col': 'pkts', 'style': 'width:86px;' }, [ (f.pkts || 0).toLocaleString() + ' pkts' ]),
		E('td', { 'class': 'td nss-num-cell', 'data-col': 'bytes', 'style': 'width:74px;' }, [ String.format('%1024.1mB', f.bytes || 0) ])
	]);
}

function renderTruncationBanner(isTruncated, showAll, totalCount, onToggle) {
	if (isTruncated) {
		return E('div', { 'class': 'alert-message', 'style': 'margin-top:10px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;' }, [
			E('span', { 'style': 'font-size:12px; color:var(--text-color-medium);' }, [
				_('已根据当前排序展示前 %d 条最活跃流（全网共 %d 条并发流），已降低宿主机渲染负载。').format(MAX_FLOWS_RENDER, totalCount)
			]),
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': function(ev) {
					ev.preventDefault();
					showAllFlows = true;
					if (onToggle) onToggle();
				}
			}, [ _('展开全部 %d 条流').format(totalCount) ])
		]);
	} else if (showAll && totalCount > MAX_FLOWS_RENDER) {
		return E('div', { 'class': 'alert-message', 'style': 'margin-top:10px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;' }, [
			E('span', { 'style': 'font-size:12px; color:var(--text-color-medium);' }, [
				_('当前已展开全部 %d 条硬件流。').format(totalCount)
			]),
			E('button', {
				'class': 'btn cbi-button cbi-button-neutral',
				'click': function(ev) {
					ev.preventDefault();
					showAllFlows = false;
					if (onToggle) onToggle();
				}
			}, [ _('收起为前 100 条 (推荐)') ])
		]);
	}
	return E('div');
}

function patchClientRows(tbody, clientsList, onToggleExpand) {
	patchTableRows(tbody, clientsList, function(c) {
		return renderClientRow(c, onToggleExpand);
	}, function(row, c) {
		var isExp = !!expandedClientsMap[c.key];

		row.classList.toggle('expanded', isExp);
		row.title = isExp ? _('点击收起此终端详情') : _('点击展开此终端详情与地址池');

		var connsTd = row.querySelector('[data-col="conns"]');
		if (connsTd) connsTd.textContent = c.flowCount + ' ' + _('条连接');

		var pktsTd = row.querySelector('[data-col="pkts"]');
		if (pktsTd) pktsTd.textContent = c.totalPkts.toLocaleString() + ' pkts';

		var bytesTd = row.querySelector('[data-col="bytes"]');
		if (bytesTd) bytesTd.textContent = String.format('%1024.1mB', c.totalBytes);

		var rateTd = row.querySelector('[data-col="rate"]');
		if (rateTd) dom.content(rateTd, [ renderClientRateContent(c) ]);

		var protoDiv = row.querySelector('[data-col="protos"] > div');
		if (protoDiv) {
			var protoBadges = Object.keys(c.protos).sort().map(function(pr) {
				var protoCls = (pr === 'TCP') ? 'badge-info' : (pr === 'UDP') ? 'badge-warning' : 'badge-neutral';
				return badge(protoCls, pr);
			});
			dom.content(protoDiv, protoBadges);
		}

		var triggerBox = row.querySelector('.client-trigger-box');
		if (triggerBox) {
			triggerBox.classList.toggle('no-hover', isExp);
			var expandBadge = triggerBox.querySelector('.client-expand-badge');
			if (expandBadge) {
				expandBadge.className = 'badge ' + (isExp ? 'badge-info' : 'badge-neutral') + ' client-expand-badge';
				var arrowSpan = expandBadge.querySelector('span');
				if (arrowSpan) arrowSpan.textContent = isExp ? '▾' : '▸';
			}
		}
	}, _('当前暂无活跃的客户端硬件加速流'), 6);

	clientsList.forEach(function(c) {
		var isExp = !!expandedClientsMap[c.key];
		var detailRow = tbody.querySelector('tr[data-expand-for="' + c.key + '"]');
		var mainRow = tbody.querySelector('tr[data-key="' + c.key + '"]');
		if (isExp && !detailRow && mainRow) {
			mainRow.insertAdjacentElement('afterend', renderExpandRow(c, 6, c.key, onToggleExpand));
		} else if (isExp && detailRow && mainRow) {
			var detailTd = detailRow.querySelector('td');
			if (detailTd) {
				dom.content(detailTd, [ renderItemExpandPanel(c, function() {
					expandedClientsMap[c.key] = false;
					if (onToggleExpand) onToggleExpand();
				}) ]);
			}
			mainRow.insertAdjacentElement('afterend', detailRow);
		} else if (!isExp && detailRow) {
			detailRow.parentNode.removeChild(detailRow);
		}
	});
}

function patchFlowRows(tbody, flowsToRender, hostnames, ipToDevice) {
	patchTableRows(tbody, flowsToRender, function(f) {
		return renderFlowRow(f, hostnames, ipToDevice);
	}, function(row, f) {
		var protoTd = row.querySelector('[data-col="proto"]');
		if (protoTd) dom.content(protoTd, [ renderFlowProtoContent(f) ]);

		var pktsTd = row.querySelector('[data-col="pkts"]');
		if (pktsTd) pktsTd.textContent = (f.pkts || 0).toLocaleString() + ' pkts';

		var bytesTd = row.querySelector('[data-col="bytes"]');
		if (bytesTd) bytesTd.textContent = String.format('%1024.1mB', f.bytes || 0);

		var flowRateTd = row.querySelector('[data-col="rate"]');
		if (flowRateTd) dom.content(flowRateTd, renderFlowRateContent(f));
	}, _('当前分类下暂无活跃硬件加速流'), 7);
}

function renderFlowsCard(d, onSubTabSwitch, hostHints, onRefreshToggle, onProbeTrigger) {
	var processed = processFlowsData(d, hostHints);
	var isInstalled = processed.isInstalled;
	var rawFlows = processed.rawFlows;
	var totalPkts = processed.totalPkts;
	var totalBytes = processed.totalBytes;
	var clientsList = processed.clientsList;
	var normalizedFlows = processed.normalizedFlows;
	var hostnames = processed.hostnames;
	var ipToDevice = processed.ipToDevice;

	var scrollWrapAttrs = makeScrollWrapAttrs('flows-scroll-wrap', onRefreshToggle);

	var filteredFlows = getFilteredFlows(normalizedFlows, flowSubTab, hostnames);
	var clientsListSorted = clientsList.slice();
	sortTableItems(clientsListSorted, CLIENT_COLS, clientSortKey, clientSortDir);
	sortTableItems(filteredFlows, FLOW_COLS, flowSortKey, flowSortDir);

	var clientHeaders = renderTableHeaders(CLIENT_COLS, clientSortKey, clientSortDir, function(k, d) {
		clientSortKey = k; clientSortDir = d;
		if (onSubTabSwitch) onSubTabSwitch();
	});

	var flowHeaders = renderTableHeaders(FLOW_COLS, flowSortKey, flowSortDir, function(k, d) {
		flowSortKey = k; flowSortDir = d;
		if (onSubTabSwitch) onSubTabSwitch();
	});

	var flowFilterRow = renderTableFilters(FLOW_COLS, flowColFilters, function() {
		updateFlowsTable(secTable.parentNode || document, d, hostHints, onSubTabSwitch);
	});

	var subTabItems = [
		{ id: 'clients', label: _('客户端聚合') },
		{ id: 'all',     label: _('全量明细') },
		{ id: 'ipv4',    label: _('IPv4 流') },
		{ id: 'ipv6',    label: _('IPv6 流') }
	].map(function(tab) {
		var isActive = (flowSubTab === tab.id);
		return E('li', {
			'class': isActive ? 'cbi-tab' : 'cbi-tab-disabled',
			'data-tab': tab.id
		}, [
			E('a', {
				'href': '#',
				'click': function(ev) {
					ev.preventDefault();
					if (flowSubTab === tab.id) return;
					flowSubTab = tab.id;
					if (onSubTabSwitch) onSubTabSwitch();
				}
			}, [ tab.label ])
		]);
	});

	var subTabMenu = E('ul', {
		'class': 'cbi-tabmenu',
		'style': 'margin-bottom: 12px;'
	}, subTabItems);

	var tableBody;
	if (!isInstalled) {
		sessionStorage.setItem('nss_flows_installed', '0');
		tableBody = E('div', { 'class': 'alert-message notice', 'style': 'margin:14px; text-align:center; padding:18px;' }, [
			E('strong', { 'style': 'font-size:14px; display:block; margin-bottom:8px;' }, [ _('提示：当前固件未安装 nssqos 扩展组件，硬件流表不可用') ]),
			E('p', { 'style': 'margin-top:6px; color:var(--text-color-medium); font-size:12px; line-height:1.6;' }, [
				_('硬件流表连接明细依赖 nssqos-conns 工具。该工具为可选特性组件，不影响底层 NSS 硬件网络加速核心线速转发功能。若需使用此大盘，可在编译配置中添加 nssqos 包。')
			]),
			E('p', { 'style': 'margin-top:6px; font-size:11px; color:var(--text-color-low);' }, [
				_('系统已自动触发会话级防御熔断，已停止后台流表周期轮询 (0 后台开销)。')
			]),
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'style': 'margin-top:12px;',
				'click': function(ev) {
					ev.preventDefault();
					sessionStorage.removeItem('nss_flows_installed');
					if (onProbeTrigger) onProbeTrigger();
				}
			}, [ _('手动探活与重检 (Half-Open Probe)') ])
		]);
	} else if (flowSubTab === 'clients') {
		var clientRows = [];
		clientsListSorted.forEach(function(c) {
			clientRows.push(renderClientRow(c, onSubTabSwitch));
			if (expandedClientsMap[c.key]) {
				clientRows.push(renderExpandRow(c, 6, c.key, onSubTabSwitch));
			}
		});

		if (!clientRows.length) {
			clientRows = [
				E('tr', { 'class': 'tr tr-empty-placeholder', 'data-empty': 'true' }, [
					E('td', { 'class': 'td', 'colspan': '6', 'style': 'text-align:center; color:var(--text-color-medium);' }, [
						_('当前暂无活跃的客户端硬件加速流')
					])
				])
			];
		}

		tableBody = E('div', scrollWrapAttrs, [
			E('table', { 'class': 'table nss-fixed-table' }, [
				E('thead', {}, [ E('tr', { 'class': 'tr table-titles' }, clientHeaders) ]),
				E('tbody', { 'id': 'flows-tbody', 'data-subtab': 'clients' }, clientRows)
			])
		]);
	} else {
		var isTruncated = (!showAllFlows && filteredFlows.length > MAX_FLOWS_RENDER);
		var flowsToRender = isTruncated ? filteredFlows.slice(0, MAX_FLOWS_RENDER) : filteredFlows;

		var flowRows = flowsToRender.map(function(f) {
			return renderFlowRow(f, hostnames, ipToDevice);
		});

		if (!flowRows.length) {
			flowRows = [
				E('tr', { 'class': 'tr tr-empty-placeholder', 'data-empty': 'true' }, [
					E('td', { 'class': 'td', 'colspan': '7', 'style': 'text-align:center; color:var(--text-color-medium);' }, [
						_('当前分类下暂无活跃硬件加速流')
					])
				])
			];
		}

		tableBody = E('div', scrollWrapAttrs, [
			E('table', { 'class': 'table nss-fixed-table' }, [
				E('thead', {}, [ E('tr', { 'class': 'tr table-titles' }, flowHeaders), flowFilterRow ]),
				E('tbody', { 'id': 'flows-tbody', 'data-subtab': flowSubTab }, flowRows)
			]),
			E('div', { 'id': 'flows-truncation-bar' }, [
				renderTruncationBanner(isTruncated, showAllFlows, filteredFlows.length, onSubTabSwitch)
			])
		]);
	}

	var noticeBanner = E('div', { 'class': 'nss-notice-banner' }, [
		E('div', {}, [
			E('strong', {}, [ '💡 ' + _('实时调度说明：') ]),
			_('鼠标移入下方表格任意区域自动挂起轮询刷新，移出表格自动恢复实时数据流；可点击常驻栏切换常亮或暂停档位。')
		]),
		E('div', { 'style': 'font-weight:600; color:var(--text-color-high); white-space:nowrap;' }, [
			isInstalled ? (_('全网共 %d 条活跃加速流').format(rawFlows.length)) : ''
		])
	]);

	var scrollProxyInner = E('div', { 'style': 'width: ' + (flowSubTab === 'clients' ? '740px' : '820px') + '; height: 1px;' });
	var scrollProxy = E('div', { 'class': 'nss-scroll-proxy' }, [ scrollProxyInner ]);

	var scrollSyncLock = false;

	var mainSection = E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', { 'title': _('实时采集自内核 Netfilter Conntrack 与高通 NSS ECM 硬件卸载引擎。每 4 秒采样一次活跃双向会话并过滤 0 报文静止流，呈现真实的线速流量拓扑。'), 'style': 'cursor:help;' }, [ _('NSS 硬件流表与连接概况') ]),
			E('span', { 'id': 'flows-summary-badge' }, [
				badge('badge-info', isInstalled ? (rawFlows.length + ' ' + _('活动流')) : _('未安装 nssqos'))
			])
		]),
		isInstalled ? E('div', { 'class': 'cbi-section-node', 'style': 'margin-bottom: 12px;' }, [
			E('table', { 'class': 'table', 'style': 'margin-bottom:0;' }, [
				E('tbody', {}, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:16%; font-size:12px; color:var(--text-color-medium);' }, [ _('硬件加速连接总数') ]),
						E('td', { 'class': 'td left nss-num-cell', 'id': 'flows-total-conns', 'style': 'width:17%; font-weight:700; color:var(--primary-color-high);' }, [
							rawFlows.length + ' ' + _('条并发流')
						]),
						E('td', { 'class': 'td left', 'style': 'width:16%; font-size:12px; color:var(--text-color-medium);' }, [ _('实时硬件线速吞吐') ]),
						E('td', { 'class': 'td left nss-num-cell', 'id': 'flows-global-rate', 'style': 'width:17%; font-weight:700;' }, [
							fmtRate(processed.globalRateBps) + (processed.globalPps > 0 ? (' (' + fmtPps(processed.globalPps) + ')') : '')
						]),
						E('td', { 'class': 'td left', 'style': 'width:16%; font-size:12px; color:var(--text-color-medium);' }, [ _('传输层协议分布') ]),
						E('td', { 'class': 'td left nss-num-cell', 'id': 'flows-proto-dist', 'style': 'width:18%; font-weight:600;' }, [
							'TCP: ' + processed.tcpCount + ' · UDP: ' + processed.udpCount
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:16%; font-size:12px; color:var(--text-color-medium);' }, [ _('双栈拓扑连接') ]),
						E('td', { 'class': 'td left nss-num-cell', 'id': 'flows-stack-dist', 'style': 'width:17%; font-weight:600;' }, [
							'IPv4: ' + processed.v4Count + ' · IPv6: ' + processed.v6Count
						]),
						E('td', { 'class': 'td left', 'style': 'width:16%; font-size:12px; color:var(--text-color-medium);' }, [ _('活跃在线终端') ]),
						E('td', { 'class': 'td left nss-num-cell', 'id': 'flows-active-clients', 'style': 'width:17%; font-weight:600;' }, [
							clientsList.length + ' ' + _('台设备')
						]),
						E('td', { 'class': 'td left', 'style': 'width:16%; font-size:12px; color:var(--text-color-medium);' }, [ _('累计硬件转发量') ]),
						E('td', { 'class': 'td left nss-num-cell', 'id': 'flows-total-pkts-bytes', 'style': 'width:18%;' }, [
							totalPkts.toLocaleString() + ' pkts (' + String.format('%1024.1mB', totalBytes) + ')'
						])
					])
				])
			])
		]) : E('div'),
		isInstalled ? subTabMenu : E('div'),
		isInstalled ? noticeBanner : E('div'),
		isInstalled ? scrollProxy : E('div'),
		E('div', { 'class': 'cbi-section-node' }, [ tableBody ])
	]);

	scrollProxy.addEventListener('scroll', function() {
		if (scrollSyncLock) return;
		scrollSyncLock = true;
		var wrap = mainSection.querySelector('#flows-scroll-wrap');
		if (wrap) wrap.scrollLeft = scrollProxy.scrollLeft;
		scrollSyncLock = false;
	}, { passive: true });

	setTimeout(function() {
		var wrap = mainSection.querySelector('#flows-scroll-wrap');
		if (wrap) {
			wrap.addEventListener('scroll', function() {
				if (scrollSyncLock) return;
				scrollSyncLock = true;
				scrollProxy.scrollLeft = wrap.scrollLeft;
				scrollSyncLock = false;
			}, { passive: true });
		}
	}, 0);

	return mainSection;
}

function updateFlowsTable(subCardContainer, flowsData, hostHintsData, onSubTabSwitch) {
	var tbody = subCardContainer.querySelector('#flows-tbody');
	if (!tbody) return;

	var processed = processFlowsData(flowsData, hostHintsData);
	if (!processed.isInstalled) return;

	var badgeEl = subCardContainer.querySelector('#flows-summary-badge');
	if (badgeEl) dom.content(badgeEl, [ badge('badge-info', processed.rawFlows.length + ' ' + _('活动流')) ]);

	var connsEl = subCardContainer.querySelector('#flows-total-conns');
	if (connsEl) connsEl.textContent = processed.rawFlows.length + ' ' + _('条并发流');

	var rateEl = subCardContainer.querySelector('#flows-global-rate');
	if (rateEl) rateEl.textContent = fmtRate(processed.globalRateBps) + (processed.globalPps > 0 ? (' (' + fmtPps(processed.globalPps) + ')') : '');

	var protoEl = subCardContainer.querySelector('#flows-proto-dist');
	if (protoEl) protoEl.textContent = 'TCP: ' + processed.tcpCount + ' · UDP: ' + processed.udpCount;

	var stackEl = subCardContainer.querySelector('#flows-stack-dist');
	if (stackEl) stackEl.textContent = 'IPv4: ' + processed.v4Count + ' · IPv6: ' + processed.v6Count;

	var clientsEl = subCardContainer.querySelector('#flows-active-clients');
	if (clientsEl) clientsEl.textContent = processed.clientsList.length + ' ' + _('台设备');

	var pktsBytesEl = subCardContainer.querySelector('#flows-total-pkts-bytes');
	if (pktsBytesEl) pktsBytesEl.textContent = processed.totalPkts.toLocaleString() + ' pkts (' + String.format('%1024.1mB', processed.totalBytes) + ')';

	if (flowSubTab === 'clients') {
		var clientsListSorted = processed.clientsList.slice();
		sortTableItems(clientsListSorted, CLIENT_COLS, clientSortKey, clientSortDir);
		patchClientRows(tbody, clientsListSorted, onSubTabSwitch);
	} else {
		var filtered = getFilteredFlows(processed.normalizedFlows, flowSubTab, processed.hostnames);
		sortTableItems(filtered, FLOW_COLS, flowSortKey, flowSortDir);
		var isTruncated = (!showAllFlows && filtered.length > MAX_FLOWS_RENDER);
		var flowsToRender = isTruncated ? filtered.slice(0, MAX_FLOWS_RENDER) : filtered;

		patchFlowRows(tbody, flowsToRender, processed.hostnames, processed.ipToDevice);

		var truncEl = subCardContainer.querySelector('#flows-truncation-bar');
		if (truncEl) {
			dom.content(truncEl, [ renderTruncationBanner(isTruncated, showAllFlows, filtered.length, onSubTabSwitch) ]);
		}
	}
}
// ── 7. 子卡 E：流量档案与长期审计 (Traffic Audit) ──
var AUDIT_COLS = [
	{ key: 'client', width: '220px', title: _('终端设备'), hint: _('局域网在线设备，点击「▼ +N IPv6」可展开完整 IPv6 地址池'), num: false, get: function(c) { return (c.hostName || '') + ' ' + (c.mac || ''); } },
	{ key: 'rx',     width: '150px', title: _('下行流量'), hint: _('该终端累计接收的网络下行数据量 (包含 NSS 硬件加速流量)'), num: true,  get: function(c) { return c.rx || 0; } },
	{ key: 'tx',     width: '125px', title: _('上行流量'), hint: _('该终端累计发送的网络上行数据量 (包含 NSS 硬件加速流量)'), num: true,  get: function(c) { return c.tx || 0; } },
	{ key: 'total',  width: '125px', title: _('总流量'),   hint: _('该终端上行与下行双向累计网络吞吐总量'), num: true,  get: function(c) { return c.total || 0; } },
	{ key: 'conns',  width: '120px', title: _('历史会话'), hint: _('审计周期内该设备建立的 TCP/UDP 历史连接会话总数'), num: true,  get: function(c) { return c.conns || 0; } }
];

function renderAuditRankBars(topClients, grandTotal) {
	if (!topClients || !topClients.length) return E('div');

	var colors = [
		'var(--primary-color-high, #1976d2)',
		'var(--success-color-high, #00ac59)',
		'var(--warn-color-high, #efbd0b)',
		'#78909c', '#90a4ae'
	];

	return E('div', { 'class': 'nss-audit-rank-box' }, topClients.map(function(c, idx) {
		var pct = grandTotal > 0 ? (c.total / grandTotal * 100) : 0;
		var pctStr = pct.toFixed(1) + '%';
		var bytesStr = String.format('%1024.1mB', c.total);
		var label = c.hostName || c.mac || '-';

		return E('div', { 'class': 'nss-rank-row' }, [
			E('span', { 'class': 'nss-rank-name', 'title': c.mac || label }, [ label ]),
			E('div', { 'class': 'nss-bar nss-rank-bar' }, [
				E('div', {
					'class': 'nss-bar-fill',
					'style': 'width:' + pct.toFixed(1) + '%; background:' + colors[idx] + ';'
				})
			]),
			E('span', { 'class': 'nss-rank-val' }, [ bytesStr + ' (' + pctStr + ')' ])
		]);
	}));
}

function renderAuditCard(auditData, hostHintsData, onRefreshToggle, onSortSwitch) {
	if (!auditData || auditData.installed === 0) {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', { 'class': 'cbi-section-title' }, [
				E('span', {}, [ _('流量档案与长期审计') ]),
				badge('badge-neutral', _('未运行 nlbwmon'))
			]),
			E('div', { 'class': 'cbi-section-node' }, [
				E('div', { 'class': 'alert-message notice', 'style': 'margin:14px; text-align:center; padding:18px;' }, [
					E('strong', { 'style': 'font-size:14px; display:block; margin-bottom:8px;' }, [ _('提示：当前固件未安装或未运行 nlbwmon 流量审计组件') ]),
					E('p', { 'style': 'margin-top:6px; color:var(--text-color-medium); font-size:12px; line-height:1.6;' }, [
						_('流量档案依赖系统 nlbwmon 核心提供内存级 (-Z 零闪存磨损) 长期会话流量归档。若需启用此子卡，可在系统中配置启用 nlbwmon。')
					])
				])
			])
		]);
	}

	var raw = auditData.audit || {};
	var cols = raw.columns || [];
	var data = raw.data || [];

	var macIdx = cols.indexOf('mac');
	var connsIdx = cols.indexOf('conns');
	var rxBytesIdx = cols.indexOf('rx_bytes');
	var txBytesIdx = cols.indexOf('tx_bytes');

	var totalRx = 0, totalTx = 0, totalConns = 0;
	var clientAuditList = [];

	data.forEach(function(row) {
		var mac = (row[macIdx] || '').toLowerCase();
		if (!mac || mac === '00:00:00:00:00:00') return;

		var conns = parseInt(row[connsIdx]) || 0;
		var rx = parseInt(row[rxBytesIdx]) || 0;
		var tx = parseInt(row[txBytesIdx]) || 0;
		var total = rx + tx;

		totalRx += rx;
		totalTx += tx;
		totalConns += conns;

		var dev = (hostHintsData && (hostHintsData[mac] || hostHintsData[mac.toUpperCase()])) || null;
		var hostName = dev ? (dev.name || '').replace(/\.lan$/i, '') : '';
		if (!hostName && dev && dev.ipaddrs && dev.ipaddrs.length) hostName = dev.ipaddrs[0];
		if (!hostName) hostName = mac.toUpperCase();
		var primaryIp = dev ? ((dev.ipaddrs && dev.ipaddrs[0]) || '-') : '-';

		clientAuditList.push({
			key: mac,
			mac: mac.toUpperCase(),
			hostName: hostName,
			ip: primaryIp,
			v6Count: dev ? (dev.ip6addrs || []).length : 0,
			ipv4List: dev ? dev.ipaddrs : [],
			ipv6List: dev ? dev.ip6addrs : [],
			conns: conns,
			rx: rx,
			tx: tx,
			total: total
		});
	});

	var grandTotal = totalRx + totalTx;

	sortTableItems(clientAuditList, AUDIT_COLS, auditSortKey, auditSortDir);
	var auditHeaders = renderTableHeaders(AUDIT_COLS, auditSortKey, auditSortDir, function(k, d) {
		auditSortKey = k; auditSortDir = d;
		if (onSortSwitch) onSortSwitch();
	});

	var topClients = clientAuditList.slice(0, 5);

	var rows = clientAuditList.map(function(c) {
		var rxPct = grandTotal > 0 ? ((c.rx / grandTotal) * 100).toFixed(1) : '0.0';
		var isExpanded = !!expandedClientsMap['audit_' + c.mac];

		var mainRow = E('tr', {
			'class': 'tr client-main-row' + (isExpanded ? ' expanded' : ''),
			'data-key': c.key,
			'title': isExpanded ? _('点击收起此终端详情') : _('点击展开此终端详情与地址池'),
			'click': function(ev) {
				if (ev.target.closest('button, a, input')) return;
				expandedClientsMap['audit_' + c.mac] = !isExpanded;
				if (onSortSwitch) onSortSwitch();
			}
		}, [
			E('td', { 'class': 'td', 'style': 'width:220px;' }, [ renderClientCell(c, 'audit_' + c.mac, onSortSwitch) ]),
			E('td', { 'class': 'td nss-num-cell', 'style': 'width:150px;' }, [
				String.format('%1024.1mB', c.rx),
				E('span', { 'style': 'font-size:10px; color:var(--text-color-medium); margin-left:4px;' }, [ '(' + rxPct + '%)' ])
			]),
			E('td', { 'class': 'td nss-num-cell', 'style': 'width:125px;' }, [ String.format('%1024.1mB', c.tx) ]),
			E('td', { 'class': 'td nss-num-cell', 'style': 'width:125px;' }, [
				E('strong', { 'style': 'color:var(--primary-color-high);' }, [ String.format('%1024.1mB', c.total) ])
			]),
			E('td', { 'class': 'td nss-num-cell', 'style': 'width:120px;' }, [ c.conns.toLocaleString() ])
		]);

		if (isExpanded) {
			return [ mainRow, renderExpandRow(c, 5, 'audit_' + c.mac, onSortSwitch) ];
		}
		return [ mainRow ];
	});
	rows = [].concat.apply([], rows);

	if (!rows.length) {
		rows = [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'colspan': '5', 'style': 'text-align:center; color:var(--text-color-medium);' }, [
					_('当前暂未采集到终端历史流量数据')
				])
			])
		];
	}

	var summarySec = E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('流量档案与长期审计') ]),
			badge('badge-success', clientAuditList.length + ' ' + _('活跃终端'), true)
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('table', { 'class': 'table', 'style': 'margin-bottom:0;' }, [
				E('tbody', {}, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:25%; font-weight:600;' }, [ _('审计周期总流量') ]),
						E('td', { 'class': 'td left nss-num-cell', 'style': 'width:25%; font-weight:bold;' }, [ String.format('%1024.1mB', grandTotal) ]),
						E('td', { 'class': 'td left', 'style': 'width:25%; font-weight:600;' }, [ _('累计下行 / 累计上行') ]),
						E('td', { 'class': 'td left nss-num-cell', 'style': 'width:25%;' }, [
							String.format('%1024.1mB', totalRx) + ' / ' + String.format('%1024.1mB', totalTx)
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:25%; font-weight:600;' }, [ _('追踪会话总数') ]),
						E('td', { 'class': 'td left nss-num-cell', 'style': 'width:25%;' }, [ totalConns.toLocaleString() + ' ' + _('条会话') ]),
						E('td', { 'class': 'td left', 'style': 'width:25%; font-weight:600;' }, [ _('统计引擎') ]),
						E('td', { 'class': 'td left', 'style': 'width:25%;' }, [
							badge('badge-info', 'nlbwmon (tmpfs 内存级零磨损)')
						])
					])
				])
			])
		])
	]);

	var chartSec = topClients.length ? E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('Top 5 终端用量分布') ])
		]),
		E('div', { 'class': 'cbi-section-node', 'style': 'padding:12px 14px;' }, [
			renderAuditRankBars(topClients, grandTotal)
		])
	]) : E('div');

	var tableSec = E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('终端长期流量明细账单') ])
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('div', makeScrollWrapAttrs('audit-scroll-wrap', onRefreshToggle), [
				E('table', { 'class': 'table nss-fixed-table' }, [
					E('thead', {}, [
						E('tr', { 'class': 'tr table-titles' }, auditHeaders)
					]),
					E('tbody', {}, rows)
				])
			])
		]),
		E('div', { 'class': 'cbi-map-descr', 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:6px;' }, [
			_('说明: 流量档案数据直接映射自 nlbwmon 内存驻留数据库 (-Z)，无闪存擦写开销；点击设备单元格可展开对应终端的多网卡与地址池。')
		])
	]);

	return E('div', {}, [ summarySec, chartSec, tableSec ]);
}

// ── 8. SPA 统一主入口视图 ──
return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callGetProfile(), {}),
			L.resolveDefault(callGetMetrics(), {}),
			L.resolveDefault(callGetSettings(), {})
		]);
	},

	render: function(initData) {
		ensureCss();

		var profileData   = initData[0] || {};
		var metricsData   = initData[1] || {};
		var settingsData  = initData[2] || {};
		var portsData     = null;
		var flowsData     = null;
		var auditData     = null;
		var hostHintsData = getSessionData('nss_host_hints');

		sampleMetricsRate(metricsData.nss_bytes);

		if (profileData.router) {
			setSessionData('nss_router_device', profileData.router);
		}

		if (!staticProfile && profileData.soc) {
			staticProfile = profileData;
		}
		var p = staticProfile || profileData;

		var hash = (window.location.hash || '').replace('#', '');
		if (hash && ['status', 'control', 'ports', 'flows', 'audit'].indexOf(hash) !== -1) {
			activeTab = hash;
		} else {
			var path = window.location.pathname || '';
			if (path.indexOf('/control') !== -1) activeTab = 'control';
			else if (path.indexOf('/ports') !== -1) activeTab = 'ports';
			else if (path.indexOf('/flows') !== -1) activeTab = 'flows';
			else if (path.indexOf('/audit') !== -1) activeTab = 'audit';
			else activeTab = 'status';
		}

		var stickyBarContainer = E('div');
		var conflictContainer = E('div', {}, [ renderConflictBanner(metricsData) ]);

		function triggerForceRefresh() {
			if (isRefreshing) return;
			isRefreshing = true;
			renderSticky();

			try { sessionStorage.removeItem('nss_host_hints'); } catch (e) {}
			hostHintsData = null;

			forceUpdate().finally(function() {
				setTimeout(function() {
					isRefreshing = false;
					renderSticky();
				}, 400);
			});
		}

		function renderSticky() {
			dom.content(stickyBarContainer, renderStickyBar(metricsData, p, function() {
				renderSticky();
			}, function() {
				triggerForceRefresh();
			}));
		}
		renderSticky();

		// 清理旧的全局监听器，杜绝 SPA 路由重入时的监听器累积泄漏
		if (window._nssCleanupListeners) {
			try { window._nssCleanupListeners(); } catch (e) {}
		}

		var onVisibilityChange = function() {
			isPageVisible = !document.hidden;
			renderSticky();
			if (isPageVisible && pollMode !== 'paused' && !isTableHovered) {
				update();
			}
		};

		var onWindowBlur = function() {
			if (pollMode === 'auto' && !isIdleBackoff) {
				isIdleBackoff = true;
				renderSticky();
			}
		};

		var onWindowFocus = function() {
			lastUserActionTime = Date.now();
			if (isIdleBackoff) {
				isIdleBackoff = false;
				renderSticky();
				if (isPageVisible && pollMode !== 'paused' && !isTableHovered) {
					forceUpdate();
				}
			}
		};

		var onUserActivity = function() {
			lastUserActionTime = Date.now();
			if (isIdleBackoff) {
				isIdleBackoff = false;
				renderSticky();
			}
		};

		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('blur', onWindowBlur);
		window.addEventListener('focus', onWindowFocus);
		['mousemove', 'keydown', 'click', 'scroll'].forEach(function(evtName) {
			window.addEventListener(evtName, onUserActivity, { passive: true });
		});

		window._nssCleanupListeners = function() {
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('blur', onWindowBlur);
			window.removeEventListener('focus', onWindowFocus);
			['mousemove', 'keydown', 'click', 'scroll'].forEach(function(evtName) {
				window.removeEventListener(evtName, onUserActivity);
			});
		};

		var subCardContainer = E('div', { 'id': 'nss-subcard-mount' });

		var subTabsDef = [
			{ id: 'status',  label: _('状态总览') },
			{ id: 'control', label: _('控制防御') },
			{ id: 'ports',   label: _('端口线速') },
			{ id: 'flows',   label: _('硬件流表') },
			{ id: 'audit',   label: _('流量档案') }
		];

		var tabMenuContainer = E('ul', { 'class': 'cbi-tabmenu' });

		function renderSubTabs() {
			var items = subTabsDef.map(function(tDef) {
				var isActive = (activeTab === tDef.id);
				return E('li', {
					'class': isActive ? 'cbi-tab' : 'cbi-tab-disabled',
					'data-tab': tDef.id
				}, [
					E('a', {
						'href': '#' + tDef.id,
						'click': function(ev) {
							ev.preventDefault();
							if (activeTab === tDef.id) return;
							activeTab = tDef.id;
							window.location.hash = activeTab;
							renderSubTabs();
							renderActiveCard();
						}
					}, [ tDef.label ])
				]);
			});
			dom.content(tabMenuContainer, items);
		}

		function refreshFlows(isIncremental) {
			var curWrap = subCardContainer.querySelector('#flows-scroll-wrap');
			var curScroll = curWrap ? curWrap.scrollLeft : 0;
			var tbody = subCardContainer.querySelector('#flows-tbody');
			var existingSubTab = tbody ? tbody.getAttribute('data-subtab') : null;

			if (isIncremental && tbody && existingSubTab === flowSubTab) {
				updateFlowsTable(subCardContainer, flowsData, hostHintsData, function() { refreshFlows(false); });
			} else {
				dom.content(subCardContainer, renderFlowsCard(flowsData, function() { refreshFlows(false); }, hostHintsData, renderSticky, function() {
					dom.content(subCardContainer, E('p', { 'class': 'spinning' }, [ _('正在重检 nssqos 组件可用性…') ]));
					Promise.all([
						L.resolveDefault(callGetFlows(), {}),
						L.resolveDefault(callHostHints(), {})
					]).then(function(res) {
						flowsData = res[0] || {};
						hostHintsData = res[1] || {};
						if (flowsData.installed === 0) {
							sessionStorage.setItem('nss_flows_installed', '0');
						} else {
							sessionStorage.setItem('nss_flows_installed', '1');
						}
						refreshFlows(false);
					});
				}));
			}
			var afterWrap = subCardContainer.querySelector('#flows-scroll-wrap');
			if (afterWrap && curScroll > 0) afterWrap.scrollLeft = curScroll;
		}

		function renderActiveCard() {
			if (activeTab === 'status') {
				dom.content(subCardContainer, renderStatusCard(metricsData, p));
			} else if (activeTab === 'control') {
				dom.content(subCardContainer, renderControlCard(settingsData, metricsData, p, renderSticky));
			} else if (activeTab === 'ports') {
				if (!portsData) {
					dom.content(subCardContainer, E('p', { 'class': 'spinning' }, [ _('正在按需拉取以太网物理端口数据…') ]));
					callGetPorts().then(function(raw) {
						return fetchPortStats(raw || {});
					}).then(function(pData) {
						portsData = pData;
						dom.content(subCardContainer, renderPortsCard(portsData, renderSticky));
					});
				} else {
					dom.content(subCardContainer, renderPortsCard(portsData, renderSticky));
				}
			} else if (activeTab === 'flows') {
				var flowBreaker = sessionStorage.getItem('nss_flows_installed');
				if (flowBreaker === '0' && flowsData && flowsData.installed === 0) {
					refreshFlows(false);
				} else if (!flowsData) {
					dom.content(subCardContainer, E('p', { 'class': 'spinning' }, [ _('正在按需拉取硬件流表与连接数据…') ]));
					Promise.all([
						L.resolveDefault(callGetFlows(), {}),
						L.resolveDefault(callHostHints(), {})
					]).then(function(res) {
						flowsData = res[0] || {};
						hostHintsData = res[1] || {};
						if (flowsData.installed === 0) {
							sessionStorage.setItem('nss_flows_installed', '0');
						} else {
							sessionStorage.setItem('nss_flows_installed', '1');
						}
						refreshFlows(false);
					});
				} else {
					refreshFlows(false);
				}
			} else if (activeTab === 'audit') {
				if (!auditData) {
					dom.content(subCardContainer, E('p', { 'class': 'spinning' }, [ _('正在按需拉取 nlbwmon 流量档案数据…') ]));
					Promise.all([
						L.resolveDefault(callGetAudit(), {}),
						L.resolveDefault(callHostHints(), {})
					]).then(function(res) {
						auditData = res[0] || {};
						hostHintsData = res[1] || {};
						dom.content(subCardContainer, renderAuditCard(auditData, hostHintsData, renderSticky, function() {
							dom.content(subCardContainer, renderAuditCard(auditData, hostHintsData, renderSticky));
						}));
					});
				} else {
					dom.content(subCardContainer, renderAuditCard(auditData, hostHintsData, renderSticky, function() {
						dom.content(subCardContainer, renderAuditCard(auditData, hostHintsData, renderSticky));
					}));
				}
			}
		}

		renderSubTabs();
		renderActiveCard();

		var forceUpdate = function() {
			var tasks = [ callGetMetrics() ];
			var flowBreaker = sessionStorage.getItem('nss_flows_installed');

			if (activeTab === 'ports') {
				tasks.push(callGetPorts());
			} else if (activeTab === 'flows' && flowBreaker !== '0') {
				tasks.push(callGetFlows());
			} else if (activeTab === 'audit') {
				tasks.push(callGetAudit());
			}
			return Promise.all(tasks).then(function(res) {
				metricsData = res[0] || {};
				sampleMetricsRate(metricsData.nss_bytes);
				renderSticky();
				dom.content(conflictContainer, renderConflictBanner(metricsData));

				if (activeTab === 'status') {
					dom.content(subCardContainer, renderStatusCard(metricsData, p));
				} else if (activeTab === 'ports' && res[1]) {
					return fetchPortStats(res[1]).then(function(pData) {
						portsData = pData;
						var oldWrap = subCardContainer.querySelector('#ports-scroll-wrap');
						var prevScroll = oldWrap ? oldWrap.scrollLeft : 0;
						dom.content(subCardContainer, renderPortsCard(portsData, renderSticky));
						var newWrap = subCardContainer.querySelector('#ports-scroll-wrap');
						if (newWrap && prevScroll > 0) newWrap.scrollLeft = prevScroll;
					});
				} else if (activeTab === 'flows' && res[1]) {
					flowsData = res[1];
					if (res[2]) {
						hostHintsData = res[2];
						setSessionData('nss_host_hints', hostHintsData);
					}
					refreshFlows(true);
				} else if (activeTab === 'audit' && res[1]) {
					auditData = res[1];
					if (res[2]) {
						hostHintsData = res[2];
						setSessionData('nss_host_hints', hostHintsData);
					}
					var oldAuditWrap = subCardContainer.querySelector('#audit-scroll-wrap');
					var prevAuditScroll = oldAuditWrap ? oldAuditWrap.scrollLeft : 0;
					dom.content(subCardContainer, renderAuditCard(auditData, hostHintsData, renderSticky, function() {
						dom.content(subCardContainer, renderAuditCard(auditData, hostHintsData, renderSticky));
					}));
					var newAuditWrap = subCardContainer.querySelector('#audit-scroll-wrap');
					if (newAuditWrap && prevAuditScroll > 0) newAuditWrap.scrollLeft = prevAuditScroll;
				}
			}).catch(function() {});
		};

		var lastFetchTimestamp = 0;
		var isFetchRunning = false;
		var update = function() {
			var now = Date.now();

			if (!isPageVisible || pollMode === 'paused' || isTableHovered) {
				renderSticky();
				return Promise.resolve();
			}

			if (pollMode === 'auto') {
				var idleTime = now - lastUserActionTime;
				if (idleTime > IDLE_TIMEOUT_MS && !isIdleBackoff) {
					isIdleBackoff = true;
					renderSticky();
				}
			} else if (pollMode === 'keep' && isIdleBackoff) {
				isIdleBackoff = false;
				renderSticky();
			}

			var targetIntervalMs = (pollMode === 'auto' && isIdleBackoff) ? (POLL_IDLE_INTERVAL * 1000) : (POLL_NORMAL_INTERVAL * 1000);

			if (isFetchRunning || (now - lastFetchTimestamp < targetIntervalMs)) {
				return Promise.resolve();
			}

			isFetchRunning = true;
			return forceUpdate().finally(function() {
				lastFetchTimestamp = Date.now();
				isFetchRunning = false;
			});
		};

		poll.add(update, 1);

		return E('div', { 'class': 'nss-dashboard-spa cbi-map' }, [
			stickyBarContainer,
			conflictContainer,
			E('div', { 'class': 'cbi-section' }, [
				tabMenuContainer,
				subCardContainer
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
