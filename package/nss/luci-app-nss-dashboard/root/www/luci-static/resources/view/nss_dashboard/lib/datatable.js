'use strict';
'require baseclass';
'require dom';

return baseclass.extend({
	create: function(cfg) {
		cfg = cfg || {};
		var cols = cfg.cols || [];
		var sortKey = cfg.sortKey || (cols[0] ? cols[0].key : '');
		var sortDir = cfg.sortDir != null ? cfg.sortDir : -1;
		var filterMap = cfg.filterMap || {};
		var colSpan = cols.length || 6;

		var thead = E('thead');
		var tbody = E('tbody');
		var table = E('table', {
			'id': cfg.tableId || null,
			'class': cfg.tableClass || 'table nss-fixed-table'
		}, [ thead, tbody ]);

		function updateHeaders() {
			var headerCells = cols.map(function(col) {
				var isSorted = (cfg.sortable !== false && sortKey === col.key);
				var arrow = isSorted ? (sortDir > 0 ? ' ▲' : ' ▼') : '';
				var thAttrs = {
					'class': 'th' + (isSorted ? ' sorted' : ''),
					'style': 'width:' + col.width + ';' + (cfg.sortable !== false ? ' cursor:pointer; user-select:none;' : ''),
					'title': (col.hint ? (col.hint + ' • ') : '') + (cfg.sortable !== false ? _('点击排序') : '')
				};
				if (cfg.sortable !== false) {
					thAttrs['click'] = function() {
						if (sortKey === col.key) {
							sortDir = -sortDir;
						} else {
							sortKey = col.key;
							sortDir = col.num ? -1 : 1;
						}
						updateHeaders();
						if (cfg.onSort) {
							cfg.onSort(sortKey, sortDir);
						}
					};
				}
				return E('th', thAttrs, [ col.title + arrow ]);
			});

			var headRows = [ E('tr', { 'class': 'tr table-titles' }, headerCells) ];

			if (cfg.filter) {
				var filterCells = cols.map(function(col) {
					if (col.filter === false) {
						return E('td', { 'class': 'td' });
					}
					return E('td', { 'class': 'td' }, [
						E('input', {
							'type': 'text',
							'class': 'cbi-input-text',
							'style': 'width:100%; min-width:3em;',
							'placeholder': _('过滤…'),
							'value': filterMap[col.key] || '',
							'input': function(ev) {
								filterMap[col.key] = ev.target.value.trim().toLowerCase();
								if (cfg.onFilterChange) {
									cfg.onFilterChange(filterMap);
								}
							}
						})
					]);
				});
				headRows.push(E('tr', { 'class': 'tr' }, filterCells));
			}

			dom.content(thead, headRows);
		}

		updateHeaders();

		function sortItems(items) {
			if (cfg.sortable === false || !sortKey) return items;
			var curCol = cols.find(function(c) { return c.key === sortKey; }) || cols[0];
			if (!curCol) return items;
			return items.sort(function(a, b) {
				var va = curCol.get ? curCol.get(a) : a[curCol.key];
				var vb = curCol.get ? curCol.get(b) : b[curCol.key];
				if (curCol.num) return ((va || 0) - (vb || 0)) * sortDir;
				return String(va || '').localeCompare(String(vb || '')) * sortDir;
			});
		}

		/* freeze=true（悬停冻结）：跳过排序、已有行原位 patch 不移动、
		   新行追加表尾、消失行暂缓删除；移出后下一次 update 恢复排序并清理。 */
		function patchRows(items, freeze) {
			if (!items || !items.length) {
				if (freeze && tbody.querySelector('tr[data-key]')) return;
				dom.content(tbody, [
					E('tr', { 'class': 'tr tr-empty-placeholder', 'data-empty': 'true' }, [
						E('td', {
							'class': 'td',
							'colspan': String(colSpan),
							'style': 'text-align:center; color:var(--text-color-medium);'
						}, [ cfg.emptyText || _('暂无数据') ])
					])
				]);
				return;
			}

			tbody.querySelectorAll('tr[data-empty], .tr-empty-placeholder, tr.tr-empty-placeholder').forEach(function(ph) {
				if (ph.parentNode === tbody) tbody.removeChild(ph);
			});

			var existing = {};
			tbody.querySelectorAll('tr[data-key]').forEach(function(r) {
				existing[r.getAttribute('data-key')] = r;
			});

			items.forEach(function(item) {
				var key = item.key || (cfg.getKey ? cfg.getKey(item) : item.id);
				var row = existing[key];
				if (row) {
					delete existing[key];
					if (cfg.patchRow) {
						cfg.patchRow(row, item);
					}
					if (!freeze) tbody.appendChild(row);
				} else {
					row = cfg.renderRow(item);
					tbody.appendChild(row);
				}

				if (cfg.renderExpandRow) {
					var expandContent = cfg.renderExpandRow(item);
					var expandRow = tbody.querySelector('tr[data-expand-for="' + key + '"]');
					if (expandContent) {
						if (!expandRow) {
							expandRow = E('tr', {
								'class': 'client-expand-row',
								'data-expand-for': key
							}, [
								E('td', { 'colspan': String(colSpan) }, Array.isArray(expandContent) ? expandContent : [ expandContent ])
							]);
							row.insertAdjacentElement('afterend', expandRow);
						} else {
							var td = expandRow.querySelector('td');
							if (td) dom.content(td, Array.isArray(expandContent) ? expandContent : [ expandContent ]);
							if (!freeze) tbody.appendChild(expandRow);
						}
					} else if (expandRow && !freeze) {
						if (expandRow.parentNode === tbody) expandRow.parentNode.removeChild(expandRow);
					}
				} else {
					var existingExpand = tbody.querySelector('tr[data-expand-for="' + key + '"]');
					if (existingExpand && !freeze) {
						tbody.appendChild(existingExpand);
					}
				}
			});

			if (freeze) return;

			Object.keys(existing).forEach(function(k) {
				if (existing[k].parentNode === tbody) {
					var expandRow = tbody.querySelector('tr[data-expand-for="' + k + '"]');
					if (expandRow && expandRow.parentNode === tbody) {
						expandRow.parentNode.removeChild(expandRow);
					}
					tbody.removeChild(existing[k]);
				}
			});
		}

		var wrapNode;
		if (cfg.wrapId) {
			wrapNode = E('div', {
				'id': cfg.wrapId,
				'style': 'overflow-x:auto; width:100%; -webkit-overflow-scrolling:touch;',
				'mouseover': function(ev) {
					if (cfg.onHoverChange) {
						if (ev.target.closest('thead')) cfg.onHoverChange(false);
						else if (ev.target.closest('tbody')) cfg.onHoverChange(true);
					}
				},
				'mouseleave': function() {
					if (cfg.onHoverChange) cfg.onHoverChange(false);
				}
			}, [ table ]);
		}

		return {
			node: wrapNode || table,
			table: table,
			thead: thead,
			tbody: tbody,
			getSortKey: function() { return sortKey; },
			getSortDir: function() { return sortDir; },
			setSort: function(key, dir) {
				sortKey = key;
				sortDir = dir;
				updateHeaders();
			},
			update: function(items, freeze) {
				var list = items ? items.slice() : [];
				patchRows(freeze ? list : sortItems(list), !!freeze);
			}
		};
	}
});
