'use strict';
'require view';
'require rpc';
'require poll';
'require dom';
'require ui';

var callGetProfile = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getProfile'
});

var callGetMetrics = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getMetrics'
});

var callGetStatus = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getStatus'
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

function normIp(ip) {
	if (!ip) return '';
	ip = ip.trim().toLowerCase();
	if (ip.indexOf(':') === -1) return ip;
	var parts = ip.split('::');
	var left = parts[0] ? parts[0].split(':') : [];
	var right = (parts.length > 1 && parts[1]) ? parts[1].split(':') : [];
	var missing = 8 - (left.length + right.length);
	var mid = [];
	for (var i = 0; i < missing; i++) mid.push('0');
	return [].concat(left, mid, right).map(function(hex) {
		return parseInt(hex || '0', 16).toString(16);
	}).join(':');
}

function compressIPv6(ip) {
	if (!ip || ip.indexOf(':') === -1) return ip;
	ip = ip.trim().toLowerCase();
	var parts = ip.split('::');
	var left = parts[0] ? parts[0].split(':') : [];
	var right = (parts.length > 1 && parts[1]) ? parts[1].split(':') : [];
	var missing = 8 - (left.length + right.length);
	var words = [];
	for (var i = 0; i < left.length; i++) words.push(parseInt(left[i] || '0', 16));
	for (var i = 0; i < missing; i++) words.push(0);
	for (var i = 0; i < right.length; i++) words.push(parseInt(right[i] || '0', 16));

	var bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
	for (var i = 0; i < 8; i++) {
		if (words[i] === 0) {
			if (curStart === -1) { curStart = i; curLen = 1; }
			else { curLen++; }
			if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
		} else {
			curStart = -1; curLen = 0;
		}
	}
	if (bestLen < 2) bestStart = -1;

	var hex = words.map(function(w) { return w.toString(16); });
	if (bestStart !== -1) {
		var head = hex.slice(0, bestStart).join(':');
		var tail = hex.slice(bestStart + bestLen).join(':');
		return head + '::' + tail;
	}
	return hex.join(':');
}

