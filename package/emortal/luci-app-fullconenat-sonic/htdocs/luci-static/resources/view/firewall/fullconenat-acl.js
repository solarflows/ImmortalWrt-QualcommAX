'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

const callHostHints = rpc.declare({
	object: 'luci-rpc',
	method: 'getHostHints',
	expect: { '': {} }
});

const macPattern = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;

function canonMAC(mac) {
	return String(mac).trim().replace(/-/g, ':').toUpperCase();
}

function isMAC(value) {
	return macPattern.test(String(value).trim());
}

function splitTokens(values) {
	const tokens = [];

	for (const value of L.toArray(values))
		for (const token of String(value).split(/[ \t]+/))
			if (token !== '')
				tokens.push(token);

	return tokens;
}

function hostHints(data) {
	const hosts = {};

	for (const mac in (data || {})) {
		const hint = data[mac] || {};
		const key = canonMAC(mac);
		const entry = hosts[key] || (hosts[key] = { name: '', ipv4: [] });

		if (hint.name)
			entry.name = hint.name;

		for (const ip of L.toArray(hint.ipaddrs || hint.ipv4))
			if (ip && !ip.includes(':') && !entry.ipv4.includes(ip))
				entry.ipv4.push(ip);
	}

	return hosts;
}

function staticLeases() {
	const leases = {};

	uci.sections('dhcp', 'host', function(section) {
		const name = section.name || '';
		const addresses = L.toArray(section.ip);

		for (const mac of L.toArray(section.mac))
			if (isMAC(mac))
				leases[canonMAC(mac)] = { name: name, addr: addresses[0] || null };
	});

	return leases;
}

