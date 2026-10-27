'use strict';
'require baseclass';

return baseclass.extend({
	prevCpuTicks: null,
	lastCpuTicksKey: '',
	cachedCpuLoad: { total: 0, usr: 0, sys: 0, sirq: 0 },

	calcCpuLoad: function(cpuTicks) {
		if (!Array.isArray(cpuTicks) || cpuTicks.length < 7) {
			return this.cachedCpuLoad;
		}
		var key = cpuTicks.join(',');
		if (key === this.lastCpuTicksKey) {
			return this.cachedCpuLoad;
		}
		this.lastCpuTicksKey = key;

		var totalLoad = 0, usrRate = 0, sysRate = 0, sirqRate = 0;
		if (this.prevCpuTicks && this.prevCpuTicks.length >= 7) {
			var u1 = this.prevCpuTicks[0], n1 = this.prevCpuTicks[1], s1 = this.prevCpuTicks[2],
			    i1 = this.prevCpuTicks[3], w1 = this.prevCpuTicks[4], q1 = this.prevCpuTicks[5], sq1 = this.prevCpuTicks[6];
			var u2 = cpuTicks[0], n2 = cpuTicks[1], s2 = cpuTicks[2],
			    i2 = cpuTicks[3], w2 = cpuTicks[4], q2 = cpuTicks[5], sq2 = cpuTicks[6];

			var usrDiff  = (u2 + n2) - (u1 + n1);
			var sysDiff  = (s2) - (s1);
			var sirqDiff = (q2 + sq2) - (q1 + sq1);
			var idleDiff = (i2 + w2) - (i1 + w1);

			var activeDiff = usrDiff + sysDiff + sirqDiff;
			var totalDiff  = activeDiff + idleDiff;

			if (totalDiff > 0) {
				totalLoad = Math.min(100, Math.max(0, (activeDiff / totalDiff) * 100));
				usrRate   = Math.min(100, Math.max(0, (usrDiff / totalDiff) * 100));
				sysRate   = Math.min(100, Math.max(0, (sysDiff / totalDiff) * 100));
				sirqRate  = Math.min(100, Math.max(0, (sirqDiff / totalDiff) * 100));
			}
		}
		this.prevCpuTicks = cpuTicks.slice();
		this.cachedCpuLoad = { total: totalLoad, usr: usrRate, sys: sysRate, sirq: sirqRate };
		return this.cachedCpuLoad;
	},

	prevMetricsNssBytes: 0,
	prevMetricsNssTime: 0,
	nssMetricsRateBps: 0,

	sampleMetricsRate: function(curBytes) {
		var now = Date.now();
		curBytes = parseFloat(curBytes) || 0;
		if (this.prevMetricsNssTime > 0 && curBytes >= this.prevMetricsNssBytes) {
			var dt = (now - this.prevMetricsNssTime) / 1000;
			if (dt > 0.5) {
				var diff = curBytes - this.prevMetricsNssBytes;
				this.nssMetricsRateBps = Math.max(0, (diff * 8) / dt);
				this.prevMetricsNssBytes = curBytes;
				this.prevMetricsNssTime = now;
			}
		} else {
			this.prevMetricsNssBytes = curBytes;
			this.prevMetricsNssTime = now;
		}
		return this.nssMetricsRateBps;
	},

	badge: function(cls, text, dot) {
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
	},

	tempBadge: function(label, temp, opts) {
		var t = parseFloat(temp) || 0;
		var cls = (t >= 75) ? 'badge-danger' : (t >= 60) ? 'badge-warning' : 'badge-success';
		var tileCls = (opts && opts.tile) ? (' ' + opts.tile) : '';
		var style = (opts && opts.style) ? opts.style : '';

		return E('span', {
			'class': 'badge ' + cls + tileCls,
			'style': style,
			'title': label + ': ' + t.toFixed(1) + '°C'
		}, [
			E('strong', {}, [ label + ':' ]),
			' ' + t.toFixed(1) + '°C'
		]);
	},

	moduleChip: function(name, state, customLabel, customTitle, opts) {
		var cls, label;
		if (state === 2) {
			cls = 'badge-success';
			label = customLabel || '运行中';
		} else if (state === 1) {
			cls = 'badge-info';
			label = customLabel || '就绪待命';
		} else {
			cls = 'badge-neutral';
			label = customLabel || '未安装';
		}
		var tileCls = (opts && opts.tile) ? (' ' + opts.tile) : '';
		var style = (opts && opts.style) ? opts.style : '';

		return E('span', {
			'class': 'badge ' + cls + tileCls,
			'style': style,
			'title': customTitle || (name + ': ' + label)
		}, [
			(state === 2) ? E('span', { 'class': 'badge-dot' }) : '',
			E('strong', {}, [ name + ':' ]),
			' ' + label
		]);
	},

	bar: function(opts) {
		opts = opts || {};
		var value = opts.value;
		var max = opts.max || 100;
		var label = opts.label || '';
		var disabledText = opts.disabledText || '待机';
		var titleText = opts.title || '';
		var height = opts.height || 14;
		var extraStyle = opts.style ? ('; ' + opts.style) : '';

		if (value === null || value === undefined) {
			return E('div', {
				'class': 'nss-bar nss-bar-disabled',
				'style': 'height:' + height + 'px; min-width:80px; position:relative; overflow:hidden; margin:0; border-radius:999px !important; border:none;' + extraStyle,
				'title': titleText || (label ? (label + ': ' + disabledText) : disabledText)
			}, [
				E('span', {
					'style': 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding-top:1px; font-size:9px; font-weight:500; color:var(--text-color-medium);'
				}, [ disabledText ])
			]);
		}

		var vn = parseFloat(value) || 0;
		var pc = Math.min(100, Math.max(0, (100 / max) * vn));
		var fillClass = (vn > 80) ? 'nss-bar-danger' : (vn > 50) ? 'nss-bar-warn' : 'nss-bar-fill';

		return E('div', {
			'class': 'nss-bar',
			'style': 'height:' + height + 'px; min-width:80px; position:relative; overflow:hidden; margin:0; border-radius:999px !important; border:none;' + extraStyle,
			'title': titleText || (label ? (label + ': ' + vn.toFixed(1) + '%') : (vn.toFixed(1) + '%'))
		}, [
			E('div', {
				'class': fillClass,
				'style': 'width:' + pc.toFixed(1) + '%; height:100%; border-radius:999px; transition:width 0.3s ease;'
			}),
			E('span', {
				'style': 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding-top:1px; font-size:9px; font-weight:700; white-space:nowrap; text-shadow:0 0 2px rgba(0,0,0,0.95);'
			}, [ label ? label : ((vn % 1 === 0 ? vn.toFixed(0) : vn.toFixed(1)) + '%') ])
		]);
	},

	stack: function(opts) {
		opts = opts || {};
		var total = parseFloat(opts.total) || 0;
		var u = Math.max(0, parseFloat(opts.usr) || 0);
		var s = Math.max(0, parseFloat(opts.sys) || 0);
		var si = Math.max(0, parseFloat(opts.sirq) || 0);
		var height = opts.height || 14;
		var extraStyle = opts.style ? ('; ' + opts.style) : '';
		var labelText = opts.compact
			? ('u:' + u.toFixed(0) + '% s:' + s.toFixed(0) + '% i:' + si.toFixed(0) + '%')
			: ('usr: ' + u.toFixed(0) + '% • sys: ' + s.toFixed(0) + '% • sirq: ' + si.toFixed(0) + '%');

		return E('div', {
			'class': 'nss-bar nss-stacked',
			'style': 'height:' + height + 'px; min-width:80px; position:relative; overflow:hidden; margin:0; display:flex; border-radius:999px !important; border:none !important;' + extraStyle,
			'title': 'CPU: ' + total.toFixed(1) + '% (usr: ' + u.toFixed(1) + '% • sys: ' + s.toFixed(1) + '% • sirq: ' + si.toFixed(1) + '%)'
		}, [
			E('div', { 'style': 'width:' + u.toFixed(1) + '%; height:100%; border-radius:0 !important; background:var(--primary-color-medium, #1976d2); transition:width 0.3s ease;' }),
			E('div', { 'style': 'width:' + s.toFixed(1) + '%; height:100%; border-radius:0 !important; background:var(--warn-color-high, #efbd0b); transition:width 0.3s ease;' }),
			E('div', { 'style': 'width:' + si.toFixed(1) + '%; height:100%; border-radius:0 !important; background:var(--error-color-high, #f62b12); transition:width 0.3s ease;' }),
			E('span', {
				'style': 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding-top:1px; font-size:9px; font-weight:700; white-space:nowrap; text-shadow:0 0 2px rgba(0,0,0,0.95);'
			}, [ labelText ])
		]);
	},

	buildSpec: function(d, p) {
		d = d || {};
		p = p || {};
		var cores = p.cores || d.cores || 2;
		var rawFw = p.fw_version || d.fw_version || '12.5';
		var fwMask = p.fw_mask || d.fw_mask || '0x36';
		var fwShort = rawFw.replace(/^NSS\.(FW\.)?/, '');
		var fwDisplay = 'FW ' + fwShort + (fwMask && fwMask !== '0x0' ? ' [' + fwMask + ']' : '');
		var t = parseFloat(d.cpu_temp) || 0;

		return {
			soc: p.soc || d.soc || 'IPQ8074',
			cores: cores,
			isDualNpu: (cores !== 1),
			npuLabel: (cores !== 1) ? 'NPU ×2' : 'NPU ×1',
			freq: d.nss_freq || p.nss_freq || '1478.4 MHz',
			rawFw: rawFw,
			fwShort: fwShort,
			fwMask: fwMask,
			fwDisplay: fwDisplay,
			heartbeat: Number(d.heartbeat || 0),
			temp: t,
			conns: (d.ecm_total != null) ? d.ecm_total : 0
		};
	}
});
