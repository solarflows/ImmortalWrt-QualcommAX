'use strict';
'require baseclass';
'require rpc';

var callNssStatus = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getStatus'
});

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
		'style': 'height:13px; min-width:120px; position:relative; overflow:hidden; margin:0;',
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

function row(label, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'style': 'width:33%; font-weight:600;' }, [ label ]),
		E('td', { 'class': 'td left' }, Array.isArray(value) ? value : [ value ])
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
		var specView = [
			E('strong', {}, [ (d.soc || 'IPQ8074') + ' • ' + freqStr ]),
			E('span', { 'style': 'margin-left:8px; color:var(--text-color-medium); font-size:12px;' }, [
				'(' + _('心跳') + ': ' + (d.heartbeat || 0) + ' pkts/s • FW ' + (d.fw_version || '11.4') + ')'
			])
		];

		var table = E('table', { 'class': 'table' }, [
			row(_('协处理器与微码'), specView),
			row(_('NPU 硬件负载'), coreLoadView),
			row(_('硬件与射频温度'), tempView),
			row(_('ECM 硬件流数'), ecmView),
			row(_('无线数据通道'), wifiView)
		]);

		return table;
	}
});