function getSessionData(key) {
	try {
		var raw = sessionStorage.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch (e) {
		return null;
	}
}

function setSessionData(key, val) {
	try {
		sessionStorage.setItem(key, JSON.stringify(val));
	} catch (e) {}
}

function isPrivateIp(ip) {
	if (!ip) return false;
	if (ip.indexOf('192.168.') === 0 || ip.indexOf('10.') === 0 || ip.indexOf('127.') === 0) return true;
	if (ip.indexOf('172.') === 0) {
		var p = parseInt(ip.split('.')[1], 10);
		return p >= 16 && p <= 31;
	}
	if (ip.indexOf('fe80:') === 0 || ip.indexOf('fd') === 0 || ip === '::1') return true;
	return false;
}

function helpTip(text) {
	return E('span', {
		'class': 'nss-help-tip',
		'title': text
	}, [ '?' ]);
}

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
var isPaused = false;
var isTableHovered = false;
var isPageVisible = !document.hidden;
var isRefreshing = false;
var expandedClientsMap = {}; // 记录条目级展开状态: { clientKey: true }
var lastUserActionTime = Date.now();
var isIdleBackoff = false;
var IDLE_TIMEOUT_MS = 60000; // 60秒无操作进入挂机退避
var POLL_NORMAL_INTERVAL = 4; // 活跃轮询 4s
var POLL_IDLE_INTERVAL = 12; // 挂机退避 12s



function copyTextToClipboard(text, btnElement, successMsg) {
	if (!text) return Promise.resolve();
	var doFeedback = function() {
		if (btnElement) {
			var origHtml = btnElement.innerHTML;
			btnElement.innerHTML = '✓ ' + (successMsg || _('已复制'));
			btnElement.style.color = 'var(--success-color-high, #00ac59)';
			setTimeout(function() {
				btnElement.innerHTML = origHtml;
				btnElement.style.color = '';
			}, 1200);
		}
	};

	if (navigator.clipboard && window.isSecureContext) {
		return navigator.clipboard.writeText(text).then(doFeedback).catch(function() {
			fallbackCopy(text);
			doFeedback();
		});
	} else {
		fallbackCopy(text);
		doFeedback();
		return Promise.resolve();
	}

	function fallbackCopy(val) {
		var ta = document.createElement('textarea');
		ta.value = val;
		ta.style.position = 'fixed';
		ta.style.left = '-9999px';
		ta.style.top = '-9999px';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		try { document.execCommand('copy'); } catch (err) {}
		document.body.removeChild(ta);
	}
}

function traceFlowByIp(targetIp) {
	if (!targetIp) return;

	// 1. 若当前不在 flows 选项卡，先自动切换至 flows
	if (activeTab !== 'flows') {
		var flowsTabLink = document.querySelector('.cbi-tabmenu a[href="#flows"]');
		if (flowsTabLink) {
			flowsTabLink.click();
		} else {
			activeTab = 'flows';
			window.location.hash = 'flows';
		}
	}

	// 2. 自动切换到底层全量明细或对应 IPv6 流视图
	setTimeout(function() {
		var subTabId = (targetIp.indexOf(':') !== -1) ? 'ipv6' : 'all';
		var subTabLink = document.querySelector('#nss-subcard-mount .cbi-tabmenu [data-tab="' + subTabId + '"] a');
		if (subTabLink) {
			subTabLink.click();
		} else {
			subTabLink = document.querySelector('#nss-subcard-mount .cbi-tabmenu [data-tab="all"] a');
			if (subTabLink) subTabLink.click();
		}

		// 3. 在渲染出的表格中高亮匹配的行并平滑滚动定位
		setTimeout(function() {
			var tbody = document.querySelector('#flows-tbody');
			if (!tbody) return;
			var cleanTarget = normIp(targetIp).toLowerCase();
			var rows = tbody.querySelectorAll('tr[data-key]');
			var matchedRow = null;

			for (var i = 0; i < rows.length; i++) {
				var r = rows[i];
				var key = (r.getAttribute('data-key') || '').toLowerCase();
				var text = r.textContent.toLowerCase();
				if (key.indexOf(cleanTarget) !== -1 || text.indexOf(cleanTarget) !== -1 || text.indexOf(targetIp.toLowerCase()) !== -1) {
					matchedRow = r;
					break;
				}
			}

			if (matchedRow) {
				matchedRow.classList.remove('highlight-row');
				void matchedRow.offsetWidth; // 触发 reflow
				matchedRow.classList.add('highlight-row');
				matchedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		}, 300);
	}, 200);
}

function renderTooltipIpSummary(clientObj) {
	var ipv4List = clientObj.ipv4List || [];
	var ipv6List = clientObj.ipv6List || [];

	var v4Section = (ipv4List.length > 0)
		? E('div', { 'style': 'display:flex; flex-wrap:wrap; gap:4px; max-width:280px;' }, ipv4List.map(function(ip) {
			var note = (ip === '127.0.0.1') ? ' (Loopback)' : (ip.indexOf('100.') === 0) ? ' (WAN)' : (ip === clientObj.ip ? ' (' + _('主/网关') + ')' : '');
			return E('code', { 'style': 'font-size:11px;' }, [ ip + note ]);
		}))
		: (clientObj.ip && clientObj.ip.indexOf(':') === -1 ? E('code', {}, [ clientObj.ip ]) : _('无'));

	var v6Section;
	if (!ipv6List.length) {
		v6Section = (clientObj.ip && clientObj.ip.indexOf(':') !== -1 ? E('code', {}, [ compressIPv6(clientObj.ip) ]) : _('无'));
	} else {
		v6Section = E('div', { 'style': 'display:flex; flex-direction:column; gap:2px; max-width:300px;' }, ipv6List.slice(0, 3).map(function(ip6) {
			return E('code', { 'style': 'font-size:10px; word-break:break-all;' }, [ compressIPv6(ip6) ]);
		}));
		if (ipv6List.length > 3) {
			v6Section.appendChild(E('span', { 'style': 'font-size:10px; color:var(--text-color-medium);' }, [ _('（共 %d 个地址，点击条目中的徽章可在行内展开）').format(ipv6List.length) ]));
		}
	}

	return { v4: v4Section, v6: v6Section };
}

function renderItemExpandPanel(clientObj, onToggle) {
	var ipv4List = clientObj.ipv4List || [];
	var ipv6List = clientObj.ipv6List || [];
	var allIpsText = [].concat(ipv4List, ipv6List.map(compressIPv6)).filter(Boolean).join('\n');

	var panel = E('div', {
		'class': 'client-expand-panel',
		'style': 'padding: 10px 14px; border-radius: 4px; background: var(--background-color-medium, rgba(255,255,255,0.06)); border: 1px solid var(--border-color-medium, rgba(255,255,255,0.12)); display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box;'
	}, [
		E('div', { 'style': 'display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid var(--border-color-medium, rgba(255,255,255,0.1)); padding-bottom: 6px;' }, [
			E('div', { 'style': 'display: flex; align-items: center; gap: 8px;' }, [
				E('strong', { 'style': 'font-size: 12px;' }, [ clientObj.hostName + (clientObj.mac ? (' (' + clientObj.mac.toUpperCase() + ')') : '') ]),
				E('span', { 'class': 'badge badge-info', 'style': 'font-size: 10px;' }, [ _('IPv6 地址池 (%d 个)').format(ipv6List.length) ])
			]),
			E('div', { 'style': 'display: flex; gap: 6px;' }, [
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
		])
	]);

	var ipGrid = E('div', { 'style': 'display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 6px;' });
	ipv6List.forEach(function(ip6) {
		var norm = compressIPv6(ip6);
		var note = (norm === '::1') ? ' (Loopback)' : (ip6.indexOf('fe80:') === 0) ? ' (Link-Local)' : '';
		ipGrid.appendChild(E('div', { 'style': 'display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 6px; background: var(--background-color-low, rgba(0,0,0,0.1)); border-radius: 3px;' }, [
			E('code', { 'style': 'font-size: 11px; word-break: break-all; white-space: nowrap;' }, [ norm + note ]),
			E('div', { 'style': 'display: inline-flex; gap: 4px; flex-shrink: 0;' }, [
				E('button', {
					'class': 'ip-action-btn',
					'title': _('复制此 IPv6 地址'),
					'click': function(ev) {
						ev.stopPropagation();
						copyTextToClipboard(norm, this, 'OK');
					}
				}, [ '📋' ]),
				E('button', {
					'class': 'ip-action-btn',
					'title': _('在流表中查寻此 IP 流量'),
					'click': function(ev) {
						ev.stopPropagation();
						traceFlowByIp(norm);
					}
				}, [ '🎯' ])
			])
		]));
	});
	panel.appendChild(ipGrid);

	return panel;
}
function ensureCss() {
	var id = 'luci-app-nss-dashboard-css';
	var el = document.getElementById(id);
	if (!el) {
		document.head.appendChild(E('link', {
			'id': id,
			'rel': 'stylesheet',
			'type': 'text/css',
			'href': L.resource('view/nss_dashboard/nss.css') + '?v=261017m'
		}));
	} else if (el.href.indexOf('?v=261017m') === -1) {
		el.href = L.resource('view/nss_dashboard/nss.css') + '?v=261017l';
	}
}

function progressbar(value, max, label) {
	if (value === null || value === undefined) {
		return E('div', {
			'class': 'cbi-progressbar disabled',
			'style': 'height:12px; min-width:80px; position:relative; overflow:hidden; margin:0;',
			'title': label || _('待机 (无服务固件或未引导)')
		}, [
			E('span', { 'style': 'position:absolute; width:100%; text-align:center; font-size:10px; font-weight:500; line-height:12px; color:var(--text-color-medium);' }, [
				label || _('休眠待机')
			])
		]);
	}
	var vn = parseFloat(value) || 0,
	    mn = parseFloat(max) || 100,
	    pc = Math.min(100, Math.max(0, Math.floor((100 / mn) * vn)));

	return E('div', {
		'class': 'cbi-progressbar',
		'style': 'height:12px; min-width:80px; position:relative; overflow:hidden; margin:0;',
		'title': '%s%%'.format(vn)
	}, [
		E('div', {
			'style': 'width:%.2f%%; height:100%; transition:width 0.3s ease;'.format(pc),
			'class': (vn > 80) ? 'cbi-progressbar-danger' : (vn > 50) ? 'cbi-progressbar-warn' : ''
		}),
		E('span', { 'style': 'position:absolute; width:100%; text-align:center; font-size:10px; font-weight:bold; line-height:12px;' }, [
			'%s%%'.format(vn)
		])
	]);
}

function badge(cls, text, dot) {
	var children = [];
	if (dot) {
		children.push(E('span', { 'class': 'badge-dot' }));
	}
	if (Array.isArray(text)) {
		children = children.concat(text);
	} else {
		children.push(text);
	}

	return E('span', {
		'class': 'badge ' + (cls || 'badge-neutral')
	}, children);
}

function tempBadge(label, temp) {
	var t = parseFloat(temp) || 0;
	var cls = (t >= 75) ? 'badge-danger' : (t >= 60) ? 'badge-warning' : 'badge-success';

	return E('span', {
		'class': 'badge ' + cls
	}, [
		E('strong', {}, [ label + ':' ]),
		t.toFixed(1) + '°C'
	]);
}

function moduleChip(name, state) {
	var cls, label;
	if (state === 2) {
		cls = 'badge-success';
		label = _('运行中');
	} else if (state === 1) {
		cls = 'badge-info';
		label = _('就绪待命');
	} else {
		cls = 'badge-neutral';
		label = _('未安装');
	}
	return E('span', {
		'class': 'badge ' + cls,
		'title': name + ': ' + label
	}, [
		(state === 2) ? E('span', { 'class': 'badge-dot' }) : '',
		E('strong', {}, [ name + ':' ]),
		label
	]);
}

// ── 1. 顶置常驻微型遥测总线状态栏 (最上方，全局吸顶，永不重新卸载) ──
function renderStickyBar(d, p, onRefreshToggle, onForceRefresh) {
	var t = parseFloat(d.cpu_temp) || 0;
	var tempClass = (t >= 75) ? 'badge-danger' : (t >= 60) ? 'badge-warning' : 'badge-success';
	var soc = p.soc || d.soc || 'IPQ8074';
	var cores = p.cores || d.cores || 2;
	var freqStr = (p.nss_freq || d.nss_freq || '1478.4 MHz').replace(' MHz', 'M');
	var totalConns = (d.ecm_total != null) ? d.ecm_total : 0;

	var header = document.querySelector('header');
	var navHeight = header ? header.offsetHeight : 40;

	var refreshBadge;
	if (isPaused) {
		refreshBadge = E('span', {
			'class': 'badge badge-warning',
			'style': 'cursor:pointer;',
			'title': _('当前已手动暂停轮询。点击恢复实时更新'),
			'click': function(ev) {
				ev.stopPropagation();
				isPaused = false;
				if (onRefreshToggle) onRefreshToggle();
			}
		}, [ '⏸ ' + _('已暂停') ]);
	} else if (isTableHovered) {
		refreshBadge = E('span', {
			'class': 'badge badge-warning',
			'style': 'cursor:pointer;',
			'title': _('鼠标正在表格内浏览，已自动挂起刷新以防打断；移出表格自动恢复，或点击锁定暂停'),
			'click': function(ev) {
				ev.stopPropagation();
				isPaused = true;
				if (onRefreshToggle) onRefreshToggle();
			}
		}, [ '⏸ ' + _('移入挂起') ]);
	} else if (!isPageVisible) {
		refreshBadge = E('span', {
			'class': 'badge badge-neutral'
		}, [ _('后台休眠') ]);
	} else if (isIdleBackoff) {
			refreshBadge = E('span', {
				'class': 'badge badge-neutral',
				'style': 'cursor:pointer;',
				'title': _('已处于挂机省电模式（12s 轮询）。移动鼠标或按键立即唤醒恢复 4s 实时模式'),
				'click': function(ev) {
					ev.stopPropagation();
					isPaused = true;
					if (onRefreshToggle) onRefreshToggle();
				}
			}, [
				_('⏱️ 挂机省电 (12s)')
			]);
		} else {
		refreshBadge = E('span', {
			'class': 'badge badge-success',
			'style': 'cursor:pointer;',
			'title': _('4s 实时更新中。移入下方表格自动挂起，或点击手动暂停'),
			'click': function(ev) {
				ev.stopPropagation();
				isPaused = true;
				if (onRefreshToggle) onRefreshToggle();
			}
		}, [
			E('span', { 'class': 'badge-dot' }),
			_('实时轮询中')
		]);
	}

	var btnAttrs = {
		'class': 'cbi-button cbi-button-neutral',
		'id': 'btn-force-refresh',
		'style': 'padding:2px 8px; font-size:11px; height:24px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; margin:0; white-space:nowrap;',
		'title': _('跳过轮询等待，立即抓取最新遥测与当前子卡数据'),
		'click': function(ev) {
			ev.preventDefault();
			ev.stopPropagation();
			if (onForceRefresh) onForceRefresh();
		}
	};
	if (isRefreshing) {
		btnAttrs['disabled'] = 'disabled';
	}

	var forceRefreshBtn = E('button', btnAttrs, [
		isRefreshing ? E('span', { 'class': 'nss-icon-spin' }, [ '🔄' ]) : '🔄',
		isRefreshing ? _('刷新中…') : _('强制刷新')
	]);

	return E('div', {
		'id': 'nss-sticky-telemetry-bar',
		'class': 'cbi-section',
		'style': 'top:' + navHeight + 'px;'
	}, [
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label', 'title': _('高通网络子系统 (NSS) 硬件加速协处理器，内置独立双核与硬件转发管线') }, [ _('协处理器规格') ]),
			E('div', { 'style': 'display:flex; align-items:center; gap:4px;' }, [
				badge('badge-info', soc + ' ×' + cores),
				badge('badge-neutral', freqStr)
			])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label', 'title': _('NSS 协处理器微码与 Linux 驱动之间的高频心跳计数 (pkts/s)。持续大于 0 说明微码与驱动交互正常') }, [ _('物理心跳速率') ]),
			E('div', {}, [
				badge('badge-success', (d.heartbeat || 0).toLocaleString() + ' pkts/s', true)
			])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label', 'title': _('当前经由高通增强连接管理器 (ECM) 卸载到 NSS 硬件层线速转发的活跃流总数与 v4/v6 分布') }, [ _('ECM 加速流数') ]),
			E('div', { 'style': 'display:flex; align-items:center; gap:4px;' }, [
				badge('badge-info', totalConns.toLocaleString() + ' ' + _('流')),
				badge('badge-neutral', 'v4:' + (d.ecm_v4 || 0) + ' / v6:' + (d.ecm_v6 || 0))
			])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label', 'title': _('数据包由 NSS 硬件层线速路由与桥接，完全绕过 Linux 内核协议栈与 CPU 软中断') }, [ _('硬件加速状态') ]),
			E('div', {}, [
				badge('badge-success', _('硬件直通加速中'), true)
			])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label', 'title': _('路由器 SoC 物理结温，来自内核热敏传感器实时监测') }, [ _('芯片结温') ]),
			E('div', {}, [
				badge(tempClass, t.toFixed(1) + '°C')
			])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label', 'title': _('检测并阻断内核软分流 (flow_offloading) 等可能破坏 NSS ECM 硬件加速的冲突配置') }, [ _('安全协同防御') ]),
			E('div', {}, [
				badge((d.conflict_detected === 1) ? 'badge-warning' : 'badge-success', (d.conflict_detected === 1) ? _('已阻断冲突项') : _('阻断墙已生效'))
			])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label', 'title': _('三级自适应状态机：4s 活跃轮询、60s 无操作进入 12s 挂机省电模式、切走标签页物理休眠（0 消耗）') }, [ _('轮询调度') ]),
			E('div', {}, [ refreshBadge ])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label' }, [ _('即时同步') ]),
			E('div', {}, [ forceRefreshBtn ])
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
	var totalConns = (d.ecm_total != null) ? d.ecm_total : 0;

	var sqmVal = (p && p.sqm != null) ? p.sqm : (d.sqm != null ? d.sqm : -1);
	var sqmView;
	if (sqmVal === 2) {
		sqmView = badge('badge-success', [ E('span', { 'class': 'badge-dot' }), _('NSS 硬件队列加速 (CAKE/FQ_CODEL)') ]);
	} else if (sqmVal === 1) {
		sqmView = badge('badge-info', _('主机软件队列整形运行中'));
	} else if (sqmVal === 0) {
		sqmView = badge('badge-neutral', _('未启用 (已配置备用)'));
	} else {
		sqmView = badge('badge-neutral', _('未安装 sqm-scripts'));
	}

	var coreLoadView;
	if (p.cores === 1) {
		coreLoadView = E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
			E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 0:' ]),
			E('div', { 'style': 'flex:1; max-width:240px;' }, [ progressbar(d.core0_load || 0, 100) ]),
			E('span', { 'style': 'font-size:11px; font-weight:600;' }, [ (d.core0_load || 0) + '%' ])
		]);
	} else {
		var isCore1Active = (d.core1_load !== null && d.core1_load !== undefined);
		coreLoadView = E('div', { 'style': 'display:flex; flex-direction:column; gap:4px; max-width:280px;' }, [
			E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
				E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 0:' ]),
				E('div', { 'style': 'flex:1;' }, [ progressbar(d.core0_load || 0, 100) ]),
				E('span', { 'style': 'font-size:11px; font-weight:600;' }, [ (d.core0_load || 0) + '%' ])
			]),
			E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
				E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 1:' ]),
				E('div', { 'style': 'flex:1;' }, [
					isCore1Active ? progressbar(d.core1_load, 100) : progressbar(null, 100, _('休眠待机'))
				]),
				E('span', {
					'style': 'font-size:11px; font-weight:600; color:' + (isCore1Active ? 'inherit' : 'var(--text-color-medium)') + ';',
					'title': isCore1Active ? '' : _('NPU Core 1 物理待机 (无蜂窝/IPsec服务固件)')
				}, [
					isCore1Active ? ((d.core1_load || 0) + '%') : _('待机')
				])
			])
		]);
	}

	var tempElements = [];
	if (d.cpu_temp && parseFloat(d.cpu_temp) > 0)
		tempElements.push(tempBadge('CPU', d.cpu_temp));

	var radios = d.radios || [];
	for (var i = 0; i < radios.length; i++) {
		if (radios[i].temp && parseFloat(radios[i].temp) > 0)
			tempElements.push(tempBadge(radios[i].id, radios[i].temp));
	}
	if (!tempElements.length)
		tempElements.push(badge('badge-neutral', _('未检测到物理温度')));

	var rawFw = p.fw_version || d.fw_version || '12.5';
	var fwMask = p.fw_mask || d.fw_mask || '0x36';
	var fwDisplay = 'FW ' + rawFw.replace(/^NSS\.(FW\.)?/, '') + (fwMask && fwMask !== '0x0' ? ' [' + fwMask + ']' : '');

	var section1 = E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('核心算力与驱动模块') ]),
			E('span', {
				'class': 'badge badge-success',
				'title': rawFw + (fwMask ? ' (fw_mask: ' + fwMask + ')' : '')
			}, [ fwDisplay ])
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('table', { 'class': 'table' }, [
				E('tbody', {}, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600; cursor:help;', 'title': _('高通独立网络子系统架构规格与工作主频') }, [ _('协处理器架构') ]),
						E('td', { 'class': 'td left' }, [
							badge('badge-info', 'Qualcomm ' + (p.soc || 'IPQ8074')),
							E('span', { 'style': 'margin-left:4px;' }, [
								badge('badge-neutral', ((p.cores === 1) ? _('单核 NPU') : _('双核 NPU')) + ' @ ' + (p.nss_freq || '1478.4 MHz'))
							])
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600; cursor:help;', 'title': _('高通独立协处理器双核算力占用率，用于处理包分类、路由决策与 QoS 流量整形，独立于 Linux 主 CPU') }, [ _('NPU 硬件负载') ]),
						E('td', { 'class': 'td left' }, [ coreLoadView ])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600; cursor:help;', 'title': _('NSS 固件微码与宿主驱动每秒交互的数据包基准，持续大于 0 代表硬件管线健康存活') }, [ _('物理心跳采样') ]),
						E('td', { 'class': 'td left' }, [
							badge('badge-success', (d.heartbeat || 0).toLocaleString() + ' pkts/s', true)
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600; cursor:help;', 'title': _('展示各网络协议子模块是否成功卸载至 NSS：Bridge(桥接)、PPPoE(拨号)、VLAN(虚网)、Qdisc(队列)、EIP-197(硬件矢量加解密)') }, [ _('驱动加速组件') ]),
						E('td', { 'class': 'td left' }, [
							E('div', { 'style': 'display:flex; gap:6px; flex-wrap:wrap; align-items:center;' }, [
								moduleChip('Bridge', mods.bridge),
								moduleChip('PPPoE', mods.pppoe),
								moduleChip('VLAN', mods.vlan),
								moduleChip('Qdisc', mods.qdisc),
								moduleChip('EIP-197', mods.crypto)
							])
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600; cursor:help;', 'title': _('NSS 硬件队列加速表示 Cake / FQ_CoDel 调度器在协处理器内部硬件级执行，完全避免跑满带宽时的主机高延迟与丢包') }, [ _('SQM 流量整形') ]),
						E('td', { 'class': 'td left' }, [ sqmView ])
					])
				])
			])
		])
	]);

	var section2 = E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('流表引擎与数据通道') ]),
			badge('badge-info', totalConns.toLocaleString() + ' ' + _('活动流'))
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('table', { 'class': 'table' }, [
				E('tbody', {}, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600; cursor:help;', 'title': _('高通增强连接管理器 (Enhanced Connection Manager)，负责监听内核会话并将其下推至 NSS 硬件线速转发') }, [ _('ECM 硬件加速状态') ]),
						E('td', { 'class': 'td left' }, [
							badge('badge-success', 'Active (' + _('全硬件卸载中') + ')', true)
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600; cursor:help;', 'title': _('当前经由 NSS 硬件卸载的 IPv4 / IPv6 及 TCP / UDP 活跃连接流统计') }, [ _('协议加速流分布') ]),
						E('td', { 'class': 'td left' }, [
							E('div', { 'style': 'display:flex; gap:6px; flex-wrap:wrap; align-items:center;' }, [
								badge('badge-info', 'IPv4: ' + (d.ecm_v4 || 0)),
								badge('badge-info', 'IPv6: ' + (d.ecm_v6 || 0)),
								badge('badge-neutral', 'TCP: ' + (d.ecm_tcp || 0)),
								badge('badge-neutral', 'UDP: ' + (d.ecm_udp || 0)),
								badge('badge-neutral', 'Other: ' + (d.ecm_other || 0))
							])
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600; cursor:help;', 'title': _('ath11k 无线驱动与 NSS 直连数据路径 (wifili Direct Path)，无线流量无需通过 Host 协议栈中转，硬件线速桥接或路由') }, [ _('无线数据通道') ]),
						E('td', { 'class': 'td left' }, [
							badge('badge-success', 'ath11k wifili ' + _('硬件直通 (802.11s Mesh 就绪)'), true)
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600; cursor:help;', 'title': _('路由器 SoC 物理结温与 Wi-Fi 射频芯片温度实时监控') }, [ _('硬件温度监控') ]),
						E('td', { 'class': 'td left' }, [
							E('div', { 'style': 'display:flex; gap:6px; flex-wrap:wrap; align-items:center;' }, tempElements)
						])
					])
				])
			])
		])
	]);

	return E('div', {}, [ section1, section2 ]);
}

