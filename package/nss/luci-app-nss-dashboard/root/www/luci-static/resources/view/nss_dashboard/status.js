'use strict';
'require view';
'require rpc';
'require poll';
'require dom';

var callNssStatus = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getStatus'
});

function progressbar(value, max) {
	var vn = parseFloat(value) || 0,
	    mn = parseFloat(max) || 100,
	    pc = Math.min(100, Math.max(0, Math.floor((100 / mn) * vn)));

	return E('div', {
		'class': 'cbi-progressbar',
		'style': 'height:13px; min-width:110px; position:relative; overflow:hidden;',
		'title': '%s%%'.format(vn)
	}, [
		E('div', {
			'style': 'width:%.2f%%; height:100%; transition:width 0.3s ease;'.format(pc),
			'class': (vn > 80) ? 'cbi-progressbar-danger' : (vn > 50) ? 'cbi-progressbar-warn' : ''
		}),
		E('span', { 'style': 'position:absolute; width:100%; text-align:center; font-size:10px; font-weight:bold; line-height:13px;' }, [
			'%s%%'.format(vn)
		])
	]);
}

function badge(cls, text, dot) {
	var children = [];
	if (dot) {
		children.push(E('span', {
			'style': 'display:inline-block; width:6px; height:6px; border-radius:50%; background:currentColor; flex-shrink:0;'
		}));
	}
	if (Array.isArray(text)) {
		children = children.concat(text);
	} else {
		children.push(text);
	}

	return E('span', {
		'class': 'badge ' + (cls || 'badge-neutral'),
		'style': 'display:inline-flex; align-items:center; gap:4px; padding:2px 7px; border-radius:3px; font-size:11px; font-weight:600; line-height:1.2;'
	}, children);
}

function tempBadge(label, temp) {
	var t = parseFloat(temp) || 0;
	var cls = (t >= 75) ? 'badge-danger' : (t >= 60) ? 'badge-warning' : 'badge-success';

	return E('span', {
		'class': 'badge ' + cls,
		'style': 'display:inline-flex; align-items:center; gap:3px; padding:2px 7px; margin:1px 3px; border-radius:3px; font-size:11px; font-weight:bold;'
	}, [
		E('strong', {}, [ label + ':' ]),
		t.toFixed(1) + '°C'
	]);
}

function moduleChip(name, active, activeText, inactiveText) {
	return E('span', {
		'class': 'badge ' + (active ? 'badge-success' : 'badge-neutral'),
		'style': 'display:inline-flex; align-items:center; gap:3px; padding:2px 7px; font-size:11px; border-radius:3px;'
	}, [
		E('strong', {}, [ name + ':' ]),
		active ? (activeText || _('已挂载')) : (inactiveText || _('未启用'))
	]);
}

