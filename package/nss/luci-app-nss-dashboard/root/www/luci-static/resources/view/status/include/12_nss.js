'use strict';
'require baseclass';
'require rpc';

var callNssStatus = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getStatus'
});

var prevCpuTicks = null;

function ensureCss() {
	var id = 'luci-app-nss-dashboard-css';
	var el = document.getElementById(id);
	if (!el) {
		document.head.appendChild(E('link', {
			'id': id,
			'rel': 'stylesheet',
			'type': 'text/css',
			'href': L.resource('view/nss_dashboard/nss.css') + '?v=261024a'
		}));
	} else if (el.href.indexOf('?v=261024a') === -1) {
		el.href = L.resource('view/nss_dashboard/nss.css') + '?v=261024a';
	}
}

function progressbar(value, max, label) {
	if (value === null || value === undefined) {
		return E('div', {
			'class': 'cbi-progressbar disabled nss-bar',
			'style': 'height:14px; min-width:80px; position:relative; overflow:hidden; margin:0; border:none !important;',
			'title': label || _('待机 (无服务固件或未引导)')
		}, [
			E('span', { 'style': 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding-top:1px; font-size:10px; font-weight:500; color:var(--text-color-medium);' }, [
				label || _('休眠待机')
			])
		]);
	}
	var vn = parseFloat(value) || 0,
	    mn = parseFloat(max) || 100,
	    pc = Math.min(100, Math.max(0, Math.floor((100 / mn) * vn)));

	return E('div', {
		'class': 'cbi-progressbar nss-bar',
		'style': 'height:14px; min-width:80px; position:relative; overflow:hidden; margin:0; border:none !important;',
		'title': '%s%%'.format(vn)
	}, [
		E('div', {
			'style': 'width:%.2f%%; height:100%; transition:width 0.3s ease;'.format(pc),
			'class': (vn > 80) ? 'cbi-progressbar-danger' : (vn > 50) ? 'cbi-progressbar-warn' : ''
		}),
		label ? E('span', { 'style': 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding-top:1px; font-size:10px; font-weight:bold; white-space:nowrap;' }, [
			label
		]) : ''
	]);
}

function hostCpuProgressbar(total, usr, sys, sirq) {
	var vn = parseFloat(total) || 0;
	var u = Math.max(0, parseFloat(usr) || 0);
	var s = Math.max(0, parseFloat(sys) || 0);
	var si = Math.max(0, parseFloat(sirq) || 0);
	var label = 'usr: ' + u.toFixed(0) + '% • sys: ' + s.toFixed(0) + '% • sirq: ' + si.toFixed(0) + '%';

	return E('div', {
		'class': 'cbi-progressbar nss-bar nss-stacked',
		'style': 'height:14px; min-width:80px; position:relative; overflow:hidden; margin:0; display:flex; border:none !important; background:var(--background-color-medium, rgba(255,255,255,0.08));',
		'title': 'CPU: ' + vn.toFixed(1) + '% (usr: ' + u.toFixed(1) + '% sys: ' + s.toFixed(1) + '% sirq: ' + si.toFixed(1) + '%)'
	}, [
		E('div', { 'style': 'width:' + u.toFixed(1) + '%; height:100%; background:var(--primary-color-medium, #1976d2); transition:width 0.3s ease;' }),
		E('div', { 'style': 'width:' + s.toFixed(1) + '%; height:100%; background:var(--warn-color-high, #efbd0b); transition:width 0.3s ease;' }),
		E('div', { 'style': 'width:' + si.toFixed(1) + '%; height:100%; background:var(--error-color-high, #f62b12); transition:width 0.3s ease;' }),
		E('span', {
			'style': 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding-top:1px; font-size:10px; font-weight:600; white-space:nowrap; text-shadow:0 0 2px rgba(0,0,0,0.9);'
		}, [ label ])
	]);
}

function row(label, value, hint) {
	var labelEl = hint ? E('span', {
		'title': hint,
		'style': 'cursor:help; border-bottom:1px dotted var(--text-color-medium, rgba(255,255,255,0.3));'
	}, [ label ]) : label;

	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'style': 'width:33%; min-width:85px; font-weight:600; white-space:nowrap;' }, [ labelEl ]),
		E('td', { 'class': 'td left' }, Array.isArray(value) ? value : [ value ])
	]);
}

function moduleChip(name, state, customLabel, customTitle) {
	var cls, label;
	if (state === 2) {
		cls = 'badge-success';
		label = customLabel || _('运行中');
	} else if (state === 1) {
		cls = 'badge-info';
		label = customLabel || _('就绪待命');
	} else {
		cls = 'badge-neutral';
		label = customLabel || _('未安装');
	}
	return E('span', {
		'class': 'badge ' + cls + ' badge-tile-102',
		'title': customTitle || (name + ': ' + label)
	}, [
		(state === 2) ? E('span', { 'class': 'badge-dot' }) : '',
		E('strong', {}, [ name + ':' ]),
		label
	]);
}

