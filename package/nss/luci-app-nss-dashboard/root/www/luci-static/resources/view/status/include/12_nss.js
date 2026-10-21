'use strict';
'require baseclass';
'require rpc';

var callNssStatus = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getStatus'
});

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
		el.href = L.resource('view/nss_dashboard/nss.css') + '?v=261017m';
	}
}

function progressbar(value, max, label) {
	if (value === null || value === undefined) {
		return E('div', {
			'class': 'cbi-progressbar disabled',
			'style': 'height:13px; min-width:80px; position:relative; overflow:hidden; margin:0;',
			'title': label || _('待机 (无服务固件或未引导)')
		}, [
			E('span', { 'style': 'position:absolute; width:100%; text-align:center; font-size:10px; font-weight:500; line-height:13px; color:var(--text-color-medium);' }, [
				label || _('休眠待机')
			])
		]);
	}
	var vn = parseFloat(value) || 0,
	    mn = parseFloat(max) || 100,
	    pc = Math.min(100, Math.max(0, Math.floor((100 / mn) * vn)));

	return E('div', {
		'class': 'cbi-progressbar',
		'style': 'height:13px; min-width:80px; position:relative; overflow:hidden; margin:0;',
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

function row(label, value, hint) {
	var labelEl = hint ? E('span', {
		'title': hint,
		'style': 'cursor:help; border-bottom:1px dotted var(--text-color-medium, rgba(255,255,255,0.3));'
	}, [ label ]) : label;

	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'style': 'width:33%; font-weight:600;' }, [ labelEl ]),
		E('td', { 'class': 'td left' }, Array.isArray(value) ? value : [ value ])
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

function tempBadge(label, temp) {
	var t = parseFloat(temp) || 0;
	var cls = (t >= 75) ? 'badge-danger' : (t >= 60) ? 'badge-warning' : 'badge-success';

	return E('span', {
		'class': 'badge ' + cls,
		'style': 'margin:1px 4px 1px 0;'
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

		// 1. NPU 双核/单核负载条
		var coreLoadView;
		if (d.cores === 1) {
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

		// 2. 动态多点传感器温度枚举 (Badge 徽章化)
		var tempElements = [];
		if (d.cpu_temp && parseFloat(d.cpu_temp) > 0)
			tempElements.push(tempBadge('CPU', d.cpu_temp));

		var radios = d.radios || [];
		for (var i = 0; i < radios.length; i++) {
			if (radios[i].temp && parseFloat(radios[i].temp) > 0)
				tempElements.push(tempBadge(radios[i].id, radios[i].temp));
		}
		var tempView = tempElements.length
			? E('div', { 'style': 'display:flex; flex-wrap:wrap; align-items:center;' }, tempElements)
			: _('未检测到有效温度');

		// 3. ECM 加速连接统计
		var totalConns = (d.ecm_total != null) ? d.ecm_total : 0;
		var ecmView = [
			E('strong', {}, [ totalConns.toLocaleString() + ' ' + _('条并发流') ]),
			E('span', { 'style': 'margin-left:8px; color:var(--text-color-medium); font-size:12px;' }, [
				'(IPv4: ' + (d.ecm_v4 || 0) + ' • IPv6: ' + (d.ecm_v6 || 0) + ')'
			])
		];

		// 4. Wi-Fi 硬件加速状态
		var wifiView;
		if (d.wifi_offload === 1) {
			wifiView = E('span', {
				'class': 'badge badge-success'
			}, [
				E('span', { 'class': 'badge-dot' }),
				_('ath11k wifili 硬件加速已就绪 (802.11s Mesh 支持)')
			]);
		} else {
			wifiView = E('span', {
				'class': 'badge badge-neutral'
			}, [
				_('Host 协议栈模式')
			]);
		}

		// 5. 协处理器规格与心跳
		var rawFw = d.fw_version || '12.5';
		var fwMask = d.fw_mask || '';
		var fwStr = 'FW ' + rawFw.replace(/^NSS\.(FW\.)?/, '') + (fwMask && fwMask !== '0x0' ? ' [' + fwMask + ']' : '');

		var specView = [
			E('strong', {}, [ (d.soc || 'IPQ8074') + ' • ' + freqStr ]),
			E('span', {
				'style': 'margin-left:8px; color:var(--text-color-medium); font-size:12px;',
				'title': rawFw + (fwMask ? ' (fw_mask: ' + fwMask + ')' : '')
			}, [
				'(' + _('心跳') + ': ' + (d.heartbeat || 0) + ' pkts/s • ' + fwStr + ')'
			])
		];

		// 6. 驱动加速组件与 SQM 流量整形
		var mods = d.modules || {};
		var modsView = E('div', { 'style': 'display:flex; gap:6px; flex-wrap:wrap; align-items:center;' }, [
			moduleChip('Bridge', mods.bridge),
			moduleChip('PPPoE', mods.pppoe),
			moduleChip('VLAN', mods.vlan),
			moduleChip('Qdisc', mods.qdisc),
			moduleChip('EIP-197', mods.crypto)
		]);

		var sqmView;
		if (d.sqm === 2) {
			sqmView = E('span', { 'class': 'badge badge-success' }, [ E('span', { 'class': 'badge-dot' }), _('NSS 硬件队列加速') ]);
		} else if (d.sqm === 1) {
			sqmView = E('span', { 'class': 'badge badge-info' }, [ _('主机软件队列整形运行中') ]);
		} else if (d.sqm === 0) {
			sqmView = E('span', { 'class': 'badge badge-neutral' }, [ _('未启用 (已配置备用)') ]);
		} else {
			sqmView = E('span', { 'class': 'badge badge-neutral' }, [ _('未安装 sqm-scripts') ]);
		}

		var table = E('table', { 'class': 'table' }, [
			row(_('协处理器与微码'), specView, _('高通网络子系统 (NSS) 硬件卸载协处理器，内置独立双核与硬件转发管线，微码执行物理层线速转发')),
			row(_('NPU 硬件负载'), coreLoadView, _('NSS 协处理器双核心的独立硬件负载，负责流量分类与生命周期管理，独立于宿主 Linux CPU')),
			row(_('驱动加速组件'), modsView, _('底层协议驱动的硬件卸载挂载状态：Bridge(桥接)、PPPoE(拨号)、VLAN(虚网)、Qdisc(队列)、EIP-197(硬件矢量加解密)')),
			row(_('SQM 流量整形'), sqmView, _('绿标为 NSS 硬件队列加速运行中，CAKE/FQ-CoDel 算法由 NPU 硬件调度，跑满带宽下依然保持极低延迟与零丢包')),
			row(_('硬件与射频温度'), tempView, _('路由器 CPU 物理结温与各 Wi-Fi 射频芯片温度监测')),
			row(_('ECM 硬件流数'), ecmView, _('当前经由高通增强连接管理器 (ECM) 卸载到硬件层线速转发的活跃 TCP/UDP 流总数与 v4/v6 分布')),
			row(_('无线数据通道'), wifiView, _('ath11k wifili 直连通道直接打通 Wi-Fi 芯片与 NSS 协处理器，无线数据帧线速转发无需经过 Host 主机内存与内核网络层中转'))
		]);

		return table;
	}
});