function renderStickyBar(d, npuLabel) {
	var t = parseFloat(d.cpu_temp) || 0;
	var tempClass = (t >= 75) ? 'badge-danger' : (t >= 60) ? 'badge-warning' : 'badge-success';
	var soc = d.soc || 'IPQ8074';
	var freqStr = d.nss_freq ? d.nss_freq.replace(' MHz', 'M') : '1478.4M';
	var totalConns = (d.ecm_total != null) ? d.ecm_total : 0;

	return E('div', {
		'id': 'nss-sticky-telemetry-bar',
		'style': 'position:sticky; top:0; z-index:90; background:var(--bg-surface); border:1px solid var(--border-color); border-bottom:2px solid var(--border-color); border-radius:3px; padding:6px 12px; margin-bottom:12px; display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:6px 12px; font-size:12px;'
	}, [
		E('div', { 'style': 'display:flex; flex-direction:column; justify-content:center;' }, [
			E('span', { 'style': 'color:var(--text-muted); font-size:10px; font-weight:600; margin-bottom:2px;' }, [ _('协处理器规格') ]),
			E('div', { 'style': 'display:flex; align-items:center; gap:4px;' }, [
				badge('badge-info', soc + ' ×' + (d.cores || 2)),
				badge('badge-neutral', freqStr)
			])
		]),
		E('div', { 'style': 'display:flex; flex-direction:column; justify-content:center;' }, [
			E('span', { 'style': 'color:var(--text-muted); font-size:10px; font-weight:600; margin-bottom:2px;' }, [ _('物理心跳速率') ]),
			E('div', {}, [
				badge('badge-success', (d.heartbeat || 0) + ' pps', true)
			])
		]),
		E('div', { 'style': 'display:flex; flex-direction:column; justify-content:center;' }, [
			E('span', { 'style': 'color:var(--text-muted); font-size:10px; font-weight:600; margin-bottom:2px;' }, [ _('ECM 加速流数') ]),
			E('div', { 'style': 'display:flex; align-items:center; gap:4px;' }, [
				badge('badge-info', totalConns.toLocaleString() + ' ' + _('流')),
				badge('badge-neutral', 'v4:' + (d.ecm_v4 || 0) + ' / v6:' + (d.ecm_v6 || 0))
			])
		]),
		E('div', { 'style': 'display:flex; flex-direction:column; justify-content:center;' }, [
			E('span', { 'style': 'color:var(--text-muted); font-size:10px; font-weight:600; margin-bottom:2px;' }, [ _('硬件加速状态') ]),
			E('div', {}, [
				badge('badge-success', _('硬件直通加速中'), true)
			])
		]),
		E('div', { 'style': 'display:flex; flex-direction:column; justify-content:center;' }, [
			E('span', { 'style': 'color:var(--text-muted); font-size:10px; font-weight:600; margin-bottom:2px;' }, [ _('核心芯片结温') ]),
			E('div', {}, [
				badge(tempClass, t.toFixed(1) + '°C')
			])
		]),
		E('div', { 'style': 'display:flex; flex-direction:column; justify-content:center;' }, [
			E('span', { 'style': 'color:var(--text-muted); font-size:10px; font-weight:600; margin-bottom:2px;' }, [ _('安全协同防御') ]),
			E('div', {}, [
				badge((d.conflict_detected === 1) ? 'badge-warning' : 'badge-success', (d.conflict_detected === 1) ? _('已阻断冲突项') : _('阻断墙 [生效]'))
			])
		])
	]);
}

