'use strict';
'require view';
'require rpc';
'require poll';
'require dom';
'require ui';

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

var staticProfile = null;
var activeTab = 'status'; // 'status' | 'control' | 'ports' | 'flows'
var flowSubTab = 'clients'; // 'clients' | 'all' | 'ipv4' | 'ipv6'

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
		'style': 'height:12px; min-width:100px; position:relative; overflow:hidden; margin:0;',
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

// ── 1. 顶置常驻微型遥测总线状态栏 (最上方，全局吸顶，永不重新卸载) ──
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
	var mods = d.modules || {};
	var totalConns = (d.ecm_total != null) ? d.ecm_total : 0;

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

	var section1 = E('div', { 'class': 'cbi-section nss-module-box' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
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

	var section2 = E('div', { 'class': 'cbi-section nss-module-box' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
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

	var moduleBox = E('div', { 'class': 'cbi-section nss-module-box' }, [
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

function renderPortsCard(d) {
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

	var moduleBox = E('div', { 'class': 'cbi-section nss-module-box' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('以太网物理端口线速卸载矩阵') ]),
			badge('badge-success', _('硬件线速卸载监测'))
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('div', { 'id': 'ports-scroll-wrap', 'style': 'overflow-x:auto; width:100%; -webkit-overflow-scrolling:touch;' }, [
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
		E('div', { 'class': 'cbi-map-descr', 'style': 'font-size:12px; color:var(--text-color-medium);' }, [
			_('说明: “HW Pkts”代表由芯片固件硬件线速转发的数据包；“Host Pkts”代表建链首包握手、广播发现或路由器本机流量；HW % 接近 100% 表明硬件卸载完全生效。')
		])
	]);
}

// ── 6. 子卡 D：硬件流表与聚合 (Flows) ──
function renderFlowsCard(d, onSubTabSwitch) {
	var hostnames = d.hostnames || {};
	var isInstalled = (d.installed !== 0);
	var rawFlows = d.flows || [];

	var clientMap = {};
	var totalPkts = 0;
	var totalBytes = 0;

	var normalizedFlows = rawFlows.map(function(f) {
		var srcIp = f.src || '';
		var sport = f.sport || '';
		var dstIp = f.dst || '';
		var dport = f.dport || '';

		if (sport && srcIp.lastIndexOf(':') === -1) srcIp = srcIp + ':' + sport;
		if (dport && dstIp.lastIndexOf(':') === -1) dstIp = dstIp + ':' + dport;

		var pkts = (f.orig_pkts != null || f.repl_pkts != null)
			? ((parseInt(f.orig_pkts) || 0) + (parseInt(f.repl_pkts) || 0))
			: (parseInt(f.pkts) || 0);

		var bytes = (f.orig_bytes != null || f.repl_bytes != null)
			? ((parseInt(f.orig_bytes) || 0) + (parseInt(f.repl_bytes) || 0))
			: (parseInt(f.bytes) || 0);

		return {
			proto: String(f.proto || 'TCP').toUpperCase(),
			family: f.family || ((srcIp.indexOf('.') !== -1) ? 'ipv4' : 'ipv6'),
			src: srcIp,
			srcIpOnly: f.src || srcIp.split(':')[0],
			dst: dstIp,
			pkts: pkts,
			bytes: bytes
		};
	});

	normalizedFlows.forEach(function(f) {
		var srcIp = f.srcIpOnly;
		totalPkts += f.pkts;
		totalBytes += f.bytes;

		if (!clientMap[srcIp]) {
			clientMap[srcIp] = {
				ip: srcIp,
				hostName: hostnames[srcIp] || srcIp,
				totalPkts: 0,
				totalBytes: 0,
				flowCount: 0,
				protos: {}
			};
		}
		clientMap[srcIp].totalPkts += f.pkts;
		clientMap[srcIp].totalBytes += f.bytes;
		clientMap[srcIp].flowCount++;
		clientMap[srcIp].protos[f.proto] = true;
	});

	var clientsList = Object.keys(clientMap).map(function(k) { return clientMap[k]; });

	var filteredFlows = normalizedFlows;
	if (flowSubTab === 'ipv4') {
		filteredFlows = normalizedFlows.filter(function(f) { return f.family === 'ipv4' || f.src.indexOf('.') !== -1; });
	} else if (flowSubTab === 'ipv6') {
		filteredFlows = normalizedFlows.filter(function(f) { return f.family === 'ipv6' || f.src.indexOf('.') === -1; });
	}

	var tabMenuItems = [
		{ id: 'clients', label: _('客户端聚合') },
		{ id: 'all',     label: _('全量明细') },
		{ id: 'ipv4',    label: _('IPv4 流') },
		{ id: 'ipv6',    label: _('IPv6 流') }
	].map(function(tab) {
		var isActive = (flowSubTab === tab.id);
		return E('li', { 'class': 'cbi-tab' + (isActive ? ' active' : '') }, [
			E('a', {
				'style': isActive ? 'font-weight:bold; color:var(--text-color-high);' : '',
				'click': function(ev) {
					ev.preventDefault();
					flowSubTab = tab.id;
					if (onSubTabSwitch) onSubTabSwitch();
				}
			}, [ tab.label ])
		]);
	});

	var tableBody;
	if (!isInstalled) {
		tableBody = E('div', { 'class': 'alert-message notice', 'style': 'margin:14px; text-align:center; padding:16px;' }, [
			E('strong', { 'style': 'font-size:13px;' }, [ _('提示：当前固件未安装 nssqos 扩展组件，硬件流表不可用') ]),
			E('p', { 'style': 'margin-top:6px; color:var(--text-color-medium); font-size:12px;' }, [
				_('硬件流表连接明细依赖 nssqos-conns 工具。该工具为可选特性组件，不影响底层 NSS 硬件网络加速核心线速转发功能。若需使用此大盘，可在编译配置中添加 nssqos 包。')
			])
		]);
	} else if (flowSubTab === 'clients') {
		var clientRows = clientsList.map(function(c) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'data-title': 'Host' }, [ E('strong', { 'style': 'white-space:nowrap;' }, [ c.hostName ]) ]),
				E('td', { 'class': 'td', 'data-title': 'IP' }, [ E('code', { 'style': 'white-space:nowrap;' }, [ c.ip ]) ]),
				E('td', { 'class': 'td', 'data-title': 'Conns', 'style': 'white-space:nowrap;' }, [ c.flowCount + ' ' + _('条连接') ]),
				E('td', { 'class': 'td', 'data-title': 'Pkts', 'style': 'white-space:nowrap;' }, [ c.totalPkts.toLocaleString() + ' pkts' ]),
				E('td', { 'class': 'td', 'data-title': 'Bytes', 'style': 'white-space:nowrap;' }, [ String.format('%1024.1mB', c.totalBytes) ]),
				E('td', { 'class': 'td', 'data-title': 'Proto' }, [
					E('div', { 'style': 'display:inline-flex; gap:4px; flex-wrap:wrap;' },
						Object.keys(c.protos).map(function(pr) {
							var protoCls = (pr === 'TCP') ? 'badge-info' : (pr === 'UDP') ? 'badge-warning' : 'badge-neutral';
							return badge(protoCls, pr);
						})
					)
				])
			]);
		});

		if (!clientRows.length) {
			clientRows = [
				E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'colspan': '6', 'style': 'text-align:center; color:var(--text-color-medium);' }, [
						_('当前暂无活跃的客户端硬件加速流')
					])
				])
			];
		}

		tableBody = E('div', { 'id': 'flows-scroll-wrap', 'style': 'overflow-x:auto; width:100%; -webkit-overflow-scrolling:touch;' }, [
			E('table', { 'class': 'table' }, [
				E('thead', {}, [
					E('tr', { 'class': 'tr table-titles' }, [
						E('th', { 'class': 'th', 'style': 'white-space:nowrap;' }, [ 'Host' ]),
						E('th', { 'class': 'th', 'style': 'white-space:nowrap;' }, [ 'IP' ]),
						E('th', { 'class': 'th', 'style': 'white-space:nowrap;' }, [ 'Conns' ]),
						E('th', { 'class': 'th', 'style': 'white-space:nowrap;' }, [ 'Pkts' ]),
						E('th', { 'class': 'th', 'style': 'white-space:nowrap;' }, [ 'Bytes' ]),
						E('th', { 'class': 'th', 'style': 'white-space:nowrap;' }, [ 'Proto' ])
					])
				]),
				E('tbody', {}, clientRows)
			])
		]);
	} else {
		var flowRows = filteredFlows.map(function(f) {
			var srcName = hostnames[f.srcIpOnly];
			var protoCls = (f.proto === 'TCP') ? 'badge-info' : (f.proto === 'UDP') ? 'badge-warning' : 'badge-neutral';

			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'data-title': 'Proto', 'style': 'white-space:nowrap;' }, [
					badge(protoCls, f.proto || 'TCP')
				]),
				E('td', { 'class': 'td', 'data-title': 'Src' }, [
					srcName ? E('strong', { 'style': 'white-space:nowrap; margin-right:6px;' }, [ srcName ]) : '',
					E('code', { 'style': 'font-size:11px; white-space:nowrap;' }, [ f.src || '-' ])
				]),
				E('td', { 'class': 'td', 'data-title': 'Dst' }, [
					E('code', { 'style': 'font-size:11px; white-space:nowrap;' }, [ f.dst || '-' ])
				]),
				E('td', { 'class': 'td', 'data-title': 'Pkts', 'style': 'white-space:nowrap;' }, [ (parseInt(f.pkts) || 0).toLocaleString() + ' pkts' ]),
				E('td', { 'class': 'td', 'data-title': 'Bytes', 'style': 'white-space:nowrap;' }, [ String.format('%1024.1mB', parseInt(f.bytes) || 0) ])
			]);
		});

		if (!flowRows.length) {
			flowRows = [
				E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'colspan': '5', 'style': 'text-align:center; color:var(--text-color-medium);' }, [
						_('当前分类下暂无活跃硬件加速流')
					])
				])
			];
		}

		tableBody = E('div', { 'id': 'flows-scroll-wrap', 'style': 'overflow-x:auto; width:100%; -webkit-overflow-scrolling:touch;' }, [
			E('table', { 'class': 'table' }, [
				E('thead', {}, [
					E('tr', { 'class': 'tr table-titles' }, [
						E('th', { 'class': 'th', 'style': 'white-space:nowrap;' }, [ 'Proto' ]),
						E('th', { 'class': 'th', 'style': 'white-space:nowrap;' }, [ 'Src' ]),
						E('th', { 'class': 'th', 'style': 'white-space:nowrap;' }, [ 'Dst' ]),
						E('th', { 'class': 'th', 'style': 'white-space:nowrap;' }, [ 'Pkts' ]),
						E('th', { 'class': 'th', 'style': 'white-space:nowrap;' }, [ 'Bytes' ])
					])
				]),
				E('tbody', {}, flowRows)
			])
		]);
	}

	var moduleBox = E('div', { 'class': 'cbi-section nss-module-box' }, [
		E('h3', { 'class': 'cbi-section-title' }, [
			E('span', {}, [ _('NSS 硬件流表与连接概况') ]),
			badge('badge-info', isInstalled ? (rawFlows.length + ' ' + _('活动流')) : _('未安装 nssqos'))
		]),
		E('div', { 'class': 'cbi-section-node' }, [
			E('table', { 'class': 'table', 'style': 'margin-bottom:0;' }, [
				E('tbody', {}, [
					E('tr', { 'class': 'tr' }, [
						E('td', { 'class': 'td left', 'style': 'width:25%; font-weight:600;' }, [ _('硬件加速连接总数') ]),
						E('td', { 'class': 'td left', 'style': 'width:25%;' }, [ isInstalled ? (rawFlows.length + ' ' + _('条并发流')) : '-' ]),
						E('td', { 'class': 'td left', 'style': 'width:25%; font-weight:600;' }, [ _('硬件加速总报文/字节') ]),
						E('td', { 'class': 'td left', 'style': 'width:25%;' }, [
							isInstalled ? (totalPkts.toLocaleString() + ' pkts (' + String.format('%1024.1mB', totalBytes) + ')') : '-'
						])
					])
				])
			]),
			isInstalled ? E('div', { 'style': 'padding:10px 12px 0 12px;' }, [
				E('ul', { 'class': 'cbi-tabmenu', 'style': 'margin-bottom:12px; gap:4px;' }, tabMenuItems)
			]) : E('div'),
			tableBody
		])
	]);

	return moduleBox;
}

