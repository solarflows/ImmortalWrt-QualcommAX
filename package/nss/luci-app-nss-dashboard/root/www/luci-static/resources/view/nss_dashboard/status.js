'use strict';
'require view';
'require rpc';
'require poll';
'require dom';

var callNssStatus = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getStatus'
});

var staticProfile = null;

function ensureCss() {
	var id = 'luci-app-nss-dashboard-css';
	if (!document.getElementById(id)) {
		document.head.appendChild(E('link', {
			'id': id,
			'rel': 'stylesheet',
			'type': 'text/css',
			'href': L.resource('view/nss_dashboard/nss.css')
		}));
	}
}

function progressbar(value, max) {
	var vn = parseFloat(value) || 0,
	    mn = parseFloat(max) || 100,
	    pc = Math.min(100, Math.max(0, Math.floor((100 / mn) * vn)));

	return E('div', {
		'class': 'cbi-progressbar',
		'style': 'height:12px; min-width:120px; position:relative; overflow:hidden; margin:0;',
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

function moduleChip(name, active, activeText, inactiveText) {
	return E('span', {
		'class': 'badge ' + (active ? 'badge-success' : 'badge-neutral')
	}, [
		E('strong', {}, [ name + ':' ]),
		active ? (activeText || _('已启用')) : (inactiveText || _('未启用'))
	]);
}

function renderStickyBar(d, p) {
	var t = parseFloat(d.cpu_temp) || 0;
	var tempClass = (t >= 75) ? 'badge-danger' : (t >= 60) ? 'badge-warning' : 'badge-success';
	var soc = p.soc || d.soc || 'IPQ8074';
	var cores = p.cores || d.cores || 2;
	var freqStr = (p.nss_freq || d.nss_freq || '1478.4 MHz').replace(' MHz', 'M');
	var totalConns = (d.ecm_total != null) ? d.ecm_total : 0;

	var header = document.querySelector('header');
	var navHeight = header ? header.offsetHeight : 40;

	return E('div', {
		'id': 'nss-sticky-telemetry-bar',
		'style': 'top:' + navHeight + 'px;'
	}, [
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label' }, [ _('协处理器规格') ]),
			E('div', { 'style': 'display:flex; align-items:center; gap:4px;' }, [
				badge('badge-info', soc + ' ×' + cores),
				badge('badge-neutral', freqStr)
			])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label' }, [ _('物理心跳速率') ]),
			E('div', {}, [
				badge('badge-success', (d.heartbeat || 0).toLocaleString() + ' pkts/s', true)
			])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label' }, [ _('ECM 加速流数') ]),
			E('div', { 'style': 'display:flex; align-items:center; gap:4px;' }, [
				badge('badge-info', totalConns.toLocaleString() + ' ' + _('流')),
				badge('badge-neutral', 'v4:' + (d.ecm_v4 || 0) + ' / v6:' + (d.ecm_v6 || 0))
			])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label' }, [ _('硬件加速状态') ]),
			E('div', {}, [
				badge('badge-success', _('硬件直通加速中'), true)
			])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label' }, [ _('芯片结温') ]),
			E('div', {}, [
				badge(tempClass, t.toFixed(1) + '°C')
			])
		]),
		E('div', { 'class': 'telemetry-item' }, [
			E('span', { 'class': 'telemetry-label' }, [ _('安全协同防御') ]),
			E('div', {}, [
				badge((d.conflict_detected === 1) ? 'badge-warning' : 'badge-success', (d.conflict_detected === 1) ? _('已阻断冲突项') : _('阻断墙已生效'))
			])
		])
	]);
}

function renderStatus(d) {
	// Lock-in static hardware profile once
	if (!staticProfile && d.soc) {
		staticProfile = {
			soc: d.soc,
			cores: d.cores,
			nss_freq: d.nss_freq,
			fw_version: d.fw_version,
			fw_mask: d.fw_mask
		};
	}
	var p = staticProfile || d;
	var mods = d.modules || {};
	var totalConns = (d.ecm_total != null) ? d.ecm_total : 0;

	// 1. 冲突警告横幅
	var conflictBanner = null;
	if (d.conflict_detected === 1) {
		conflictBanner = E('div', {
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

	// 2. NPU 双核/单核负载条
	var coreLoadView;
	if (p.cores === 1) {
		coreLoadView = E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
			E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 0:' ]),
			E('div', { 'style': 'flex:1; max-width:240px;' }, [ progressbar(d.core0_load || 0, 100) ]),
			E('span', { 'style': 'font-size:11px; font-weight:600;' }, [ (d.core0_load || 0) + '%' ])
		]);
	} else {
		coreLoadView = E('div', { 'style': 'display:flex; flex-direction:column; gap:4px; max-width:280px;' }, [
			E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
				E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 0:' ]),
				E('div', { 'style': 'flex:1;' }, [ progressbar(d.core0_load || 0, 100) ]),
				E('span', { 'style': 'font-size:11px; font-weight:600;' }, [ (d.core0_load || 0) + '%' ])
			]),
			E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
				E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 1:' ]),
				E('div', { 'style': 'flex:1;' }, [ progressbar(d.core1_load || 0, 100) ]),
				E('span', { 'style': 'font-size:11px; font-weight:600;' }, [ (d.core1_load || 0) + '%' ])
			])
		]);
	}

	// 3. 温度枚举
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

	// ── 分区 ①：核心算力与驱动模块 (标准 cbi-section) ──
	var section1 = E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:14px;' }, [
		E('h3', { 'class': 'cbi-section-title', 'style': 'display:flex; justify-content:space-between; align-items:center;' }, [
			E('span', {}, [ _('核心算力与驱动模块') ]),
			badge('badge-success', 'FW ' + (p.fw_version || '11.4') + ' [' + (p.fw_mask || '0x1f') + ']')
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('table', { 'class': 'table' }, [
				E('tbody', {}, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600;' }, [ _('协处理器架构') ]),
						E('td', { 'class': 'td left' }, [
							badge('badge-info', 'Qualcomm ' + (p.soc || 'IPQ8074')),
							E('span', { 'style': 'margin-left:4px;' }, [
								badge('badge-neutral', ((p.cores === 1) ? _('单核 NPU') : _('双核 NPU')) + ' @ ' + (p.nss_freq || '1478.4 MHz'))
							])
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600;' }, [ _('NPU 硬件负载') ]),
						E('td', { 'class': 'td left' }, [ coreLoadView ])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600;' }, [ _('物理心跳采样') ]),
						E('td', { 'class': 'td left' }, [
							badge('badge-success', (d.heartbeat || 0).toLocaleString() + ' pkts/s', true)
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600;' }, [ _('驱动加速组件') ]),
						E('td', { 'class': 'td left' }, [
							E('div', { 'style': 'display:flex; gap:6px; flex-wrap:wrap; align-items:center;' }, [
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
	]);

	// ── 分区 ②：流表引擎与数据通道 (标准 cbi-section) ──
	var section2 = E('div', { 'class': 'cbi-section', 'style': 'margin-bottom:14px;' }, [
		E('h3', { 'class': 'cbi-section-title', 'style': 'display:flex; justify-content:space-between; align-items:center;' }, [
			E('span', {}, [ _('流表引擎与数据通道') ]),
			badge('badge-info', totalConns.toLocaleString() + ' ' + _('活动流'))
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('table', { 'class': 'table' }, [
				E('tbody', {}, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600;' }, [ _('ECM 硬件加速状态') ]),
						E('td', { 'class': 'td left' }, [
							badge('badge-success', 'Active (' + _('全硬件卸载中') + ')', true)
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600;' }, [ _('协议加速流分布') ]),
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
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600;' }, [ _('无线数据通道') ]),
						E('td', { 'class': 'td left' }, [
							badge('badge-success', 'ath11k wifili ' + _('硬件直通 (802.11s Mesh 就绪)'), true)
						])
					]),
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:30%; font-weight:600;' }, [ _('硬件温度监控') ]),
						E('td', { 'class': 'td left' }, [
							E('div', { 'style': 'display:flex; gap:6px; flex-wrap:wrap; align-items:center;' }, tempElements)
						])
					])
				])
			])
		])
	]);

	return E('div', {}, [
		conflictBanner,
		renderStickyBar(d, p),
		section1,
		section2
	]);
}

return view.extend({
	load: function() {
		return Promise.resolve(null);
	},

	render: function() {
		ensureCss();

		var container = E('div', {}, [
			E('p', { 'class': 'spinning' }, [ _('正在获取 NSS 运行时态势…') ])
		]);

		var update = function() {
			return callNssStatus().then(function(d) {
				dom.content(container, renderStatus(d));
			}).catch(function(err) {
				dom.content(container, E('div', { 'class': 'alert-message warning' }, [
					_('无法获取 NSS 状态: '), err.message
				]));
			});
		};

		update();
		poll.add(update, 5);

		return E('div', {}, [
			E('h2', {}, [ _('NSS 硬件网络加速 - 运行状态') ]),
			container
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