return view.extend({
	load() {
		return Promise.all([
			uci.load('firewall'),
			uci.load('dhcp').catch(() => null),
			callHostHints().catch(() => null)
		]);
	},

	render(data) {
		const hosts = hostHints(data[2]);
		const leases = staticLeases();

		function currentAddrs(mac) {
			const key = canonMAC(mac);
			const host = hosts[key];

			if (host && host.ipv4.length)
				return host.ipv4;

			const lease = leases[key];

			if (lease && lease.addr)
				return [ lease.addr ];

			return [];
		}

		function hostLabel(mac) {
			const key = canonMAC(mac);

			return (hosts[key] && hosts[key].name) || (leases[key] && leases[key].name) || key;
		}

		let m, s, o;

		m = new form.Map('firewall', _('Fullcone NAT - Device Access Control'),
			_('Limits fullcone NAT (NAT1) to the devices listed below. Devices that are not listed keep ordinary masquerading and are not reachable from the internet through this mapping. The master switch and the per-zone switch are configured under Firewall - Zone Settings; this page only takes effect for zones that have fullcone NAT enabled there.'));

		s = m.section(form.TypedSection, 'defaults', _('General Settings'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'fullcone_acl', _('Only allow NAT1 for the listed devices'));
		o.default = '0';
		o.rmempty = false;
		o.description = _('Until this is enabled, every device of a zone with fullcone NAT enabled receives NAT1 mappings. Once enabled, only the devices listed below do; an empty list therefore disables fullcone NAT mappings entirely.');

		s = m.section(form.TypedSection, 'fullcone_device', _('Devices'));
		s.anonymous = true;
		s.addremove = true;
		s.sectiontitle = section_id => uci.get('firewall', section_id, 'remarks') || section_id;
		s.description = _('Devices chosen by MAC address are resolved to their current IP address every time this page is saved, because the firewall works with addresses. Devices without a static lease may change their address at any time, so configuring a static lease for them is recommended.');

		s.handleAdd = function(ev, name) {
			const config_name = this.uciconfig ?? this.map.config;
			let section_id;

			do {
				section_id = 'acl_%s'.format(Math.random().toString(36).substring(2, 7));
			} while (this.map.data.get(config_name, section_id) != null);

			this.map.data.add(config_name, this.sectiontype, section_id);

			return this.map.save(null, true);
		};

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'remarks', _('Remarks'));
		o.rmempty = true;
		o.placeholder = _('e.g. living room PC');

		o = s.option(form.DynamicList, 'devices', _('Devices (by MAC)'));
		o.datatype = 'list(macaddr)';
		o.rmempty = false;
		o.placeholder = _('Pick a device or enter its MAC address');

		for (const key in hosts)
			o.value(key, '%s (%s)'.format(key, hosts[key].ipv4[0] || hosts[key].name || _('offline')));

		for (const key in leases)
			o.value(key, '%s (%s)'.format(key, leases[key].addr || leases[key].name || _('static lease')));

		o.write = function(section_id, value) {
			const macs = splitTokens(value).map(canonMAC);

			uci.set('firewall', section_id, 'mac', macs.length ? macs : null);
		};

		o.remove = function(section_id) {
			uci.set('firewall', section_id, 'mac', null);
		};

		o = s.option(form.DynamicList, 'addresses', _('Additional IP addresses'));
		o.datatype = 'list(ipmask("true"))';
		o.rmempty = false;
		o.placeholder = _('IP address or subnet, e.g. 192.168.1.50 or 192.168.1.0/24');
		o.description = _('Use these entries for devices with a fixed address; they are applied as given and are not resolved.');

		o.write = function(section_id, value) {
			const devices = this.map.lookupOption('devices', section_id)[0];
			const macs = splitTokens(devices ? devices.formvalue(section_id) : null);
			const addrs = splitTokens(value);

			for (const mac of macs)
				if (isMAC(mac))
					for (const addr of currentAddrs(mac))
						if (!addrs.includes(addr))
							addrs.push(addr);

			uci.set('firewall', section_id, 'ip', addrs.length ? addrs : null);
		};

		o.remove = function(section_id) {
			uci.set('firewall', section_id, 'ip', null);
		};

		o = s.option(form.DummyValue, '_status', _('Status'));
		o.cfgvalue = function(section_id) {
			const section = uci.get('firewall', section_id) || {};
			const macs = L.toArray(section.mac);
			const addrs = L.toArray(section.ip);
			const nodes = [];

			for (const mac of macs) {
				const current = currentAddrs(mac);
				const label = hostLabel(mac);

				if (current.length)
					nodes.push(E('div', {}, [ '%s: %s'.format(label, current.join(', ')) ]));
				else
					nodes.push(E('div', { 'style': 'color:#c00' },
						[ _('%s: no current address, NAT1 is not applied').format(label) ]));

				if (!leases[canonMAC(mac)])
					nodes.push(E('div', { 'style': 'color:#e60' },
						[ _('%s: no static lease, the address may change').format(label) ]));
			}

			if (!macs.length && !addrs.length)
				nodes.push(E('div', { 'style': 'color:#c00' },
					[ _('No device address configured - fullcone NAT is disabled for every device of this zone.') ]));

			return E('div', {}, nodes);
		};

		o = s.option(form.Button, '_resolve', _('Resolve MAC addresses'));
		o.inputtitle = _('Refresh');
		o.inputstyle = 'action';
		o.description = _('Re-resolve the MAC addresses above to their current IP addresses. Saving this page does this automatically.');
		o.onclick = function(ev, section_id) {
			const devices = this.map.lookupOption('devices', section_id)[0];
			const resolved = [];

			for (const mac of splitTokens(devices ? devices.formvalue(section_id) : null))
				if (isMAC(mac))
					for (const addr of currentAddrs(mac))
						if (!resolved.includes(addr))
							resolved.push(addr);

			const addresses = this.map.lookupOption('addresses', section_id)[0];
			const element = addresses ? addresses.getUIElement(section_id) : null;

			if (element)
				element.setValue(resolved);

			ui.addNotification(null, E('p', {},
				[ _('Resolved %d address(es). Save the configuration to apply them.').format(resolved.length) ]));
		};

		o.write = function() {};
		o.remove = function() {};

		return m.render();
	}
});