// ── 4. 子卡 B：控制与防御 (Controls) ──
function renderControlCard(s, d) {
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
		'style': 'padding:4px 8px; font-size:13px;'
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
			E('td', { 'class': 'td', 'data-title': 'Port' }, [ E('strong', {}, [ p.netdev || ('eth' + p.ifnum) ]) ]),
			E('td', { 'class': 'td', 'data-title': 'Speed' }, [
				badge(speedCls, speedText)
			]),
			E('td', { 'class': 'td', 'data-title': 'HW %' }, [
				E('div', { 'style': 'display:flex; align-items:center; gap:6px;' }, [
					progressbar(hwRatio, 100),
					E('span', { 'style': 'font-size:11px; font-weight:bold;' }, [ hwRatio + '%' ])
				])
			]),
			E('td', { 'class': 'td', 'data-title': 'HW Pkts' }, [ offloaded.toLocaleString() + ' pkts' ]),
			E('td', { 'class': 'td', 'data-title': 'Host Pkts' }, [ hostPkts.toLocaleString() + ' pkts' ]),
			E('td', { 'class': 'td', 'data-title': 'RX / TX' }, [
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
			E('div', {
				'id': 'ports-scroll-wrap',
				'style': 'overflow-x:auto; width:100%; -webkit-overflow-scrolling:touch;',
				'mouseenter': function() {
					if (!isTableHovered) {
						isTableHovered = true;
						if (onRefreshToggle) onRefreshToggle();
					}
				},
				'mouseleave': function() {
					if (isTableHovered) {
						isTableHovered = false;
						if (onRefreshToggle) onRefreshToggle();
					}
				}
			}, [
				E('table', { 'class': 'table' }, [
					E('thead', {}, [
						E('tr', { 'class': 'tr table-titles' }, [
							E('th', { 'class': 'th' }, [ 'Port' ]),
							E('th', { 'class': 'th' }, [ 'Speed' ]),
							E('th', { 'class': 'th' }, [ 'HW %' ]),
							E('th', { 'class': 'th' }, [ 'HW Pkts' ]),
							E('th', { 'class': 'th' }, [ 'Host Pkts' ]),
							E('th', { 'class': 'th' }, [ 'RX / TX' ])
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
var WELL_KNOWN_PORTS = {
	'22': 'SSH',
	'53': 'DNS',
	'80': 'HTTP',
	'443': 'HTTPS',
	'123': 'NTP'
};

function formatEndpoint(ip, port) {
	if (!ip) return '-';
	var isIpv6 = (ip.indexOf(':') !== -1);
	var pStr = '';
	if (port) {
		var service = WELL_KNOWN_PORTS[String(port)];
		pStr = service ? (':' + port + '(' + service + ')') : (':' + port);
	}
	if (isIpv6) {
		var dispIp = compressIPv6(ip);
		return port ? ('[' + dispIp + ']' + pStr) : dispIp;
	}
	return ip + pStr;
}

var CLIENT_COLS = [
	{ key: 'client',     title: _('终端设备 (Client)'), hint: _('局域网在线设备，依据 MAC/ARP/DHCP 自动识别。支持点击「▼ +N IPv6」跨列展开全部 IPv6 地址与流表反查穿透'), num: false, get: function(c) { return (c.hostName || '') + ' ' + (c.ip || ''); } },
	{ key: 'flowCount',  title: _('并发流 (Conns)'),    hint: _('该终端当前活跃的双向 TCP/UDP 会话总数'), num: true,  get: function(c) { return c.flowCount || 0; } },
	{ key: 'totalPkts',  title: _('报文数 (Pkts)'),     hint: _('该终端所有活跃流的累计硬件转发数据包总数'), num: true,  get: function(c) { return c.totalPkts || 0; } },
	{ key: 'totalBytes', title: _('数据量 (Bytes)'),    hint: _('该终端所有活跃流的累计硬件转发网络流量'), num: true,  get: function(c) { return c.totalBytes || 0; } },
	{ key: 'proto',      title: _('承载协议 (Proto)'),  hint: _('该终端当前使用的传输层协议分布 (TCP/UDP)'), num: false, get: function(c) { return Object.keys(c.protos).sort().join(','); } }
];

var FLOW_COLS = [
	{ key: 'proto', title: _('协议 (Proto)'),  hint: _('传输层网络协议 (TCP/UDP)'), num: false, get: function(f) { return (f.proto || 'TCP').toUpperCase(); } },
	{ key: 'src',   title: _('源地址 (Src)'),   hint: _('会话发起端 IP 地址与端口号'), num: false, get: function(f) { return (f.src || ''); } },
	{ key: 'dst',   title: _('目的地址 (Dst)'), hint: _('会话对端/目标服务 IP 地址与端口号'), num: false, get: function(f) { return (f.dst || ''); } },
	{ key: 'pkts',  title: _('报文数 (Pkts)'),  hint: _('该连接双向累计传输的数据包总数 (包含 NSS 硬件计数)'), num: true,  get: function(f) { return parseInt(f.pkts) || 0; } },
	{ key: 'bytes', title: _('数据量 (Bytes)'), hint: _('该连接双向累计传输的数据字节总数 (包含 NSS 硬件计数)'), num: true,  get: function(f) { return parseInt(f.bytes) || 0; } }
];

function processFlowsData(d, hostHints) {
	var hostnames = d.hostnames || {};
	var isInstalled = (d.installed !== 0);
	var rawFlows = d.flows || d.data || [];

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

	// ── 路由器本机多网络接口与 IP 地址统一全栈归集 (优先复用会话级静态画像) ──
	var routerInfo = d.router || (staticProfile && staticProfile.router) || getSessionData('nss_router_device') || {};
	var routerHostname = (routerInfo.hostname || window.location.hostname || 'czw').replace(/\.lan$/i, '');
	var routerIps = Array.isArray(routerInfo.ips) ? routerInfo.ips.slice() : [];
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
	if (Array.isArray(d.data)) {
		var tupleList = d.data;
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
				bytes: bCount
			});
		}
	} else {
		var rawFlows = d.flows || d.data || [];
		normalizedFlows = rawFlows.map(function(f) {
			var rawSrc = f.src || '';
			var rawDst = f.dst || '';
			var sport = f.sport || '';
			var dport = f.dport || '';

			var srcDisp = formatEndpoint(rawSrc, sport);
			var dstDisp = formatEndpoint(rawDst, dport);

			var pkts = (f.orig_pkts != null || f.repl_pkts != null)
				? ((parseInt(f.orig_pkts) || 0) + (parseInt(f.repl_pkts) || 0))
				: (parseInt(f.pkts) || 0);

			var bytes = (f.orig_bytes != null || f.repl_bytes != null)
				? ((parseInt(f.orig_bytes) || 0) + (parseInt(f.repl_bytes) || 0))
				: (parseInt(f.bytes) || 0);

			var protoStr = String(f.proto || 'TCP').toUpperCase();
			var flowKey = protoStr + '_' + rawSrc + ':' + sport + '_' + rawDst + ':' + dport;

			return {
				key: flowKey,
				proto: protoStr,
				family: f.family || ((rawSrc.indexOf('.') !== -1) ? 'ipv4' : 'ipv6'),
				srcRaw: rawSrc,
				sport: sport,
				src: srcDisp,
				dstRaw: rawDst,
				dport: dport,
				dst: dstDisp,
				pkts: pkts,
				bytes: bytes
			};
		});
	}

	var unknownPrivateIpFound = false;
	normalizedFlows.forEach(function(f) {
		totalPkts += f.pkts;
		totalBytes += f.bytes;

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
				flowCount: 0,
				protos: {}
			};
		}
		clientMap[clientKey].totalPkts += f.pkts;
		clientMap[clientKey].totalBytes += f.bytes;
		clientMap[clientKey].flowCount++;
		clientMap[clientKey].protos[f.proto] = true;
	});

	var clientsList = Object.keys(clientMap).map(function(k) { return clientMap[k]; });

	// 反应式被动探活：仅当流表中出现未被识别的私网 IP 时，才静默触发一次轻量的主机映射重同步
	if (unknownPrivateIpFound && !isResolvingHints) {
		var now = Date.now();
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

	return {
		isInstalled: isInstalled,
		rawFlows: normalizedFlows,
		totalPkts: totalPkts,
		totalBytes: totalBytes,
		clientsList: clientsList,
		normalizedFlows: normalizedFlows,
		hostnames: hostnames,
		ipToDevice: ipToDevice
	};
}

function renderClientRow(c, onToggleExpand) {
	var ipSummary = renderTooltipIpSummary(c);

	var tooltipItems = [
		_('客户端名称'), c.hostName,
		_('MAC 地址'), c.mac ? E('code', {}, [ c.mac.toUpperCase() ]) : (c.isDevice ? _('虚拟/本地总线') : _('未知')),
		_('硬件加速流量'), E('span', { 'style': 'font-weight:bold; color:var(--primary-color-high);' }, [
			String.format('%1024.1mB', c.totalBytes) + ' (' + c.totalPkts.toLocaleString() + ' ' + _('pkts') + ')'
		]),
		_('活跃加速流'), E('span', { 'style': 'font-weight:600;' }, [
			c.flowCount + ' ' + _('条并发连接')
		]),
		_('IPv4 地址'), ipSummary.v4,
		_('IPv6 地址池'), ipSummary.v6
	];

	var isExpanded = !!expandedClientsMap[c.key];

	var badgeChildren = [ (isExpanded ? '▲ ' : '▼ ') + '+' + c.v6Count + ' IPv6' ];
	var expandBtn = (c.v6Count > 0) ? E('span', {
		'class': 'badge badge-neutral ip-expand-toggle-btn',
		'style': 'cursor:pointer; font-size:10px; padding:1px 5px; user-select:none;',
		'title': isExpanded ? _('点击收起 IPv6 列表') : _('点击在行内展开全部 IPv6 地址并临时禁止 Hover 弹窗'),
		'click': function(ev) {
			ev.stopPropagation();
			expandedClientsMap[c.key] = !isExpanded;
			if (onToggleExpand) onToggleExpand();
		}
	}, badgeChildren) : '';

	var cellTrigger = E('div', {
		'class': 'client-trigger-box cbi-tooltip-container' + (isExpanded ? ' no-hover' : ''),
		'style': 'display:flex; flex-direction:column; gap:2px; line-height:1.2; position:relative; cursor:default; width:100%;',
		'mouseenter': function() {
			if (this.classList.contains('no-hover')) return;
			var pop = this.querySelector('.client-popover');
			if (!pop) return;
			var rect = this.getBoundingClientRect();
			var spaceBelow = window.innerHeight - rect.bottom;
			var spaceAbove = rect.top;
			if (spaceBelow < 280 && spaceAbove > spaceBelow) {
				pop.classList.add('popover-flip-up');
			} else {
				pop.classList.remove('popover-flip-up');
			}
		}
	}, [
		E('div', { 'style': 'display:flex; align-items:center; gap:6px; flex-wrap:wrap;' }, [
			E('strong', { 'style': 'font-size:12px; white-space:nowrap;' }, [ c.hostName ]),
			expandBtn
		]),
		E('div', { 'style': 'font-size:11px;' }, [
			E('code', {}, [ c.ip ])
		]),
		E('span', { 'class': 'cbi-tooltip ifacebadge large client-popover' }, [
			L.itemlist(E('span', { 'class': 'left', 'style': 'white-space:normal;' }), tooltipItems)
		])
	]);

	var protoBadges = Object.keys(c.protos).sort().map(function(pr) {
		var protoCls = (pr === 'TCP') ? 'badge-info' : (pr === 'UDP') ? 'badge-warning' : 'badge-neutral';
		return badge(protoCls, pr);
	});

	return E('tr', { 'class': 'tr', 'data-key': c.key }, [
		E('td', { 'class': 'td', 'data-title': _('终端设备 (Client)') }, [
			cellTrigger
		]),
		E('td', { 'class': 'td', 'data-title': 'Conns', 'data-col': 'conns', 'style': 'white-space:nowrap;' }, [ c.flowCount + ' ' + _('条连接') ]),
		E('td', { 'class': 'td', 'data-title': 'Pkts', 'data-col': 'pkts', 'style': 'white-space:nowrap;' }, [ c.totalPkts.toLocaleString() + ' pkts' ]),
		E('td', { 'class': 'td', 'data-title': 'Bytes', 'data-col': 'bytes', 'style': 'white-space:nowrap;' }, [ String.format('%1024.1mB', c.totalBytes) ]),
		E('td', { 'class': 'td', 'data-title': 'Proto', 'data-col': 'protos' }, [
			E('div', { 'style': 'display:inline-flex; gap:4px; flex-wrap:wrap;' }, protoBadges)
		])
	]);
}

function renderFlowRow(f, hostnames, ipToDevice) {
	var dev = ipToDevice[f.srcRaw] || ipToDevice[normIp(f.srcRaw)];
	var srcName = dev ? (dev.name || dev.mac) : hostnames[f.srcRaw];
	var dstDev = ipToDevice[f.dstRaw] || ipToDevice[normIp(f.dstRaw)];
	var dstName = dstDev ? (dstDev.name || dstDev.mac) : hostnames[f.dstRaw];
	var protoCls = (f.proto === 'TCP') ? 'badge-info' : (f.proto === 'UDP') ? 'badge-warning' : 'badge-neutral';

	return E('tr', { 'class': 'tr', 'data-key': f.key }, [
		E('td', { 'class': 'td', 'data-title': 'Proto', 'style': 'white-space:nowrap;' }, [
			badge(protoCls, f.proto || 'TCP')
		]),
		E('td', { 'class': 'td', 'data-title': 'Src' }, [
			srcName ? E('strong', { 'style': 'white-space:nowrap; margin-right:6px;' }, [ srcName ]) : '',
			E('code', { 'style': 'font-size:11px; white-space:nowrap;' }, [ f.src || '-' ])
		]),
		E('td', { 'class': 'td', 'data-title': 'Dst' }, [
			dstName ? E('strong', { 'style': 'white-space:nowrap; margin-right:6px;' }, [ dstName ]) : '',
			E('code', { 'style': 'font-size:11px; white-space:nowrap;' }, [ f.dst || '-' ])
		]),
		E('td', { 'class': 'td', 'data-title': 'Pkts', 'data-col': 'pkts', 'style': 'white-space:nowrap;' }, [ (f.pkts || 0).toLocaleString() + ' pkts' ]),
		E('td', { 'class': 'td', 'data-title': 'Bytes', 'data-col': 'bytes', 'style': 'white-space:nowrap;' }, [ String.format('%1024.1mB', f.bytes || 0) ])
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
	if (!clientsList.length) {
		dom.content(tbody, [
			E('tr', { 'class': 'tr tr-empty-placeholder', 'data-empty': 'true' }, [
				E('td', { 'class': 'td', 'colspan': '5', 'style': 'text-align:center; color:var(--text-color-medium);' }, [
					_('当前暂无活跃的客户端硬件加速流')
				])
			])
		]);
		return;
	}

	// 彻底回收清理任何空状态占位行（杜绝占位残留缺陷）
	tbody.querySelectorAll('tr:not([data-key]), tr[data-empty], .tr-empty-placeholder').forEach(function(ph) {
		if (ph.parentNode === tbody) {
			tbody.removeChild(ph);
		}
	});

	var existingRows = {};
	tbody.querySelectorAll('tr[data-key]').forEach(function(r) {
		existingRows[r.getAttribute('data-key')] = r;
	});

	clientsList.forEach(function(c) {
		var row = existingRows[c.key];
		if (row) {
			delete existingRows[c.key];

			var connsTd = row.querySelector('[data-col="conns"]');
			if (connsTd) connsTd.textContent = c.flowCount + ' ' + _('条连接');

			var pktsTd = row.querySelector('[data-col="pkts"]');
			if (pktsTd) pktsTd.textContent = c.totalPkts.toLocaleString() + ' pkts';

			var bytesTd = row.querySelector('[data-col="bytes"]');
			if (bytesTd) bytesTd.textContent = String.format('%1024.1mB', c.totalBytes);

			var protoDiv = row.querySelector('[data-col="protos"] > div');
			if (protoDiv) {
				var protoBadges = Object.keys(c.protos).sort().map(function(pr) {
					var protoCls = (pr === 'TCP') ? 'badge-info' : (pr === 'UDP') ? 'badge-warning' : 'badge-neutral';
					return badge(protoCls, pr);
				});
				dom.content(protoDiv, protoBadges);
			}

			var tooltipSpan = row.querySelector('.cbi-tooltip');
			if (tooltipSpan) {
				var ipSummary = renderTooltipIpSummary(c);
				var tooltipItems = [
					_('客户端名称'), c.hostName,
					_('MAC 地址'), c.mac ? E('code', {}, [ c.mac.toUpperCase() ]) : (c.isDevice ? _('虚拟/本地总线') : _('未知')),
					_('硬件加速流量'), E('span', { 'style': 'font-weight:bold; color:var(--primary-color-high);' }, [
						String.format('%1024.1mB', c.totalBytes) + ' (' + c.totalPkts.toLocaleString() + ' ' + _('pkts') + ')'
					]),
					_('活跃加速流'), E('span', { 'style': 'font-weight:600;' }, [
						c.flowCount + ' ' + _('条并发连接')
					]),
					_('IPv4 地址'), ipSummary.v4,
					_('IPv6 地址池'), ipSummary.v6
				];
				dom.content(tooltipSpan, [ L.itemlist(E('span', { 'class': 'left', 'style': 'white-space:normal;' }), tooltipItems) ]);
			}

				// 同步条目级状态
				var triggerBox = row.querySelector('.client-trigger-box');
				if (triggerBox) {
					var isExp = !!expandedClientsMap[c.key];
					if (isExp) {
						triggerBox.classList.add('no-hover');
					} else {
						triggerBox.classList.remove('no-hover');
					}
					var btn = triggerBox.querySelector('.ip-expand-toggle-btn');
					if (btn) btn.textContent = (isExp ? '▲ ' : '▼ ') + '+' + c.v6Count + ' IPv6';
				}
			} else {
				row = renderClientRow(c, onToggleExpand);
			}
			tbody.appendChild(row);

			// 跨列子行管理
			var isExpRow = !!expandedClientsMap[c.key];
			var detailRow = tbody.querySelector('tr[data-expand-for="' + c.key + '"]');
			if (isExpRow && !detailRow) {
				detailRow = E('tr', { 'class': 'tr client-expand-row', 'data-expand-for': c.key }, [
					E('td', { 'class': 'td', 'colspan': '5', 'style': 'padding: 6px 14px 10px 14px;' }, [
						renderItemExpandPanel(c, function() {
							expandedClientsMap[c.key] = false;
							if (onToggleExpand) onToggleExpand();
						})
					])
				]);
				tbody.appendChild(detailRow);
			} else if (isExpRow && detailRow) {
				tbody.appendChild(detailRow);
			} else if (!isExpRow && detailRow) {
				detailRow.parentNode.removeChild(detailRow);
			}
		});

	Object.keys(existingRows).forEach(function(k) {
		if (existingRows[k].parentNode === tbody) {
			tbody.removeChild(existingRows[k]);
		}
	});
}

function patchFlowRows(tbody, flowsToRender, hostnames, ipToDevice) {
	if (!flowsToRender.length) {
		dom.content(tbody, [
			E('tr', { 'class': 'tr tr-empty-placeholder', 'data-empty': 'true' }, [
				E('td', { 'class': 'td', 'colspan': '5', 'style': 'text-align:center; color:var(--text-color-medium);' }, [
					_('当前分类下暂无活跃硬件加速流')
				])
			])
		]);
		return;
	}

	// 彻底回收清理任何空状态占位行（杜绝占位残留缺陷）
	tbody.querySelectorAll('tr:not([data-key]), tr[data-empty], .tr-empty-placeholder').forEach(function(ph) {
		if (ph.parentNode === tbody) {
			tbody.removeChild(ph);
		}
	});

	var existingRows = {};
	tbody.querySelectorAll('tr[data-key]').forEach(function(r) {
		existingRows[r.getAttribute('data-key')] = r;
	});

	flowsToRender.forEach(function(f) {
		var row = existingRows[f.key];
		if (row) {
			delete existingRows[f.key];
			var pktsTd = row.querySelector('[data-col="pkts"]');
			if (pktsTd) pktsTd.textContent = (f.pkts || 0).toLocaleString() + ' pkts';

			var bytesTd = row.querySelector('[data-col="bytes"]');
			if (bytesTd) bytesTd.textContent = String.format('%1024.1mB', f.bytes || 0);
		} else {
			row = renderFlowRow(f, hostnames, ipToDevice);
		}
		tbody.appendChild(row);
	});

	Object.keys(existingRows).forEach(function(k) {
		if (existingRows[k].parentNode === tbody) {
			tbody.removeChild(existingRows[k]);
		}
	});
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

	var scrollWrapAttrs = {
		'id': 'flows-scroll-wrap',
		'style': 'overflow-x:auto; width:100%; -webkit-overflow-scrolling:touch;',
		'mouseenter': function() {
			if (!isTableHovered) {
				isTableHovered = true;
				if (onRefreshToggle) onRefreshToggle();
			}
		},
		'mouseleave': function() {
			if (isTableHovered) {
				isTableHovered = false;
				if (onRefreshToggle) onRefreshToggle();
			}
		}
	};

	var filteredFlows = normalizedFlows;
	if (flowSubTab === 'ipv4') {
		filteredFlows = normalizedFlows.filter(function(f) { return f.family === 'ipv4' || f.srcRaw.indexOf('.') !== -1; });
	} else if (flowSubTab === 'ipv6') {
		filteredFlows = normalizedFlows.filter(function(f) { return f.family === 'ipv6' || f.srcRaw.indexOf(':') !== -1; });
	}

	var curClientCol = CLIENT_COLS.find(function(c) { return c.key === clientSortKey; }) || CLIENT_COLS[1];
	clientsList.sort(function(a, b) {
		var va = curClientCol.get(a), vb = curClientCol.get(b);
		if (curClientCol.num) return (va - vb) * clientSortDir;
		return String(va).localeCompare(String(vb)) * clientSortDir;
	});

	var curFlowCol = FLOW_COLS.find(function(c) { return c.key === flowSortKey; }) || FLOW_COLS[3];
	filteredFlows.sort(function(a, b) {
		var va = curFlowCol.get(a), vb = curFlowCol.get(b);
		if (curFlowCol.num) return (va - vb) * flowSortDir;
		return String(va).localeCompare(String(vb)) * flowSortDir;
	});

	var clientHeaders = CLIENT_COLS.map(function(col) {
		var isSorted = (clientSortKey === col.key);
		var arrow = isSorted ? (clientSortDir > 0 ? ' ▲' : ' ▼') : '';
		return E('th', {
			'class': 'th' + (isSorted ? ' sorted' : ''),
			'style': 'white-space:nowrap; cursor:pointer; user-select:none;',
			'title': (col.hint ? (col.hint + ' • ') : '') + _('点击排序'),
			'click': function() {
				if (clientSortKey === col.key) {
					clientSortDir = -clientSortDir;
				} else {
					clientSortKey = col.key;
					clientSortDir = col.num ? -1 : 1;
				}
				if (onSubTabSwitch) onSubTabSwitch();
			}
		}, [ col.title + arrow ]);
	});

	var flowHeaders = FLOW_COLS.map(function(col) {
		var isSorted = (flowSortKey === col.key);
		var arrow = isSorted ? (flowSortDir > 0 ? ' ▲' : ' ▼') : '';
		return E('th', {
			'class': 'th' + (isSorted ? ' sorted' : ''),
			'style': 'white-space:nowrap; cursor:pointer; user-select:none;',
			'title': (col.hint ? (col.hint + ' • ') : '') + _('点击排序'),
			'click': function() {
				if (flowSortKey === col.key) {
					flowSortDir = -flowSortDir;
				} else {
					flowSortKey = col.key;
					flowSortDir = col.num ? -1 : 1;
				}
				if (onSubTabSwitch) onSubTabSwitch();
			}
		}, [ col.title + arrow ]);
	});

	var tabMenuItems = [
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
				'href': '#' + tab.id,
				'click': function(ev) {
					ev.preventDefault();
					if (flowSubTab === tab.id) return;
					flowSubTab = tab.id;
					if (onSubTabSwitch) onSubTabSwitch();
				}
			}, [ tab.label ])
		]);
	});

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
			clientsList.forEach(function(c) {
				var mainRow = renderClientRow(c, onSubTabSwitch);
				clientRows.push(mainRow);
				if (expandedClientsMap[c.key]) {
					var detailRow = E('tr', { 'class': 'tr client-expand-row', 'data-expand-for': c.key }, [
						E('td', { 'class': 'td', 'colspan': '5', 'style': 'padding: 6px 14px 10px 14px;' }, [
						renderItemExpandPanel(c, function() {
							expandedClientsMap[c.key] = false;
							if (onSubTabSwitch) onSubTabSwitch();
						})
					])
				]);
				clientRows.push(detailRow);
			}
		});

		if (!clientRows.length) {
			clientRows = [
				E('tr', { 'class': 'tr tr-empty-placeholder', 'data-empty': 'true' }, [
					E('td', { 'class': 'td', 'colspan': '5', 'style': 'text-align:center; color:var(--text-color-medium);' }, [
						_('当前暂无活跃的客户端硬件加速流')
					])
				])
			];
		}

		tableBody = E('div', scrollWrapAttrs, [
			E('table', { 'class': 'table' }, [
				E('thead', {}, [
					E('tr', { 'class': 'tr table-titles' }, clientHeaders)
				]),
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
					E('td', { 'class': 'td', 'colspan': '5', 'style': 'text-align:center; color:var(--text-color-medium);' }, [
						_('当前分类下暂无活跃硬件加速流')
					])
				])
			];
		}

		tableBody = E('div', scrollWrapAttrs, [
			E('table', { 'class': 'table' }, [
				E('thead', {}, [
					E('tr', { 'class': 'tr table-titles' }, flowHeaders)
				]),
				E('tbody', { 'id': 'flows-tbody', 'data-subtab': flowSubTab }, flowRows)
			]),
			E('div', { 'id': 'flows-truncation-bar' }, [
				renderTruncationBanner(isTruncated, showAllFlows, filteredFlows.length, onSubTabSwitch)
			])
		]);
	}

	var secSummary = E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', { 'title': _('实时采集自内核 Netfilter Conntrack 与高通 NSS ECM 硬件卸载引擎。每 4 秒采样一次活跃双向会话并过滤 0 报文静止流，呈现真实的线速流量拓扑。'), 'style': 'cursor:help;' }, [ _('NSS 硬件流表与连接概况') ]),
			E('span', { 'id': 'flows-summary-badge' }, [
				badge('badge-info', isInstalled ? (rawFlows.length + ' ' + _('活动流')) : _('未安装 nssqos'))
			])
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('table', { 'class': 'table', 'style': 'margin-bottom:0;' }, [
				E('tbody', {}, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:25%; font-weight:600;' }, [ _('硬件加速连接总数') ]),
						E('td', { 'class': 'td left', 'id': 'flows-total-conns', 'style': 'width:25%;' }, [ isInstalled ? (rawFlows.length + ' ' + _('条并发流')) : '-' ]),
						E('td', { 'class': 'td left', 'style': 'width:25%; font-weight:600;' }, [ _('硬件加速总报文/字节') ]),
						E('td', { 'class': 'td left', 'id': 'flows-total-pkts-bytes', 'style': 'width:25%;' }, [
							isInstalled ? (totalPkts.toLocaleString() + ' pkts (' + String.format('%1024.1mB', totalBytes) + ')') : '-'
						])
					])
				])
			])
		])
	]);

	var secTable = E('div', { 'class': 'cbi-section' }, [
		isInstalled ? E('ul', { 'class': 'cbi-tabmenu' }, tabMenuItems) : E('div'),
		E('div', { 'class': 'cbi-section-node' }, [ tableBody ]),
		E('div', { 'class': 'cbi-map-descr', 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:6px;' }, [
			_('说明: 鼠标移入表格区域时自动挂起轮询以防打断浏览；移出表格或点击上方状态徽章可恢复实时刷新。')
		])
	]);

	return E('div', {}, [ secSummary, secTable ]);
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

	var pktsBytesEl = subCardContainer.querySelector('#flows-total-pkts-bytes');
	if (pktsBytesEl) pktsBytesEl.textContent = processed.totalPkts.toLocaleString() + ' pkts (' + String.format('%1024.1mB', processed.totalBytes) + ')';

	if (flowSubTab === 'clients') {
		var curClientCol = CLIENT_COLS.find(function(c) { return c.key === clientSortKey; }) || CLIENT_COLS[1];
		processed.clientsList.sort(function(a, b) {
			var va = curClientCol.get(a), vb = curClientCol.get(b);
			if (curClientCol.num) return (va - vb) * clientSortDir;
			return String(va).localeCompare(String(vb)) * clientSortDir;
		});
		patchClientRows(tbody, processed.clientsList, onSubTabSwitch);
	} else {
		var filteredFlows = processed.normalizedFlows;
		if (flowSubTab === 'ipv4') {
			filteredFlows = processed.normalizedFlows.filter(function(f) { return f.family === 'ipv4' || f.srcRaw.indexOf('.') !== -1; });
		} else if (flowSubTab === 'ipv6') {
			filteredFlows = processed.normalizedFlows.filter(function(f) { return f.family === 'ipv6' || f.srcRaw.indexOf(':') !== -1; });
		}

		var curFlowCol = FLOW_COLS.find(function(c) { return c.key === flowSortKey; }) || FLOW_COLS[3];
		filteredFlows.sort(function(a, b) {
			var va = curFlowCol.get(a), vb = curFlowCol.get(b);
			if (curFlowCol.num) return (va - vb) * flowSortDir;
			return String(va).localeCompare(String(vb)) * flowSortDir;
		});

		var isTruncated = (!showAllFlows && filteredFlows.length > MAX_FLOWS_RENDER);
		var flowsToRender = isTruncated ? filteredFlows.slice(0, MAX_FLOWS_RENDER) : filteredFlows;

		patchFlowRows(tbody, flowsToRender, processed.hostnames, processed.ipToDevice);

		var truncEl = subCardContainer.querySelector('#flows-truncation-bar');
		if (truncEl) {
			dom.content(truncEl, [ renderTruncationBanner(isTruncated, showAllFlows, filteredFlows.length, onSubTabSwitch) ]);
		}
	}
}

