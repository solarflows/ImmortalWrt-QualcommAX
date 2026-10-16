'use strict';
'require baseclass';
'require rpc';

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
		E('td', { 'class': 'td left', 'width': '33%' }, [ label ]),
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
		var d = data[0] || {};
		if (!d.soc)
			return null;

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

		// 2. 动态多点传感器温度枚举 (CPU + 动态物理 phy* 接口，带标准冒号)
		var tempParts = [];
		if (d.cpu_temp)
			tempParts.push('CPU: ' + d.cpu_temp + '°C');

		var radios = d.radios || [];
		for (var i = 0; i < radios.length; i++) {
			if (radios[i].temp)
				tempParts.push(radios[i].id + ': ' + radios[i].temp + '°C');
		}
		var tempStr = tempParts.length ? tempParts.join(' • ') : _('未检测到有效温度');

		// 3. ECM 加速连接统计
		var ecmStr = (d.ecm_total != null)
			? (d.ecm_total + ' ' + _('条并发流') + ' (IPv4: ' + (d.ecm_v4 || 0) + ' / IPv6: ' + (d.ecm_v6 || 0) + ')')
			: _('ECM 未挂载');

		// 4. Wi-Fi 直通状态
		var wifiStr = (d.wifi_offload === 1)
			? _('ath11k wifili 硬件直通已就绪')
			: _('Host 协议栈模式');

		var table = E('table', { 'class': 'table' }, [
			row(_('协处理器与主频'), freqStr + ' (' + _('心跳') + ': ' + (d.heartbeat || 0) + ' pkts/s)'),
			row(_('NPU 硬件负载'), coreLoadView),
			row(_('硬件与射频温度'), tempStr),
			row(_('ECM 硬件流数'), ecmStr),
			row(_('无线数据通道'), wifiStr)
		]);

		return table;
	}
});
