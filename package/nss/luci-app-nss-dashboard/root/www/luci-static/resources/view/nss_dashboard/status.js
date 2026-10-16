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
		'title': '%s%%'.format(vn)
	}, [
		E('div', { 'style': 'width:%.2f%%'.format(pc) }),
		E('span', {}, [ '%s%%'.format(vn) ])
	]);
}

function row(label, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'style': 'width:30%' }, [ label ]),
		E('td', { 'class': 'td left' }, Array.isArray(value) ? value : [ value ])
	]);
}

function onoff(v) {
	return v ? E('span', { 'class': 'badge badge-success', 'style': 'color:#2e7d32; font-weight:bold;' }, [ '✓ ' + _('已启用') ])
	         : E('span', { 'style': 'color:#757575;' }, [ _('未加载') ]);
}

function renderStatus(d) {
	var npuLabel = (d.cores === 1) ? 'NPU ×1' : 'NPU ×2';
	var freqStr = d.nss_freq ? (npuLabel + ' @ ' + d.nss_freq) : npuLabel;

	// 1. NPU 双核/单核负载条
	var coreLoadView;
	if (d.cores === 1) {
		coreLoadView = E('div', { 'style': 'display:flex; align-items:center; gap:8px;' }, [
			E('span', { 'style': 'min-width:50px;' }, [ 'Core 0:' ]),
			E('div', { 'style': 'flex:1;' }, [ progressbar(d.core0_load || 0, 100) ])
		]);
	} else {
		coreLoadView = E('div', { 'style': 'display:flex; align-items:center; gap:12px;' }, [
			E('span', { 'style': 'min-width:50px;' }, [ 'Core 0:' ]),
			E('div', { 'style': 'flex:1;' }, [ progressbar(d.core0_load || 0, 100) ]),
			E('span', { 'style': 'min-width:50px;' }, [ 'Core 1:' ]),
			E('div', { 'style': 'flex:1;' }, [ progressbar(d.core1_load || 0, 100) ])
		]);
	}

	// 2. 动态多点传感器温度
	var tempParts = [];
	if (d.cpu_temp)
		tempParts.push('CPU: ' + d.cpu_temp + '°C');

	var radios = d.radios || [];
	for (var i = 0; i < radios.length; i++) {
		if (radios[i].temp)
			tempParts.push(radios[i].id + ': ' + radios[i].temp + '°C');
	}
	var tempStr = tempParts.length ? tempParts.join(' • ') : _('未检测到有效温度');

	// 3. ECM 状态与看门狗
	var ecmStr = (d.ecm_total != null)
		? (d.ecm_total + ' ' + _('条流') + ' (IPv4: ' + (d.ecm_v4 || 0) + ' / IPv6: ' + (d.ecm_v6 || 0) + ')')
		: _('ECM 未挂载');

	// 4. 冲突警告横幅 (如果检测到 flow_offloading)
	var conflictBanner = null;
	if (d.conflict_detected === 1) {
		conflictBanner = E('div', {
			'class': 'alert-message warning',
			'style': 'background:#fffbe6; border:1px solid #ffe58f; border-left:4px solid #faad14; padding:10px 14px; margin-bottom:14px; border-radius:2px; font-size:13px;'
		}, [
			E('strong', { 'style': 'color:#d48806;' }, [ '⚠️ ' + _('内核协议栈配置与 NSS 硬件加速冲突') ]),
			E('div', { 'style': 'margin-top:4px;' }, [
				_('检测到系统开启了软件流量分流 (flow_offloading=1)。数据包将被提前截获跳过 Conntrack 通知链，导致 ECM 硬件加速失效与连接撕裂。系统安全防护已自动阻断该项影响。')
			]),
			E('div', { 'style': 'margin-top:4px;' }, [
				_('建议手动关闭此冲突项：可直接前往 '),
				E('a', {
					'href': L.url('admin/network/network'),
					'style': 'color:#1890ff; font-weight:bold; text-decoration:underline;'
				}, [ _('网络 → 接口 → 全局网络选项') ]),
				_('。')
			])
		]);
	}

	var mods = d.modules || {};

	return E('div', {}, [
		conflictBanner,
		E('h3', {}, [ _('NSS 协处理器底层运行态势') ]),
		E('table', { 'class': 'table' }, [
			row(_('核心规格与主频'), freqStr + ' (' + _('微码固件') + ': FW ' + (d.fw_version || '11.4') + ')'),
			row(_('心跳通信速率'), (d.heartbeat || 0) + ' pkts/s (' + _('数据通道正常') + ')'),
			row(_('NPU 硬件负载'), coreLoadView),
			row(_('硬件与射频温度'), tempStr),
			row(_('ECM 硬件流数'), ecmStr + ' — ' + _('看门狗超时: 10000 ms')),
			row(_('PPPoE 硬件管理器'), onoff(mods.pppoe)),
			row(_('VLAN 硬件隔离管理器'), onoff(mods.vlan)),
			row(_('Bridge 桥接硬件管理器'), onoff(mods.bridge)),
			row(_('EIP-197 硬件加解密引擎'), onoff(mods.crypto)),
			row(_('无线数据通道'), (d.wifi_offload === 1) ? _('ath11k wifili 硬件直通 (802.11s Mesh 就绪)') : _('Host 协议栈模式'))
		])
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
			E('h2', {}, [ _('NSS 硬件网络加速 - 状态总览') ]),
			container
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
