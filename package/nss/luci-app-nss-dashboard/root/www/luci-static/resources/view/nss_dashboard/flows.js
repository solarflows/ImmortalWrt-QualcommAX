'use strict';
'require view';
'require rpc';
'require poll';
'require dom';

var callGetFlows = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getFlows'
});

var currentSubTab = 'clients'; // 'clients' | 'all' | 'ipv4' | 'ipv6'

function renderFlows(d, onTabSwitch) {
	var hostnames = d.hostnames || {};
	var rawFlows = d.flows || [];

	// 1. 前端实时客户端流聚合 (Client Aggregation)
	var clientMap = {};
	var totalRate = 0;
	var v4Rate = 0;
	var v6Rate = 0;

	rawFlows.forEach(function(f) {
		var srcIp = (f.src || '').split(':')[0];
		var srcPort = (f.src || '').split(':')[1] || '';
		var isV6 = (srcIp.indexOf(':') !== -1);
		var rateVal = parseFloat(f.rate) || 0;

		totalRate += rateVal;
		if (isV6) v6Rate += rateVal; else v4Rate += rateVal;

		if (!clientMap[srcIp]) {
			clientMap[srcIp] = {
				ip: srcIp,
				hostName: hostnames[srcIp] || srcIp,
				totalRate: 0,
				totalPkts: 0,
				flowCount: 0,
				protos: {}
			};
		}
		clientMap[srcIp].totalRate += rateVal;
		clientMap[srcIp].totalPkts += (parseInt(f.pkts) || 0);
		clientMap[srcIp].flowCount++;
		if (f.proto) clientMap[srcIp].protos[f.proto] = true;
	});

	var clientsList = Object.keys(clientMap).map(function(k) { return clientMap[k]; });

	// 2. 二级过滤流明细
	var filteredFlows = rawFlows;
	if (currentSubTab === 'ipv4') {
		filteredFlows = rawFlows.filter(function(f) { return (f.src || '').indexOf('[') === -1 && (f.src || '').split(':')[0].indexOf(':') === -1; });
	} else if (currentSubTab === 'ipv6') {
		filteredFlows = rawFlows.filter(function(f) { return (f.src || '').indexOf('[') !== -1 || (f.src || '').split(':')[0].indexOf(':') !== -1; });
	}

	// 3. 原生 Tab 菜单条 (标准 LuCI cbi-tabmenu 规范，无花哨 Emoji)
	var tabMenuItems = [
		{ id: 'clients', label: _('客户端聚合') },
		{ id: 'all',     label: _('全量明细') },
		{ id: 'ipv4',    label: _('IPv4 流') },
		{ id: 'ipv6',    label: _('IPv6 流') }
	].map(function(tab) {
		var isActive = (currentSubTab === tab.id);
		return E('li', { 'class': 'cbi-tab' + (isActive ? ' active' : '') }, [
			E('a', {
				'style': isActive ? 'font-weight:bold; color:var(--text-main);' : '',
				'click': function(ev) {
					ev.preventDefault();
					currentSubTab = tab.id;
					onTabSwitch();
				}
			}, [ tab.label ])
		]);
	});

	// 4. 表体渲染 (纯正原生工整排版，紧凑缩写表头)
	var tableBody;
	if (currentSubTab === 'clients') {
		var clientRows = clientsList.map(function(c) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ c.hostName ]) ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ c.ip ]) ]),
				E('td', { 'class': 'td' }, [ c.flowCount + ' ' + _('条流') ]),
				E('td', { 'class': 'td' }, [ c.totalRate.toFixed(1) + ' Mbit/s' ]),
				E('td', { 'class': 'td' }, [ c.totalPkts.toLocaleString() + ' pkts' ]),
				E('td', { 'class': 'td' }, [ Object.keys(c.protos).join(', ') || 'TCP' ])
			]);
		});

		if (!clientRows.length) {
			clientRows = [
				E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'colspan': '6', 'style': 'text-align:center; color:#909399;' }, [
						_('当前暂无活跃的客户端硬件加速流')
					])
				])
			];
		}

		tableBody = E('table', { 'class': 'table' }, [
			E('thead', {}, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, [ 'Host' ]),
					E('th', { 'class': 'th' }, [ 'IP' ]),
					E('th', { 'class': 'th' }, [ 'Conns' ]),
					E('th', { 'class': 'th' }, [ 'Rate' ]),
					E('th', { 'class': 'th' }, [ 'Bytes' ]),
					E('th', { 'class': 'th' }, [ 'Proto' ])
				])
			]),
			E('tbody', {}, clientRows)
		]);
	} else {
		var flowRows = filteredFlows.map(function(f) {
			var srcIp = (f.src || '').split(':')[0];
			var srcName = hostnames[srcIp];

			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ f.proto || 'TCP' ]),
				E('td', { 'class': 'td' }, [
					srcName ? E('strong', {}, [ srcName, E('br') ]) : '',
					E('code', { 'style': 'font-size:11px;' }, [ f.src || '-' ])
				]),
				E('td', { 'class': 'td' }, [
					E('code', { 'style': 'font-size:11px;' }, [ f.dst || '-' ])
				]),
				E('td', { 'class': 'td' }, [ (parseFloat(f.rate) || 0).toFixed(1) + ' Mbit/s' ]),
				E('td', { 'class': 'td' }, [ (parseInt(f.pkts) || 0).toLocaleString() + ' pkts' ]),
				E('td', { 'class': 'td' }, [ E('code', {}, [ f.dscp || 'CS0 (0x00)' ]) ])
			]);
		});

		if (!flowRows.length) {
			flowRows = [
				E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td', 'colspan': '6', 'style': 'text-align:center; color:#909399;' }, [
						_('当前分类下暂无活跃硬件加速流')
					])
				])
			];
		}

		tableBody = E('table', { 'class': 'table' }, [
			E('thead', {}, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, [ 'Proto' ]),
					E('th', { 'class': 'th' }, [ 'Src' ]),
					E('th', { 'class': 'th' }, [ 'Dst' ]),
					E('th', { 'class': 'th' }, [ 'Rate' ]),
					E('th', { 'class': 'th' }, [ 'Bytes' ]),
					E('th', { 'class': 'th' }, [ 'DSCP' ])
				])
			]),
			E('tbody', {}, flowRows)
		]);
	}

	return E('div', {}, [
		// 顶部原生工整概况表格
		E('table', { 'class': 'table', 'style': 'margin-bottom:12px;' }, [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'style': 'width:20%; font-weight:bold;' }, [ _('硬件直通总速率') ]),
				E('td', { 'class': 'td left', 'style': 'width:30%;' }, [
					totalRate.toFixed(1) + ' Mbit/s (' + _('v4') + ': ' + v4Rate.toFixed(1) + ' / ' + _('v6') + ': ' + v6Rate.toFixed(1) + ')'
				]),
				E('td', { 'class': 'td left', 'style': 'width:20%; font-weight:bold;' }, [ _('ECM 加速流数') ]),
				E('td', { 'class': 'td left', 'style': 'width:30%;' }, [ rawFlows.length + ' ' + _('条并发流') ])
			])
		]),
		// 原生 Tab 选项卡
		E('ul', { 'class': 'cbi-tabmenu', 'style': 'display:flex; list-style:none; padding:0; margin:0 0 12px 0; border-bottom:1px solid #dcdfe6; gap:4px;' }, tabMenuItems),
		tableBody
	]);
}

return view.extend({
	load: function() {
		return Promise.resolve(null);
	},

	render: function() {
		var lastData = null;
		var container = E('div', {}, [
			E('p', { 'class': 'spinning' }, [ _('正在读取 NSS 硬件流表…') ])
		]);

		var refreshView = function() {
			if (lastData)
				dom.content(container, renderFlows(lastData, refreshView));
		};

		var update = function() {
			return callGetFlows().then(function(d) {
				lastData = d;
				refreshView();
			}).catch(function(err) {
				dom.content(container, E('div', { 'class': 'alert-message warning' }, [
					_('无法读取流表数据: '), err.message
				]));
			});
		};

		update();
		poll.add(update, 3);

		return E('div', {}, [
			E('h2', {}, [ _('NSS 硬件网络加速 - 硬件流表') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('复用单一数据采集通道，由前端实时按客户端归并并发连接。源端自动关联局域网主机名，目的端展示精准物理端口。离开页面轮询即停。')
			]),
			container
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
