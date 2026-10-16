'use strict';
'require view';
'require rpc';
'require poll';
'require dom';

var callGetPorts = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getPorts'
});

function progressbar(value, max) {
	var vn = parseFloat(value) || 0,
	    mn = parseFloat(max) || 100,
	    pc = Math.min(100, Math.max(0, Math.floor((100 / mn) * vn)));

	return E('div', {
		'class': 'cbi-progressbar',
		'style': 'width:80px; height:12px;',
		'title': '%s%%'.format(vn)
	}, [
		E('div', { 'style': 'width:%.2f%%'.format(pc) })
	]);
}

function renderPorts(d) {
	var ports = d.ports || [];

	var rows = ports.map(function(p) {
		var hwRatio = parseFloat(p.tx_offload_pct || p.rx_offload_pct || 0);
		var offloaded = (parseInt(p.tx_offloaded || 0) + parseInt(p.rx_offloaded || 0));
		var hostPkts = (parseInt(p.tx_host_pkts || 0) + parseInt(p.rx_host_pkts || 0));

		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'data-title': 'Port' }, [ E('strong', {}, [ p.netdev || ('eth' + p.ifnum) ]) ]),
			E('td', { 'class': 'td', 'data-title': 'Speed' }, [ p.speed || (p.started ? _('已连接') : _('未连接')) ]),
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
				E('td', { 'class': 'td', 'colspan': '6', 'style': 'text-align:center; color:#909399;' }, [
					_('当前暂未探测到已挂载的 NSS 物理以太网接口 (Host Stack Mode)')
				])
			])
		];
	}

	return E('div', {}, [
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
		]),
		E('div', { 'class': 'cbi-map-descr', 'style': 'margin-top:12px; font-size:12px; color:#606266;' }, [
			_('说明: “HW Pkts”代表由芯片固件硬件线速转发的数据包；“Host Pkts”代表建链首包握手、广播发现或路由器本机流量；HW % 接近 100% 表明硬件卸载完全生效。')
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.resolve(null);
	},

	render: function() {
		var container = E('div', {}, [
			E('p', { 'class': 'spinning' }, [ _('正在读取物理网口线速卸载数据…') ])
		]);

		var update = function() {
			return callGetPorts().then(function(d) {
				var oldWrap = container.querySelector('#ports-scroll-wrap');
				var prevScrollLeft = oldWrap ? oldWrap.scrollLeft : 0;
				dom.content(container, renderPorts(d));
				var newWrap = container.querySelector('#ports-scroll-wrap');
				if (newWrap && prevScrollLeft > 0) {
					newWrap.scrollLeft = prevScrollLeft;
				}
			}).catch(function(err) {
				dom.content(container, E('div', { 'class': 'alert-message warning' }, [
					_('无法读取端口数据: '), err.message
				]));
			});
		};

		update();
		poll.add(update, 4);

		return E('div', {}, [
			E('h2', {}, [ _('NSS 硬件网络加速 - 端口线速矩阵') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('实时按需监控各物理网络接口硬件卸载率。离开当前页面定时器自动销毁，0 后台消耗。')
			]),
			container
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