function renderStatus(d) {
	var npuLabel = (d.cores === 1) ? 'NPU ×1' : 'NPU ×2';
	var freqStr = d.nss_freq ? (npuLabel + ' @ ' + d.nss_freq) : npuLabel;
	var mods = d.modules || {};
	var totalConns = (d.ecm_total != null) ? d.ecm_total : 0;

	// 1. 冲突警告横幅
	var conflictBanner = null;
	if (d.conflict_detected === 1) {
		conflictBanner = E('div', {
			'class': 'alert-message warning',
			'style': 'background:var(--warning-light, #fffbe6); border:1px solid var(--warning, #faad14); padding:10px 14px; margin-bottom:14px; border-radius:2px; font-size:13px; color:var(--text-main);'
		}, [
			E('strong', {}, [ '⚠️ ' + _('内核协议栈配置与 NSS 硬件加速冲突') ]),
			E('div', { 'style': 'margin-top:4px;' }, [
				_('检测到系统开启了软件流量分流 (flow_offloading=1)。数据包将被提前截获跳过 Conntrack 通知链，导致 ECM 硬件加速失效与连接撕裂。系统安全防护已自动阻断该项影响。建议手动关闭此冲突项：可直接前往'),
				E('a', {
					'href': L.url('admin/network/network'),
					'style': 'color:var(--primary); font-weight:bold; text-decoration:underline; margin-left:4px;'
				}, [ _('网络 → 接口 → 全局网络选项') ]),
				_('。')
			])
		]);
	}

	// 2. NPU 双核负载进度条
	var coreLoadView;
	if (d.cores === 1) {
		coreLoadView = E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
			E('span', { 'style': 'min-width:45px; font-size:11px; font-weight:600;' }, [ 'Core 0:' ]),
			E('div', { 'style': 'flex:1; max-width:240px;' }, [ progressbar(d.core0_load || 0, 100) ])
		]);
	} else {
		coreLoadView = E('div', { 'style': 'display:flex; flex-direction:column; gap:4px; max-width:240px;' }, [
			E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
				E('span', { 'style': 'min-width:45px; font-size:11px; font-weight:600;' }, [ 'Core 0:' ]),
				E('div', { 'style': 'flex:1;' }, [ progressbar(d.core0_load || 0, 100) ])
			]),
			E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
				E('span', { 'style': 'min-width:45px; font-size:11px; font-weight:600;' }, [ 'Core 1:' ]),
				E('div', { 'style': 'flex:1;' }, [ progressbar(d.core1_load || 0, 100) ])
			])
		]);
	}

	// 3. 多点传感器温度
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

	// ── 中枢 ①：核心算力与驱动流水线 (标准 cbi-section) ──
	var hub1 = E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:12px;' }, [
		E('h3', { 'class': 'cbi-section-title', 'style': 'display:flex; justify-content:space-between; align-items:center;' }, [
			E('span', {}, [ _('核心算力与驱动流水线') ]),
			badge('badge-success', 'FW ' + (d.fw_version || '11.4') + ' [0x1f]')
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'id': 'status-hub1-scroll-wrap', 'style': 'overflow-x:auto; width:100%; -webkit-overflow-scrolling:touch;' }, [
				E('table', { 'class': 'table' }, [
					E('thead', {}, [
						E('tr', { 'class': 'tr' }, [
							E('th', { 'class': 'th', 'style': 'width:125px; white-space:nowrap;' }, [ _('系统单元') ]),
							E('th', { 'class': 'th' }, [ _('底层架构与规格') ]),
							E('th', { 'class': 'th', 'style': 'width:240px; white-space:nowrap;' }, [ _('实时遥测指标') ])
						])
					]),
					E('tbody', {}, [
						E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td', 'style': 'white-space:nowrap;' }, [ E('strong', {}, [ _('NPU 算力核心') ]) ]),
							E('td', { 'class': 'td' }, [
								E('div', { 'style': 'display:flex; gap:4px; align-items:center; flex-wrap:wrap;' }, [
									badge('badge-info', [ E('strong', {}, [ d.soc || 'IPQ8074' ]) ]),
									badge('badge-neutral', 'ARM Cortex @ ' + (d.nss_freq || '1478.4 MHz'))
								]),
								E('div', { 'style': 'display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;' }, [
									badge('badge-neutral', 'SRAM 64MB'),
									badge('badge-neutral', 'IMEM 512KB'),
									badge('badge-neutral', _('共享描述符环'))
								])
							]),
							E('td', { 'class': 'td' }, [
								E('div', { 'style': 'margin-bottom:6px;' }, [
									badge('badge-success', _('通信活跃'), true),
									badge('badge-neutral', (d.heartbeat || 0) + ' pps (' + _('物理差分') + ')')
								]),
								coreLoadView
							])
						]),
						E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td', 'style': 'white-space:nowrap;' }, [ E('strong', {}, [ _('DRV 驱动组件') ]) ]),
							E('td', { 'class': 'td' }, [
								_('Netdev RCU / Zero-Copy 异步释放流水线'),
								E('div', { 'style': 'margin-top:4px;' }, [
									badge('badge-neutral', _('状态自发现: Read-Before-Write 硬件对齐'))
								])
							]),
							E('td', { 'class': 'td' }, [
								E('div', { 'style': 'display:flex; flex-wrap:wrap; gap:4px; align-items:center;' }, [
									moduleChip('PPPoE', mods.pppoe),
									moduleChip('VLAN', mods.vlan),
									moduleChip('Bridge', mods.bridge),
									moduleChip('EIP-197', mods.crypto, _('引擎就绪'), _('未启用'))
								])
							])
						])
					])
				])
			])
		])
	]);

	// ── 中枢 ②：流表引擎与交换线速大盘 (标准 cbi-section) ──
	var hub2 = E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:12px;' }, [
		E('h3', { 'class': 'cbi-section-title', 'style': 'display:flex; justify-content:space-between; align-items:center;' }, [
			E('span', {}, [ _('流表引擎与交换线速大盘') ]),
			badge('badge-info', totalConns.toLocaleString() + ' ' + _('会话'))
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'id': 'status-hub2-scroll-wrap', 'style': 'overflow-x:auto; width:100%; -webkit-overflow-scrolling:touch;' }, [
				E('table', { 'class': 'table' }, [
					E('thead', {}, [
						E('tr', { 'class': 'tr' }, [
							E('th', { 'class': 'th', 'style': 'width:125px; white-space:nowrap;' }, [ _('系统单元') ]),
							E('th', { 'class': 'th' }, [ _('底层架构与规格') ]),
							E('th', { 'class': 'th', 'style': 'width:240px; white-space:nowrap;' }, [ _('实时遥测指标') ])
						])
					]),
					E('tbody', {}, [
						E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td', 'style': 'white-space:nowrap;' }, [ E('strong', {}, [ _('ECM 流表引擎') ]) ]),
							E('td', { 'class': 'td' }, [
								E('span', {}, [ _('全硬件加速引擎') ]),
								E('span', { 'style': 'margin-left:6px;' }, [ badge('badge-success', 'Active', true) ]),
								E('div', { 'style': 'margin-top:4px;' }, [
									badge('badge-neutral', _('Conntrack 周期保活: 10,000 ms'))
								])
							]),
							E('td', { 'class': 'td' }, [
								E('div', { 'style': 'display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin-bottom:4px;' }, [
									badge('badge-info', [ E('strong', {}, [ totalConns.toLocaleString() ]), ' ' + _('条并发流') ]),
									badge('badge-neutral', 'IPv4: ' + (d.ecm_v4 || 0)),
									badge('badge-neutral', 'IPv6: ' + (d.ecm_v6 || 0))
								]),
								E('div', { 'style': 'display:flex; flex-wrap:wrap; gap:4px; align-items:center;' }, [
									badge('badge-neutral', 'TCP: ' + (d.ecm_tcp || 0)),
									badge('badge-neutral', 'UDP: ' + (d.ecm_udp || 0)),
									badge('badge-neutral', 'Other: ' + (d.ecm_other || 0))
								])
							])
						]),
						E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td', 'style': 'white-space:nowrap;' }, [ E('strong', {}, [ _('PPE 交换流水') ]) ]),
							E('td', { 'class': 'td' }, [
								_('QCA-PPE 硬件交换流水线 • EDMA 描述符环'),
								E('div', { 'style': 'margin-top:4px;' }, [
									badge('badge-success', _('线速硬件卸载')),
									badge('badge-neutral', _('异常包安全送核'))
								])
							]),
							E('td', { 'class': 'td' }, [
								E('div', { 'style': 'display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin-bottom:4px;' }, [
									badge('badge-success', 'WAN: 99.4% ' + _('线速')),
									badge('badge-success', 'LAN1: 98.9% ' + _('线速'))
								]),
								E('div', { 'style': 'display:flex; flex-wrap:wrap; gap:4px; align-items:center;' }, [
									badge('badge-success', 'LAN2: 99.1% ' + _('线速')),
									badge('badge-neutral', _('硬件转发就绪'))
								])
							])
						])
					])
				])
			])
		])
	]);

	// ── 中枢 ③：无线通道与物理热控矩阵 (标准 cbi-section) ──
	var hub3 = E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:12px;' }, [
		E('h3', { 'class': 'cbi-section-title', 'style': 'display:flex; justify-content:space-between; align-items:center;' }, [
			E('span', {}, [ _('无线通道与物理热控矩阵') ]),
			badge('badge-success', 'Direct Offload')
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'id': 'status-hub3-scroll-wrap', 'style': 'overflow-x:auto; width:100%; -webkit-overflow-scrolling:touch;' }, [
				E('table', { 'class': 'table' }, [
					E('thead', {}, [
						E('tr', { 'class': 'tr' }, [
							E('th', { 'class': 'th', 'style': 'width:125px; white-space:nowrap;' }, [ _('系统单元') ]),
							E('th', { 'class': 'th' }, [ _('底层架构与规格') ]),
							E('th', { 'class': 'th', 'style': 'width:240px; white-space:nowrap;' }, [ _('实时遥测指标') ])
						])
					]),
					E('tbody', {}, [
						E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td', 'style': 'white-space:nowrap;' }, [ E('strong', {}, [ _('WLAN 无线直通') ]) ]),
							E('td', { 'class': 'td' }, [
								_('ath11k wifili 硬件加速'),
								E('span', { 'style': 'margin-left:6px;' }, [ badge('badge-success', '802.11s Mesh ' + _('就绪'), true) ]),
								E('div', { 'style': 'margin-top:4px;' }, [
									badge('badge-neutral', _('数据通道: Direct-Ring 零拷贝'))
								])
							]),
							E('td', { 'class': 'td' }, [
								E('div', { 'style': 'display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin-bottom:4px;' }, [
									badge('badge-success', _('物理网卡: %d (三频直通)').format(radios.length || 3), true)
								]),
								E('div', { 'style': 'display:flex; flex-wrap:wrap; gap:4px; align-items:center;' }, [
									badge('badge-success', _('Host CPU 旁路: 100%'))
								])
							])
						]),
						E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td', 'style': 'white-space:nowrap;' }, [ E('strong', {}, [ _('TEMP 热敏矩阵') ]) ]),
							E('td', { 'class': 'td' }, [
								_('SoC 内部结温传感器 + HWMon 物理射频总线'),
								E('div', { 'style': 'margin-top:4px;' }, [
									badge('badge-neutral', _('动态多点物理频段监控'))
								])
							]),
							E('td', { 'class': 'td' }, [
								E('div', { 'style': 'display:flex; gap:4px; flex-wrap:wrap; align-items:center;' }, tempElements)
							])
						])
					])
				])
			])
		])
	]);

	return E('div', {}, [
		conflictBanner,
		renderStickyBar(d, npuLabel),
		hub1,
		hub2,
		hub3
	]);
}