function tempBadge(label, temp) {
	var t = parseFloat(temp) || 0;
	var cls = (t >= 75) ? 'badge-danger' : (t >= 60) ? 'badge-warning' : 'badge-success';

	return E('span', {
		'class': 'badge ' + cls + ' badge-tile-102',
		'title': label + ': ' + t.toFixed(1) + '°C'
	}, [
		E('strong', {}, [ label + ':' ]),
		t.toFixed(1) + '°C'
	]);
}

return baseclass.extend({
	title: _('NSS 硬件网络加速'),

	load: function() {
		return Promise.all([
			L.resolveDefault(callNssStatus(), {})
		]);
	},

	render: function(data) {
			ensureCss();

			var d = data[0] || {};
			if (!d.soc)
				return null;

			var npuLabel = (d.cores === 1) ? 'NPU ×1' : 'NPU ×2';
			var freqStr = d.nss_freq ? (npuLabel + ' @ ' + d.nss_freq) : npuLabel;

			// 1. 协处理器规格与微码心跳 (结构化双行视窗)
			var rawFw = d.fw_version || '12.5';
			var fwMask = d.fw_mask || '';
			var fwStr = 'FW ' + rawFw.replace(/^NSS\.(FW\.)?/, '') + (fwMask && fwMask !== '0x0' ? ' [' + fwMask + ']' : '');
			var heartbeatStr = (d.heartbeat != null ? Number(d.heartbeat).toLocaleString() : '0') + ' pkts/s';

			var specView = E('div', { 'style': 'display:flex; flex-direction:column; gap:2px;' }, [
				E('div', { 'style': 'font-weight:600; font-size:12px; color:var(--text-color-high);' }, [
					(d.soc || 'IPQ8074') + ' • ' + freqStr
				]),
				E('div', {
					'style': 'font-size:11px; color:var(--text-color-medium); line-height:1.4;',
					'title': rawFw + (fwMask ? ' (fw_mask: ' + fwMask + ')' : '')
				}, [
					fwStr + ' • ' + _('心跳') + ': ' + heartbeatStr
				])
			]);

			// 2. 模块状态 (全加速子系统徽章矩阵，严格统一 102px 等宽卡片)
			var mods = d.modules || {};
			var wifiChip = (d.wifi_offload === 1)
				? moduleChip('Wi-Fi', 2, _('已加速'), _('ath11k wifili 硬件加速已就绪 (802.11s Mesh 支持)'))
				: moduleChip('Wi-Fi', 0, _('主机模式'), _('无线数据流未经 NSS 卸载'));

			var sqmChip;
			if (d.sqm === 2) {
				sqmChip = moduleChip('SQM', 2, _('硬件队列'), _('NSS 硬件队列加速运行中 (CAKE/FQ-CoDel 硬件调度)'));
			} else if (d.sqm === 1) {
				sqmChip = moduleChip('SQM', 1, _('主机队列'), _('主机软件队列整形运行中'));
			} else if (d.sqm === 0) {
				sqmChip = moduleChip('SQM', 0, _('未启用'), _('未启用 (已配置备用)'));
			} else {
				sqmChip = moduleChip('SQM', 0, _('未安装'), _('未安装 sqm-scripts'));
			}

			var modulesView = E('div', { 'style': 'display:inline-grid; grid-template-columns:repeat(3, 102px); gap:6px;' }, [
				moduleChip('Bridge', mods.bridge),
				moduleChip('PPPoE', mods.pppoe),
				wifiChip,
				sqmChip,
				moduleChip('VLAN', mods.vlan),
				moduleChip('Qdisc', mods.qdisc),
				moduleChip('EIP-197', mods.crypto)
			]);

			// 3. 核心计算负载 (CPU 与 NPU 双核/单核纯净条体矩阵，严格 280px 像素级纵向等宽对齐)
			var computeLoadElements = [];
			if (Array.isArray(d.cpu_ticks) && d.cpu_ticks.length >= 7) {
				var cur = d.cpu_ticks;
				var totalLoad = 0, usrRate = 0, sysRate = 0, sirqRate = 0;
				if (prevCpuTicks && prevCpuTicks.length >= 7) {
					var du = cur[0] - prevCpuTicks[0];
					var dn = cur[1] - prevCpuTicks[1];
					var ds = cur[2] - prevCpuTicks[2];
					var did = cur[3] - prevCpuTicks[3];
					var dio = cur[4] - prevCpuTicks[4];
					var dirq = cur[5] - prevCpuTicks[5];
					var dsirq = cur[6] - prevCpuTicks[6];
					var dst = (cur[7] || 0) - (prevCpuTicks[7] || 0);
					var dtot = du + dn + ds + did + dio + dirq + dsirq + dst;
					if (dtot > 0) {
						totalLoad = Math.max(0, Math.min(100, ((dtot - did - dio) / dtot) * 100));
						usrRate = Math.max(0, Math.min(100, ((du + dn) / dtot) * 100));
						sysRate = Math.max(0, Math.min(100, (ds / dtot) * 100));
						sirqRate = Math.max(0, Math.min(100, (dsirq / dtot) * 100));
					}
				}
				prevCpuTicks = cur;

				computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
					E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'CPU:' ]),
					E('div', { 'style': 'flex:1;' }, [
						hostCpuProgressbar(totalLoad, usrRate, sysRate, sirqRate)
					]),
					E('span', { 'style': 'font-size:11px; font-weight:600; min-width:28px; text-align:right;' }, [ totalLoad.toFixed(0) + '%' ])
				]));
			}

			if (d.cores === 1) {
				computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
					E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 0:' ]),
					E('div', { 'style': 'flex:1;' }, [ progressbar(d.core0_load || 0, 100) ]),
					E('span', { 'style': 'font-size:11px; font-weight:600; min-width:28px; text-align:right;' }, [ (d.core0_load || 0) + '%' ])
				]));
			} else {
				var isCore1Active = (d.core1_load !== null && d.core1_load !== undefined);
				computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
					E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 0:' ]),
					E('div', { 'style': 'flex:1;' }, [ progressbar(d.core0_load || 0, 100) ]),
					E('span', { 'style': 'font-size:11px; font-weight:600; min-width:28px; text-align:right;' }, [ (d.core0_load || 0) + '%' ])
				]));
				computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
					E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 1:' ]),
					E('div', { 'style': 'flex:1;' }, [
						isCore1Active ? progressbar(d.core1_load, 100) : progressbar(null, 100, _('休眠待机'))
					]),
					E('span', {
						'style': 'font-size:11px; font-weight:600; min-width:28px; text-align:right; color:' + (isCore1Active ? 'inherit' : 'var(--text-color-medium)') + ';',
						'title': isCore1Active ? '' : _('NPU Core 1 物理待机 (无蜂窝/IPsec服务固件)')
					}, [
						isCore1Active ? ((d.core1_load || 0) + '%') : _('待机')
					])
				]));
			}

			var computeLoadView = E('div', { 'style': 'display:flex; flex-direction:column; gap:4px; max-width:280px;' }, computeLoadElements);

			// 4. 硬件遥测 (ECM 并发流表与物理温度 102px 等宽卡片网格)
			var totalConns = (d.ecm_total != null) ? d.ecm_total : 0;
			var ecmTotalChip = E('span', {
				'class': 'badge badge-info',
				'title': _('当前经由高通增强连接管理器 (ECM) 卸载的硬件并发流总数'),
				'style': 'min-width:102px; justify-content:center; box-sizing:border-box; text-align:center; margin:1px 0;'
			}, [
				E('span', { 'class': 'badge-dot' }),
				E('strong', {}, [ 'ECM:' ]),
				totalConns.toLocaleString() + ' ' + _('流')
			]);

			var ecmDistChip = E('span', {
				'class': 'badge badge-neutral',
				'title': 'IPv4: ' + (d.ecm_v4 || 0) + ' • IPv6: ' + (d.ecm_v6 || 0),
				'style': 'min-width:102px; justify-content:center; box-sizing:border-box; text-align:center; margin:1px 0;'
			}, [
				E('strong', {}, [ 'v4/v6:' ]),
				(d.ecm_v4 || 0) + '/' + (d.ecm_v6 || 0)
			]);

			var tempElements = [];
			if (d.cpu_temp && parseFloat(d.cpu_temp) > 0)
				tempElements.push(tempBadge('CPU', d.cpu_temp));

			var radios = d.radios || [];
			for (var i = 0; i < radios.length; i++) {
				if (radios[i].temp && parseFloat(radios[i].temp) > 0)
					tempElements.push(tempBadge(radios[i].id, radios[i].temp));
			}

			var telemetryView = E('div', {
				'style': 'display:inline-grid; grid-template-columns:repeat(3, 102px); gap:6px;'
			}, [ ecmTotalChip, ecmDistChip ].concat(tempElements));

			// 统一 4 行纯净架构 (各行 Label 统一为规整 4 字，消除长短参差)
			var table = E('table', { 'class': 'table' }, [
				row(_('协处理器'), specView, _('高通网络子系统 (NSS) 硬件卸载协处理器，内置独立双核/单核与硬件转发管线，微码执行物理层线速转发')),
				row(_('模块状态'), modulesView, _('底层驱动与加速子系统卸载状态：Bridge(桥接)、PPPoE(拨号)、Wi-Fi(无线通道)、SQM(队列整形)、VLAN(虚网)、Qdisc(流量控制)、EIP-197(硬件加解密)')),
				row(_('核心负载'), computeLoadView, _('Linux 主机通用处理器 (usr/sys/sirq) 与 NSS 硬件协处理器独立运算负载')),
				row(_('硬件遥测'), telemetryView, _('当前经由高通增强连接管理器 (ECM) 卸载到硬件层线速转发的活跃流数与芯片温度监测'))
			]);

			return table;
		}
	});
