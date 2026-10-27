'use strict';
'require baseclass';
'require rpc';
'require view.nss_dashboard.lib.util as util';
'require view.nss_dashboard.lib.chips as chips';

var callNssStatus = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getStatus'
});

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

return baseclass.extend({
	title: _('NSS 硬件网络加速'),

	load: function() {
		return Promise.all([
			L.resolveDefault(callNssStatus(), {})
		]);
	},

	render: function(data) {
		util.ensureCss();

		var d = data[0] || {};
		if (!d.soc)
			return null;

		var spec = chips.buildSpec(d, d);
		var freqStr = spec.freq ? (spec.npuLabel + ' @ ' + spec.freq) : spec.npuLabel;
		var fwDisplay = spec.fwDisplay;
		var heartbeatStr = spec.heartbeat.toLocaleString() + ' pkts/s';

		// 1. 协处理器规格与微码心跳
		var specView = E('div', { 'style': 'display:flex; flex-direction:column; gap:2px;' }, [
			E('div', { 'style': 'font-weight:600; font-size:12px; color:var(--text-color-high);' }, [
				spec.soc + ' • ' + freqStr
			]),
			E('div', {
				'style': 'font-size:11px; color:var(--text-color-medium); line-height:1.4;',
				'title': spec.rawFw + (spec.fwMask ? ' (fw_mask: ' + spec.fwMask + ')' : '')
			}, [
				fwDisplay + ' • ' + _('心跳') + ': ' + heartbeatStr
			])
		]);

		// 2. 模块状态
		var mods = d.modules || {};
		var chipOpts = { style: 'white-space:nowrap !important;' };
		var wifiChip = (d.wifi_offload === 1)
			? chips.moduleChip('Wi-Fi', 2, _('已加速'), _('ath11k wifili 硬件加速已就绪 (802.11s Mesh 支持)'), chipOpts)
			: chips.moduleChip('Wi-Fi', 0, _('主机模式'), _('无线数据流未经 NSS 卸载'), chipOpts);

		var sqmChip;
		if (d.sqm === 2) {
			sqmChip = chips.moduleChip('SQM', 2, _('硬件队列'), _('NSS 硬件队列加速运行中 (CAKE/FQ-CoDel 硬件调度)'), chipOpts);
		} else if (d.sqm === 1) {
			sqmChip = chips.moduleChip('SQM', 1, _('主机队列'), _('主机软件队列整形运行中'), chipOpts);
		} else if (d.sqm === 0) {
			sqmChip = chips.moduleChip('SQM', 0, _('未启用'), _('未启用 (已配置备用)'), chipOpts);
		} else {
			sqmChip = chips.moduleChip('SQM', 0, _('未安装'), _('未安装 sqm-scripts'), chipOpts);
		}

		var modulesView = E('div', { 'style': 'display:flex; flex-wrap:wrap; gap:8px 6px; max-width:340px;' }, [
			chips.moduleChip('Bridge', mods.bridge, null, null, chipOpts),
			chips.moduleChip('PPPoE', mods.pppoe, null, null, chipOpts),
			wifiChip,
			sqmChip,
			chips.moduleChip('VLAN', mods.vlan, null, null, chipOpts),
			chips.moduleChip('Qdisc', mods.qdisc, null, null, chipOpts),
			chips.moduleChip('EIP-197', mods.crypto, null, null, chipOpts)
		]);

		// 3. 核心计算负载
		var computeLoadElements = [];
		if (Array.isArray(d.cpu_ticks) && d.cpu_ticks.length >= 7) {
			var cpu = chips.calcCpuLoad(d.cpu_ticks);
			computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
				E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'CPU:' ]),
				E('div', { 'style': 'flex:1;' }, [
					chips.stack({ total: cpu.total, usr: cpu.usr, sys: cpu.sys, sirq: cpu.sirq, height: 14 })
				]),
				E('span', { 'style': 'font-size:11px; font-weight:600; min-width:28px; text-align:right;' }, [ cpu.total.toFixed(0) + '%' ])
			]));
		}

		if (!spec.isDualNpu) {
			computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
				E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 0:' ]),
				E('div', { 'style': 'flex:1;' }, [ chips.bar({ value: d.core0_load || 0, max: 100, height: 14 }) ]),
				E('span', { 'style': 'font-size:11px; font-weight:600; min-width:28px; text-align:right;' }, [ (d.core0_load || 0) + '%' ])
			]));
		} else {
			var isCore1Active = (d.core1_load !== null && d.core1_load !== undefined);
			computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
				E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 0:' ]),
				E('div', { 'style': 'flex:1;' }, [ chips.bar({ value: d.core0_load || 0, max: 100, height: 14 }) ]),
				E('span', { 'style': 'font-size:11px; font-weight:600; min-width:28px; text-align:right;' }, [ (d.core0_load || 0) + '%' ])
			]));
			computeLoadElements.push(E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
				E('span', { 'style': 'min-width:45px; font-size:11px;' }, [ 'Core 1:' ]),
				E('div', { 'style': 'flex:1;' }, [
					isCore1Active ? chips.bar({ value: d.core1_load, max: 100, height: 14 }) : chips.bar({ value: null, disabledText: _('休眠待机'), height: 14 })
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

		// 4. 硬件遥测
		var ecmTotalChip = E('span', {
			'class': 'badge badge-info',
			'title': _('当前经由高通增强连接管理器 (ECM) 卸载的硬件并发流总数'),
			'style': 'white-space:nowrap !important;'
		}, [
			E('span', { 'class': 'badge-dot' }),
			E('strong', {}, [ 'ECM:' ]),
			' ' + spec.conns.toLocaleString() + ' ' + _('流')
		]);

		var ecmDistChip = E('span', {
			'class': 'badge badge-neutral',
			'title': 'IPv4: ' + (d.ecm_v4 || 0) + ' • IPv6: ' + (d.ecm_v6 || 0),
			'style': 'white-space:nowrap !important;'
		}, [
			E('strong', {}, [ 'v4/v6:' ]),
			' ' + (d.ecm_v4 || 0) + '/' + (d.ecm_v6 || 0)
		]);

		var tempElements = [];
		if (d.cpu_temp && parseFloat(d.cpu_temp) > 0)
			tempElements.push(chips.tempBadge('CPU', d.cpu_temp, chipOpts));

		var radios = d.radios || [];
		for (var i = 0; i < radios.length; i++) {
			if (radios[i].temp && parseFloat(radios[i].temp) > 0)
				tempElements.push(chips.tempBadge(radios[i].id, radios[i].temp, chipOpts));
		}

		var telemetryView = E('div', {
			'style': 'display:flex; flex-wrap:wrap; gap:8px 6px; max-width:340px;'
		}, [ ecmTotalChip, ecmDistChip ].concat(tempElements));

		return E('table', { 'id': 'nss-status-table', 'class': 'table' }, [
			row(_('协处理器'), specView, _('高通网络子系统 (NSS) 硬件卸载协处理器，内置独立双核/单核与硬件转发管线，微码执行物理层线速转发')),
			row(_('模块状态'), modulesView, _('底层驱动与加速子系统卸载状态：Bridge(桥接)、PPPoE(拨号)、Wi-Fi(无线通道)、SQM(队列整形)、VLAN(虚网)、Qdisc(流量控制)、EIP-197(硬件加解密)')),
			row(_('核心负载'), computeLoadView, _('Linux 主机通用处理器 (usr/sys/sirq) 与 NSS 硬件协处理器独立运算负载')),
			row(_('硬件遥测'), telemetryView, _('当前经由高通增强连接管理器 (ECM) 卸载到硬件层线速转发的活跃流数与芯片温度监测'))
		]);
	}
});