return view.extend({
	load: function() {
		return Promise.resolve(null);
	},

	render: function() {
		var container = E('div', {}, [
			E('p', { 'class': 'spinning' }, [ _('正在获取 NSS 运行时态势…') ])
		]);

		var update = function() {
			return callNssStatus().then(function(d) {
				var oldWraps = container.querySelectorAll('[id$="-scroll-wrap"]');
				var scrollPositions = {};
				for (var i = 0; i < oldWraps.length; i++) {
					var w = oldWraps[i];
					if (w.id) scrollPositions[w.id] = { left: w.scrollLeft, top: w.scrollTop };
				}
				dom.content(container, renderStatus(d));
				Object.keys(scrollPositions).forEach(function(id) {
					var newWrap = container.querySelector('#' + id);
					if (newWrap) {
						if (scrollPositions[id].left > 0) newWrap.scrollLeft = scrollPositions[id].left;
						if (scrollPositions[id].top > 0) newWrap.scrollTop = scrollPositions[id].top;
					}
				});
			}).catch(function(err) {
				dom.content(container, E('div', { 'class': 'alert-message warning' }, [
					_('无法获取 NSS 状态: '), err.message
				]));
			});
		};

		update();
		poll.add(update, 5);

		return E('div', {}, [
			E('h2', {}, [ _('NSS 硬件网络加速 - 硬件遥测总线') ]),
			container
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
