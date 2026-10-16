'use strict';
'require view';
'require rpc';
'require poll';
'require dom';

var callGetFlows = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getFlows'
});

var callGetStatus = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getStatus'
});

var currentSubTab = 'clients'; // 'clients' | 'all' | 'ipv4' | 'ipv6'

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

function renderFlows(d, statusData, onTabSwitch) {
	var hostnames = d.hostnames || {};
	var isInstalled = (d.installed !== 0);
	var rawFlows = d.flows || [];

	var clientMap = {};
	var totalPkts = 0;
	var totalBytes = 0;

	// Normalize flow tuples
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

	// Filter
	var filteredFlows = normalizedFlows;
	if (currentSubTab === 'ipv4') {
		filteredFlows = normalizedFlows.filter(function(f) { return f.family === 'ipv4' || f.src.indexOf('.') !== -1; });
	} else if (currentSubTab === 'ipv6') {
		filteredFlows = normalizedFlows.filter(function(f) { return f.family === 'ipv6' || f.src.indexOf('.') === -1; });
	}

	var tabMenuItems = [
		{ id: 'clients', label: _('客户端聚合') },
		{ id: 'all',     label: _('全量明细') },
		{ id: 'ipv4',    label: _('IPv4 流') },
		{ id: 'ipv6',    label: _('IPv6 流') }
	].map(function(tab) {
		var isActive = (currentSubTab === tab.id);
		return E('li', { 'class': 'cbi-tab' + (isActive ? ' active' : '') }, [
			E('a', {
				'style': isActive ? 'font-weight:bold; color:var(--text-color-high);' : '',
				'click': function(ev) {
					ev.preventDefault();
					currentSubTab = tab.id;
					onTabSwitch();
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
	} else if (currentSubTab === 'clients') {
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

	return E('div', {}, [
		renderStickyBar(statusData),
		E('h2', {}, [ _('NSS 硬件网络加速 - 硬件流表') ]),
		E('div', { 'class': 'cbi-map-descr' }, [
			_('复用单一数据采集通道，由前端实时按客户端归并并发连接。源端自动关联局域网主机名，目的端展示精准物理端口。离开页面轮询即停。')
		]),
		moduleBox
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callGetFlows(), {}),
			L.resolveDefault(callGetStatus(), {})
		]);
	},

	render: function(data) {
		ensureCss();

		var lastFlowsData = data[0] || {};
		var lastStatusData = data[1] || {};

		var container = E('div', {}, [
			renderFlows(lastFlowsData, lastStatusData, function() {
				refreshView();
			})
		]);

		var refreshView = function() {
			var oldWrap = container.querySelector('#flows-scroll-wrap');
			var prevScrollLeft = oldWrap ? oldWrap.scrollLeft : 0;
			dom.content(container, renderFlows(lastFlowsData, lastStatusData, refreshView));
			var newWrap = container.querySelector('#flows-scroll-wrap');
			if (newWrap && prevScrollLeft > 0) {
				newWrap.scrollLeft = prevScrollLeft;
			}
		};

		var update = function() {
			return Promise.all([
				callGetFlows(),
				callGetStatus()
			]).then(function(res) {
				lastFlowsData = res[0] || {};
				lastStatusData = res[1] || {};
				refreshView();
			}).catch(function(err) {
				dom.content(container, E('div', { 'class': 'alert-message warning' }, [
					_('无法读取流表数据: '), err.message
				]));
			});
		};

		poll.add(update, 3);

		return container;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