// ── 7. 子卡 E：流量档案与长期审计 (Traffic Audit) ──
var AUDIT_COLS = [
	{ key: 'client', title: _('终端设备 (Client)'), hint: _('局域网在线设备，点击「▼ +N IPv6」可展开完整 IPv6 地址池'), num: false, get: function(c) { return (c.hostName || '') + ' ' + (c.mac || ''); } },
	{ key: 'rx',     title: _('下行流量 (RX)'),     hint: _('该终端累计接收的网络下行数据量 (包含 NSS 硬件加速流量)'), num: true,  get: function(c) { return c.rx || 0; } },
	{ key: 'tx',     title: _('上行流量 (TX)'),     hint: _('该终端累计发送的网络上行数据量 (包含 NSS 硬件加速流量)'), num: true,  get: function(c) { return c.tx || 0; } },
	{ key: 'total',  title: _('总流量 (Total)'),    hint: _('该终端上行与下行双向累计网络吞吐总量'), num: true,  get: function(c) { return c.total || 0; } },
	{ key: 'conns',  title: _('历史会话 (Conns)'),  hint: _('审计周期内该设备建立的 TCP/UDP 历史连接会话总数'), num: true,  get: function(c) { return c.conns || 0; } }
];

var SVG_NS = 'http://www.w3.org/2000/svg';
function svgElem(tag, attrs, children) {
	var el = document.createElementNS(SVG_NS, tag);
	if (attrs) {
		for (var k in attrs) {
			if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]);
		}
	}
	if (children) {
		if (!Array.isArray(children)) children = [ children ];
		children.forEach(function(c) {
			if (c == null) return;
			if (typeof c === 'string' || typeof c === 'number') {
				el.appendChild(document.createTextNode(String(c)));
			} else if (c.nodeType) {
				el.appendChild(c);
			}
		});
	}
	return el;
}

