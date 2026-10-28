'use strict';
'require baseclass';

return baseclass.extend({
	CSS_VERSION: '261028a',

	normIp: function(ip) {
		if (!ip || ip.indexOf(':') === -1) return (ip || '').trim().toLowerCase();
		var p = ip.trim().toLowerCase().split('::');
		var l = p[0] ? p[0].split(':') : [], r = (p.length > 1 && p[1]) ? p[1].split(':') : [];
		var mid = Array(Math.max(0, 8 - (l.length + r.length))).fill('0');
		return l.concat(mid, r).map(function(h) { return parseInt(h || '0', 16).toString(16); }).join(':');
	},

	compressIPv6: function(ip) {
		if (!ip || ip.indexOf(':') === -1) return ip;
		var words = this.normIp(ip).split(':');
		var best = -1, bestLen = 0, cur = -1, curLen = 0;
		words.forEach(function(w, i) {
			if (w === '0') {
				if (cur === -1) { cur = i; curLen = 1; } else { curLen++; }
				if (curLen > bestLen) { best = cur; bestLen = curLen; }
			} else { cur = -1; curLen = 0; }
		});
		if (bestLen < 2) return words.join(':');
		return (words.slice(0, best).join(':') + '::' + words.slice(best + bestLen).join(':')).replace(/^:::/, '::').replace(/:::$/, '::');
	},

	isPrivateIp: function(ip) {
		if (!ip) return false;
		if (ip.indexOf('192.168.') === 0 || ip.indexOf('10.') === 0 || ip.indexOf('127.') === 0) return true;
		if (ip.indexOf('172.') === 0) {
			var p = parseInt(ip.split('.')[1], 10);
			return p >= 16 && p <= 31;
		}
		if (ip.indexOf('fe80:') === 0 || ip.indexOf('fd') === 0 || ip === '::1') return true;
		return false;
	},

	getSessionData: function(key) {
		try {
			var raw = sessionStorage.getItem(key);
			return raw ? JSON.parse(raw) : null;
		} catch (e) {
			return null;
		}
	},

	setSessionData: function(key, val) {
		try {
			sessionStorage.setItem(key, JSON.stringify(val));
		} catch (e) {}
	},

	fmtRate: function(bps) {
		if (bps >= 1e9) return (bps / 1e9).toFixed(1) + ' Gbps';
		if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' Mbps';
		if (bps >= 1e3) return (bps / 1e3).toFixed(0) + ' Kbps';
		return (bps || 0).toFixed(0) + ' bps';
	},

	fmtPps: function(pps) {
		if (!pps || pps <= 0) return '';
		if (pps >= 1000) return (pps / 1000).toFixed(1) + 'k pps';
		if (pps >= 1) return pps.toFixed(0) + ' pps';
		return '<1 pps';
	},

	WELL_KNOWN_PORTS: {
		'22': 'SSH',
		'53': 'DNS',
		'80': 'HTTP',
		'443': 'HTTPS',
		'123': 'NTP'
	},

	formatEndpoint: function(ip, port) {
		if (!ip) return '-';
		var isIpv6 = (ip.indexOf(':') !== -1);
		var pStr = '';
		if (port) {
			var service = this.WELL_KNOWN_PORTS[String(port)];
			pStr = service ? (':' + port + '(' + service + ')') : (':' + port);
		}
		if (isIpv6) {
			var dispIp = this.compressIPv6(ip);
			return port ? ('[' + dispIp + ']' + pStr) : dispIp;
		}
		return ip + pStr;
	},

	copyTextToClipboard: function(text, btnElement, successMsg) {
		if (!text) return Promise.resolve();
		var doFeedback = function() {
			if (btnElement) {
				var origHtml = btnElement.innerHTML;
				btnElement.innerHTML = '✓ ' + (successMsg || _('已复制'));
				btnElement.style.color = 'var(--success-color-high, #00ac59)';
				setTimeout(function() {
					btnElement.innerHTML = origHtml;
					btnElement.style.color = '';
				}, 1200);
			}
		};

		var p;
		if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
			p = navigator.clipboard.writeText(text).then(doFeedback).catch(function() {
				fallbackCopy(text);
				doFeedback();
			});
		} else {
			fallbackCopy(text);
			doFeedback();
			p = Promise.resolve();
		}

		function fallbackCopy(val) {
			var ta = document.createElement('textarea');
			ta.value = val;
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			ta.style.top = '-9999px';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.focus();
			ta.select();
			try { document.execCommand('copy'); } catch (err) {}
			document.body.removeChild(ta);
		}

		return p;
	},

	makeScrollWrapAttrs: function(id, onHoverChange) {
		return {
			'id': id,
			'style': 'overflow-x:auto; width:100%; -webkit-overflow-scrolling:touch;',
			'mouseover': function(ev) {
				if (onHoverChange) {
					if (ev.target.closest('thead')) onHoverChange(false);
					else if (ev.target.closest('tbody')) onHoverChange(true);
				}
			},
			'mouseleave': function() {
				if (onHoverChange) onHoverChange(false);
			}
		};
	},

	preserveScroll: function(sel, parent, fn) {
		var old = parent.querySelector(sel);
		var left = old ? old.scrollLeft : 0;
		fn();
		var cur = parent.querySelector(sel);
		if (cur && left > 0) cur.scrollLeft = left;
	},

	ensureCss: function() {
		var id = 'luci-app-nss-dashboard-css';
		var el = document.getElementById(id);
		var url = L.resource('view/nss_dashboard/nss.css') + '?v=' + this.CSS_VERSION;
		if (!el) {
			document.head.appendChild(E('link', {
				'id': id,
				'rel': 'stylesheet',
				'type': 'text/css',
				'href': url
			}));
		} else if (el.href.indexOf('?v=' + this.CSS_VERSION) === -1) {
			el.href = url;
		}
	}
});