// ── 7. SPA 统一主入口视图 ──
return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callGetStatus(), {}),
			L.resolveDefault(callGetSettings(), {}),
			L.resolveDefault(callGetPorts(), {}),
			L.resolveDefault(callGetFlows(), {})
		]).then(function(res) {
			return fetchPortStats(res[2] || {}).then(function(pData) {
				return [ res[0], res[1], pData, res[3] ];
			});
		});
	},

	render: function(initData) {
		ensureCss();

		var statusData   = initData[0] || {};
		var settingsData = initData[1] || {};
		var portsData    = initData[2] || {};
		var flowsData    = initData[3] || {};

		if (!staticProfile && statusData.soc) {
			staticProfile = {
				soc: statusData.soc,
				cores: statusData.cores,
				nss_freq: statusData.nss_freq,
				fw_version: statusData.fw_version,
				fw_mask: statusData.fw_mask
			};
		}
		var p = staticProfile || statusData;

		// 检查 Hash 或路径参数以支持直接定位子卡
		var hash = (window.location.hash || '').replace('#', '');
		if (hash && ['status', 'control', 'ports', 'flows'].indexOf(hash) !== -1) {
			activeTab = hash;
		} else {
			var path = window.location.pathname || '';
			if (path.indexOf('/control') !== -1) activeTab = 'control';
			else if (path.indexOf('/ports') !== -1) activeTab = 'ports';
			else if (path.indexOf('/flows') !== -1) activeTab = 'flows';
			else activeTab = 'status';
		}

		// 顶置常驻遥测总线状态栏容器
		var stickyBarContainer = E('div', {}, [ renderStickyBar(statusData, p) ]);
		var conflictContainer = E('div', {}, [ renderConflictBanner(statusData) ]);

		// 子卡内容挂载容器
		var subCardContainer = E('div', { 'id': 'nss-subcard-mount' });

		// 子选项卡渲染
		var subTabsDef = [
			{ id: 'status',  label: _('状态总览') },
			{ id: 'control', label: _('控制防御') },
			{ id: 'ports',   label: _('端口线速') },
			{ id: 'flows',   label: _('硬件流表') }
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
		function renderActiveCard() {
			if (activeTab === 'status') {
				dom.content(subCardContainer, renderStatusCard(statusData, p));
			} else if (activeTab === 'control') {
				dom.content(subCardContainer, renderControlCard(settingsData, statusData));
			} else if (activeTab === 'ports') {
				dom.content(subCardContainer, renderPortsCard(portsData));
			} else if (activeTab === 'flows') {
				var refreshFlows = function() {
					var oldWrap = subCardContainer.querySelector('#flows-scroll-wrap');
					var prevScroll = oldWrap ? oldWrap.scrollLeft : 0;
					dom.content(subCardContainer, renderFlowsCard(flowsData, refreshFlows));
					var newWrap = subCardContainer.querySelector('#flows-scroll-wrap');
					if (newWrap && prevScroll > 0) newWrap.scrollLeft = prevScroll;
				};
				refreshFlows();
			}
		}

		renderSubTabs();
		renderActiveCard();

		// ── 轮询任务调度 (常驻遥测栏持续运行，子卡按需按时拉取) ──
		var update = function() {
			var tasks = [ callGetStatus() ];

			if (activeTab === 'ports') {
				tasks.push(callGetPorts());
			} else if (activeTab === 'flows') {
				tasks.push(callGetFlows());
			}

			return Promise.all(tasks).then(function(res) {
				statusData = res[0] || {};
				dom.content(stickyBarContainer, renderStickyBar(statusData, p));
				dom.content(conflictContainer, renderConflictBanner(statusData));

				if (activeTab === 'status') {
					dom.content(subCardContainer, renderStatusCard(statusData, p));
				} else if (activeTab === 'ports' && res[1]) {
					fetchPortStats(res[1]).then(function(pData) {
						portsData = pData;
						var oldWrap = subCardContainer.querySelector('#ports-scroll-wrap');
						var prevScroll = oldWrap ? oldWrap.scrollLeft : 0;
						dom.content(subCardContainer, renderPortsCard(portsData));
						var newWrap = subCardContainer.querySelector('#ports-scroll-wrap');
						if (newWrap && prevScroll > 0) newWrap.scrollLeft = prevScroll;
					});
				} else if (activeTab === 'flows' && res[1]) {
					flowsData = res[1];
					var oldWrap = subCardContainer.querySelector('#flows-scroll-wrap');
					var prevScroll = oldWrap ? oldWrap.scrollLeft : 0;
					dom.content(subCardContainer, renderFlowsCard(flowsData, function() {
						dom.content(subCardContainer, renderFlowsCard(flowsData));
					}));
					var newWrap = subCardContainer.querySelector('#flows-scroll-wrap');
					if (newWrap && prevScroll > 0) newWrap.scrollLeft = prevScroll;
				}
			}).catch(function(err) {
				// 静默防抖，不打断用户浏览
			});
		};

		poll.add(update, 4);

		return E('div', { 'class': 'nss-dashboard-spa' }, [
			stickyBarContainer,
			conflictContainer,
			E('div', { 'class': 'cbi-section', 'style': 'background:transparent; border:none; margin:0 0 16px 0; padding:0;' }, [ tabMenuContainer ]),
			subCardContainer
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