function renderAuditSvgChart(topClients, grandTotal) {
	if (!topClients || !topClients.length) return E('div');

	var height = 24 + topClients.length * 28;
	var bars = topClients.map(function(c, idx) {
		var y = 14 + idx * 28;
		var pct = grandTotal > 0 ? (c.total / grandTotal) : 0;
		var pctStr = (pct * 100).toFixed(1) + '%';
		var barWidth = Math.max(4, Math.round(pct * 250));
		var bytesStr = String.format('%1024.1mB', c.total);

		var fill = (idx === 0) ? 'var(--primary-color-high, var(--brand, #1976d2))' :
		           (idx === 1) ? 'var(--success-color-high, #00ac59)' :
		           (idx === 2) ? 'var(--warn-color-high, #efbd0b)' : 'var(--text-color-medium, #8a99ad)';

		var label = c.hostName || c.mac || '-';
		if (label.length > 20) label = label.substring(0, 19) + '…';

		return svgElem('g', { 'transform': 'translate(0, ' + y + ')' }, [
			svgElem('text', {
				'x': '165',
				'y': '12',
				'text-anchor': 'end',
				'font-size': '11px',
				'fill': 'var(--text-color-high, var(--text, #f9fafb))',
				'font-weight': '600'
			}, [ label ]),
			svgElem('rect', {
				'x': '175',
				'y': '2',
				'width': '250',
				'height': '12',
				'rx': '3',
				'fill': 'var(--background-color-medium, var(--surface-sunken, rgba(255, 255, 255, 0.08)))'
			}),
			svgElem('rect', {
				'x': '175',
				'y': '2',
				'width': String(barWidth),
				'height': '12',
				'rx': '3',
				'fill': fill
			}),
			svgElem('text', {
				'x': String(183 + barWidth),
				'y': '12',
				'font-size': '11px',
				'fill': 'var(--text-color-medium, #8a99ad)',
				'font-weight': 'bold'
			}, [ bytesStr + ' (' + pctStr + ')' ])
		]);
	});

	return E('div', { 'style': 'overflow-x:auto; width:100%;' }, [
		svgElem('svg', {
			'style': 'width:100%; min-width:480px; max-width:600px; display:block; margin:0 auto;',
			'height': String(height),
			'viewBox': '0 0 600 ' + height
		}, bars)
	]);
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

	var curAuditCol = AUDIT_COLS.find(function(c) { return c.key === auditSortKey; }) || AUDIT_COLS[3];
	clientAuditList.sort(function(a, b) {
		var va = curAuditCol.get(a), vb = curAuditCol.get(b);
		if (curAuditCol.num) return (va - vb) * auditSortDir;
		return String(va).localeCompare(String(vb)) * auditSortDir;
	});

	var auditHeaders = AUDIT_COLS.map(function(col) {
		var isSorted = (auditSortKey === col.key);
		var arrow = isSorted ? (auditSortDir > 0 ? ' ▲' : ' ▼') : '';
		return E('th', {
			'class': 'th' + (isSorted ? ' sorted' : ''),
			'style': 'white-space:nowrap; cursor:pointer; user-select:none;',
			'title': (col.hint ? (col.hint + ' • ') : '') + _('点击排序'),
			'click': function() {
				if (auditSortKey === col.key) {
					auditSortDir = -auditSortDir;
				} else {
					auditSortKey = col.key;
					auditSortDir = col.num ? -1 : 1;
				}
				if (onSortSwitch) onSortSwitch();
			}
		}, [ col.title + arrow ]);
	});

	var topClients = clientAuditList.slice(0, 5);

	var rows = clientAuditList.map(function(c) {
		var rxPct = grandTotal > 0 ? ((c.rx / grandTotal) * 100).toFixed(1) : '0.0';

		var ipSummary = renderTooltipIpSummary(c);
		var tooltipItems = [
			_('客户端名称'), c.hostName,
			_('MAC 地址'), E('code', {}, [ c.mac.toUpperCase() ]),
			_('历史总流量'), E('span', { 'style': 'font-weight:bold; color:var(--primary-color-high);' }, [ String.format('%1024.1mB', c.total) ]),
			_('下行 / 上行'), String.format('%1024.1mB', c.rx) + ' / ' + String.format('%1024.1mB', c.tx),
			_('记录会话数'), c.conns.toLocaleString() + ' ' + _('条'),
			_('IPv4 地址'), ipSummary.v4,
			_('IPv6 地址池'), ipSummary.v6
		];

		var isExpanded = !!expandedClientsMap['audit_' + c.mac];
		var expandBtn = (c.v6Count > 0) ? E('span', {
			'class': 'badge badge-neutral ip-expand-toggle-btn',
			'style': 'cursor:pointer; font-size:10px; padding:1px 5px; user-select:none;',
			'title': isExpanded ? _('点击收起 IPv6 列表') : _('点击在行内展开全部 IPv6 地址并临时禁止 Hover 弹窗'),
			'click': function(ev) {
				ev.stopPropagation();
				expandedClientsMap['audit_' + c.mac] = !isExpanded;
				if (onSortSwitch) onSortSwitch();
			}
		}, [ (isExpanded ? '▲ ' : '▼ ') + '+' + c.v6Count + ' IPv6' ]) : '';

		var cellTrigger = E('div', {
			'class': 'client-trigger-box cbi-tooltip-container' + (isExpanded ? ' no-hover' : ''),
			'style': 'display:flex; flex-direction:column; gap:2px; line-height:1.2; position:relative; cursor:default; width:100%;',
			'mouseenter': function() {
				if (this.classList.contains('no-hover')) return;
				var pop = this.querySelector('.client-popover');
				if (!pop) return;
				var rect = this.getBoundingClientRect();
				var spaceBelow = window.innerHeight - rect.bottom;
				var spaceAbove = rect.top;
				if (spaceBelow < 280 && spaceAbove > spaceBelow) {
					pop.classList.add('popover-flip-up');
				} else {
					pop.classList.remove('popover-flip-up');
				}
			}
		}, [
			E('div', { 'style': 'display:flex; align-items:center; gap:6px; flex-wrap:wrap;' }, [
				E('strong', { 'style': 'font-size:12px; white-space:nowrap;' }, [ c.hostName ]),
				expandBtn
			]),
			E('div', { 'style': 'font-size:11px;' }, [
				E('code', {}, [ c.ip !== '-' ? c.ip : c.mac.toUpperCase() ])
			]),
			E('span', { 'class': 'cbi-tooltip ifacebadge large client-popover' }, [
				L.itemlist(E('span', { 'class': 'left', 'style': 'white-space:normal;' }), tooltipItems)
			])
		]);

			var mainRow = E('tr', { 'class': 'tr', 'data-key': c.mac }, [
			E('td', { 'class': 'td', 'data-title': _('终端设备 (Client)') }, [
				cellTrigger
			]),
			E('td', { 'class': 'td', 'data-title': 'RX' }, [
				E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
					E('span', { 'style': 'white-space:nowrap;' }, [ String.format('%1024.1mB', c.rx) ]),
					E('span', { 'class': 'badge badge-neutral', 'style': 'font-size:10px;' }, [ rxPct + '%' ])
				])
			]),
			E('td', { 'class': 'td', 'data-title': 'TX', 'style': 'white-space:nowrap;' }, [ String.format('%1024.1mB', c.tx) ]),
			E('td', { 'class': 'td', 'data-title': 'Total', 'style': 'white-space:nowrap; font-weight:bold;' }, [ String.format('%1024.1mB', c.total) ]),
			E('td', { 'class': 'td', 'data-title': 'Conns', 'style': 'white-space:nowrap;' }, [ c.conns.toLocaleString() ])
			]);
			if (isExpanded) {
				var detailRow = E('tr', { 'class': 'tr client-expand-row', 'data-expand-for': c.mac }, [
					E('td', { 'class': 'td', 'colspan': '5', 'style': 'padding: 6px 14px 10px 14px;' }, [
						renderItemExpandPanel(c, function() {
							expandedClientsMap['audit_' + c.mac] = false;
							if (onSortSwitch) onSortSwitch();
						})
					])
				]);
				return [ mainRow, detailRow ];
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
						E('td', { 'class': 'td left', 'style': 'width:25%; font-weight:bold;' }, [ String.format('%1024.1mB', grandTotal) ]),
						E('td', { 'class': 'td left', 'style': 'width:25%; font-weight:600;' }, [ _('累计下行 / 累计上行') ]),
						E('td', { 'class': 'td left', 'style': 'width:25%;' }, [
							String.format('%1024.1mB', totalRx) + ' / ' + String.format('%1024.1mB', totalTx)
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:25%; font-weight:600;' }, [ _('追踪会话总数') ]),
						E('td', { 'class': 'td left', 'style': 'width:25%;' }, [ totalConns.toLocaleString() + ' ' + _('条会话') ]),
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
			E('span', {}, [ _('Top 5 终端用量分布 (SVG Native)') ])
		]),
		E('div', { 'class': 'cbi-section-node', 'style': 'padding:12px 14px;' }, [
			renderAuditSvgChart(topClients, grandTotal)
		])
	]) : E('div');

	var tableSec = E('div', { 'class': 'cbi-section' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('终端长期流量明细账单') ])
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('div', {
				'id': 'audit-scroll-wrap',
				'style': 'overflow-x:auto; width:100%; -webkit-overflow-scrolling:touch;',
				'mouseenter': function() {
					if (!isTableHovered) {
						isTableHovered = true;
						if (onRefreshToggle) onRefreshToggle();
					}
				},
				'mouseleave': function() {
					if (isTableHovered) {
						isTableHovered = false;
						if (onRefreshToggle) onRefreshToggle();
					}
				}
			}, [
				E('table', { 'class': 'table' }, [
					E('thead', {}, [
						E('tr', { 'class': 'tr table-titles' }, auditHeaders)
					]),
					E('tbody', {}, rows)
				])
			])
		]),
		E('div', { 'class': 'cbi-map-descr', 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:6px;' }, [
			_('说明: 流量档案数据直接映射自 nlbwmon 内存驻留数据库 (-Z)，无闪存擦写开销；悬停设备单元格可查看对应终端的多网卡与地址池。')
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

		if (profileData.router) {
			setSessionData('nss_router_device', profileData.router);
		}

		if (!staticProfile && profileData.soc) {
			staticProfile = profileData;
		}
		var p = staticProfile || profileData;

		// 检查 Hash 或路径参数以支持直接定位子卡
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

		// 顶置常驻遥测总线状态栏容器
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

		// 页面可见性监听 (失焦休眠，0 XHR)
		document.addEventListener('visibilitychange', function() {
			isPageVisible = !document.hidden;
			renderSticky();
			if (isPageVisible && !isPaused && !isTableHovered) {
				update();
			}
		});

		// 子卡内容挂载容器
		var subCardContainer = E('div', { 'id': 'nss-subcard-mount' });

		// 子选项卡渲染
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
				dom.content(subCardContainer, renderControlCard(settingsData, metricsData));
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

		// ── 轮询任务调度 (常驻遥测栏持续运行，子卡按需按时拉取) ──
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
			}).catch(function(err) {
				// 静默防抖，不打断用户浏览
			});
		};

		// 全局用户活跃感应（鼠标移动、按键、点击、滚动）瞬时唤醒
			var onUserActivity = function() {
				lastUserActionTime = Date.now();
				if (isIdleBackoff) {
					isIdleBackoff = false;
					renderSticky();
				}
			};
			['mousemove', 'keydown', 'click', 'scroll'].forEach(function(evtName) {
				window.addEventListener(evtName, onUserActivity, { passive: true });
			});

			var pollCounter = 0;
			var update = function() {
				if (!isPageVisible || isPaused || isTableHovered) {
					renderSticky();
					return Promise.resolve();
				}

				// 自适应判断：是否已超时进入无操作挂机状态
				var idleTime = Date.now() - lastUserActionTime;
				if (idleTime > IDLE_TIMEOUT_MS && !isIdleBackoff) {
					isIdleBackoff = true;
					renderSticky();
				}

				// 挂机退避控制：基准周期为 4s，挂机状态下每 3 次 tick (12s) 实际发起一次请求
				pollCounter++;
				if (isIdleBackoff && (pollCounter % 3 !== 0)) {
					return Promise.resolve();
				}

				return forceUpdate();
			};

			poll.add(update, POLL_NORMAL_INTERVAL);

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
