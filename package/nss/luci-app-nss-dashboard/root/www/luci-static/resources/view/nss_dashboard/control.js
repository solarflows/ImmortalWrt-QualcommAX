'use strict';
'require view';
'require rpc';
'require ui';

var callGetSettings = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'getSettings'
});

var callSetSettings = rpc.declare({
	object: 'luci.nss_dashboard',
	method: 'setSettings',
	params: [ 'enabled', 'crypto', 'frequency', 'auto_block' ]
});

var callGetStatus = rpc.declare({
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

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callGetSettings(), {}),
			L.resolveDefault(callGetStatus(), {})
		]);
	},

	render: function(data) {
		ensureCss();

		var s = data[0] || {};
		var d = data[1] || {};

		var isDualNpu = (d.cores !== 1);
		var npuLabel = isDualNpu ? 'NPU ×2' : 'NPU ×1';

		var cbEnabled = E('input', {
			'type': 'checkbox',
			'class': 'cbi-checkbox',
			'style': 'width:18px; height:18px; cursor:pointer;',
			'checked': (s.enabled === 1) ? '' : null
		});

		var cbCrypto = E('input', {
			'type': 'checkbox',
			'class': 'cbi-checkbox',
			'style': 'width:18px; height:18px; cursor:pointer;',
			'checked': (s.crypto === 1) ? '' : null
		});

		var selectFreq = E('select', {
			'class': 'cbi-input-select',
			'style': 'padding:4px 8px; font-size:13px;'
		}, [
			E('option', { 'value': '748.8 MHz', 'selected': (s.frequency && s.frequency.indexOf('748') !== -1) ? '' : null }, [ _('稳健节能 (748.8 MHz)') ]),
			E('option', { 'value': '1056.0 MHz', 'selected': (s.frequency && s.frequency.indexOf('1056') !== -1) ? '' : null }, [ _('IPQ60xx 默认 (1056.0 MHz)') ]),
			E('option', { 'value': '1478.4 MHz', 'selected': (!s.frequency || s.frequency.indexOf('1478') !== -1) ? '' : null }, [ _('IPQ807x 标准 (1478.4 MHz - 推荐)') ]),
			E('option', { 'value': '1689.6 MHz', 'selected': (s.frequency && s.frequency.indexOf('1689') !== -1) ? '' : null }, [ _('极速超频 (1689.6 MHz - 满血)') ])
		]);

		var cbAutoBlock = E('input', {
			'type': 'checkbox',
			'class': 'cbi-checkbox',
			'style': 'width:18px; height:18px; cursor:pointer;',
			'checked': (s.auto_block !== 0) ? '' : null
		});

		var table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'style': 'width:35%' }, [
					E('label', {}, [ E('strong', {}, [ _('NSS 硬件网络加速总开关') ]) ]),
					E('div', { 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:2px;' }, [
						_('开启后由 NSS 协处理器接管有线与无线网络流量线速转发')
					])
				]),
				E('td', { 'class': 'td left' }, [
					E('label', { 'style': 'display:inline-flex; align-items:center; gap:8px; cursor:pointer;' }, [
						cbEnabled,
						E('span', { 'style': 'font-weight:600; color:var(--success-color-high);' }, [ _('启用 (即时生效)') ])
					])
				])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left' }, [
					E('label', {}, [ E('strong', {}, [ _('NSS EIP-197 硬件加解密引擎 (Crypto Offload)') ]) ]),
					E('div', { 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:2px;' }, [
						_('启用高通独立安全协处理器，卸载 IPsec 与网络大包加解密 (关闭时使用 CPU ARMv8 CE 纳秒级指令)')
					])
				]),
				E('td', { 'class': 'td left' }, [
					E('div', { 'style': 'display:flex; align-items:center; gap:8px; flex-wrap:wrap;' }, [
						E('label', { 'style': 'display:inline-flex; align-items:center; gap:8px; cursor:pointer;' }, [
							cbCrypto,
							E('span', { 'style': 'font-weight:600;' }, [ _('启用 EIP-197 加速') ])
						]),
						E('span', { 'class': 'badge badge-warning' }, [ '⚠️ ' + _('修改后需重启生效') ])
					])
				])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left' }, [
					E('label', {}, [ E('strong', {}, [ _('NSS 核心主频调节') ]) ]),
					E('div', { 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:2px;' }, [
						_('调节 NSS 锁相环时钟频率 (当前识别目标: ') + npuLabel + ')'
					])
				]),
				E('td', { 'class': 'td left' }, [ selectFreq ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left' }, [
					E('label', {}, [ E('strong', {}, [ _('内核冲突配置自动阻断墙 (Auto-Block Protection)') ]) ]),
					E('div', { 'style': 'font-size:12px; color:var(--text-color-medium); margin-top:2px;' }, [
						_('主动拦截外部 flow_offloading 与 packet_steering，防止硬件流表撕裂丢包')
					])
				]),
				E('td', { 'class': 'td left' }, [
					E('label', { 'style': 'display:inline-flex; align-items:center; gap:8px; cursor:pointer;' }, [
						cbAutoBlock,
						E('span', { 'style': 'font-weight:600; color:var(--success-color-high);' }, [ _('启用主动阻断防御') ])
					])
				])
			])
		]);

		this.cbEnabled = cbEnabled;
		this.cbCrypto = cbCrypto;
		this.selectFreq = selectFreq;
		this.cbAutoBlock = cbAutoBlock;

		return E('div', {}, [
			E('h2', {}, [ _('NSS 硬件网络加速 - 控制与防御') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('遵循状态自发现机制，首次加载优先读取硬件真实物理运行态；仅在保存并应用时受控下发配置。')
			]),
			table
		]);
	},

	handleSaveApply: function() {
		var enabled = this.cbEnabled.checked ? 1 : 0;
		var crypto = this.cbCrypto.checked ? 1 : 0;
		var freq = this.selectFreq.value;
		var auto_block = this.cbAutoBlock.checked ? 1 : 0;

		ui.showModal(_('正在保存 NSS 配置…'), [
			E('p', { 'class': 'spinning' }, [ _('正在写入配置并执行状态对齐…') ])
		]);

		return callSetSettings(enabled, crypto, freq, auto_block).then(function() {
			ui.addNotification(null, E('p', {}, [ _('NSS 硬件控制配置已成功保存并应用。') ]), 'info');
			ui.hideModal();
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, [ _('保存配置失败: ') + err.message ]), 'danger');
			ui.hideModal();
		});
	},

	handleSave: null,
	handleReset: null
});
