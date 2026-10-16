'use strict';
'require view';
'require rpc';
'require poll';
'require dom';

var callGetPorts = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getPorts'
});

var callGetStatus = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getStatus'
});

var callDeviceStatus = rpc.declare({
	object: 'network.device',
	method: 'status',
	params: [ 'name' ]
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

function progressbar(value, max) {
	var vn = parseFloat(value) || 0,
	    mn = parseFloat(max) || 100,
	    pc = Math.min(100, Math.max(0, Math.floor((100 / mn) * vn)));

	return E('div', {
		'class': 'cbi-progressbar',
		'style': 'width:80px; height:12px; margin:0;',
		'title': '%s%%'.format(vn)
	}, [
		E('div', {
			'style': 'width:%.2f%%; height:100%; transition:width 0.3s ease;'.format(pc),
			'class': (vn > 80) ? 'cbi-progressbar-danger' : (vn > 50) ? 'cbi-progressbar-warn' : ''
		})
	]);
}

function renderStickyBar(d) {
	if (!d || !d.soc) return E('div');
	var t = parseFloat(d.cpu_temp) || 0;
	var tempClass = (t >= 75) ? 'badge-danger' : (t >= 60) ? 'badge-warning' : 'badge-success';
	var soc = d.soc || 'IPQ8074';
	var cores = d.cores || 2;
	var freqStr = (d.nss_freq || '1478.4 MHz').replace(' MHz', 'M');
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

function renderPorts(d, statusData) {
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
		renderStickyBar(statusData),
		E('h2', {}, [ _('NSS 硬件网络加速 - 端口线速矩阵') ]),
		E('div', { 'class': 'cbi-map-descr' }, [
			_('实时按需监控各物理网络接口硬件卸载率。离开当前页面定时器自动销毁，0 后台消耗。')
		]),
		moduleBox,
		E('div', { 'class': 'cbi-map-descr', 'style': 'font-size:12px; color:var(--text-color-medium);' }, [
			_('说明: “HW Pkts”代表由芯片固件硬件线速转发的数据包；“Host Pkts”代表建链首包握手、广播发现或路由器本机流量；HW % 接近 100% 表明硬件卸载完全生效。')
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callGetPorts(), {}),
			L.resolveDefault(callGetStatus(), {})
		]).then(function(res) {
			return fetchPortStats(res[0] || {}).then(function(portsData) {
				return [ portsData, res[1] || {} ];
			});
		});
	},

	render: function(data) {
		ensureCss();

		var portsData = data[0] || {};
		var statusData = data[1] || {};

		var container = E('div', {}, [
			renderPorts(portsData, statusData)
		]);

		var update = function() {
			return Promise.all([
				callGetPorts(),
				callGetStatus()
			]).then(function(res) {
				return fetchPortStats(res[0] || {}).then(function(portsData) {
					var oldWrap = container.querySelector('#ports-scroll-wrap');
					var prevScrollLeft = oldWrap ? oldWrap.scrollLeft : 0;
					dom.content(container, renderPorts(portsData, res[1] || {}));
					var newWrap = container.querySelector('#ports-scroll-wrap');
					if (newWrap && prevScrollLeft > 0) {
						newWrap.scrollLeft = prevScrollLeft;
					}
				});
			}).catch(function(err) {
				dom.content(container, E('div', { 'class': 'alert-message warning' }, [
					_('无法读取端口数据: '), err.message
				]));
			});
		};

		poll.add(update, 4);

		return container;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
