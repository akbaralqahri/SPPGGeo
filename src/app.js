(function () {
  'use strict';

  const S = window.SPPGShared;
  const D = window.SPPG_DATA;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const e = S.escapeHTML;

  let rows = (D?.rows || []).map(S.normalizeRecord);
  let contextRows = [];
  let model = S.derive(rows, D?.nationalProvinces, contextRows);
  let map;
  let tileLayer;
  let markerLayer;
  let provinceChart;
  let islandChart;
  let equityChart;
  let markerMode = 'cluster';

  const state = {
    view: 'ringkasan',
    filters: { provinsi: '', yayasan: '', status: '', q: '' },
    table: { provinsi: '', flag: '', q: '', sortKey: 'no', sortDir: 1, page: 1, size: 25 },
  };

  function chartColors() {
    const css = getComputedStyle(document.documentElement);
    return {
      brand: css.getPropertyValue('--brand').trim(),
      indigo: css.getPropertyValue('--indigo').trim(),
      lime: css.getPropertyValue('--lime').trim(),
      muted: css.getPropertyValue('--muted').trim(),
      line: css.getPropertyValue('--line').trim(),
      surface: css.getPropertyValue('--surface').trim(),
    };
  }

  function statusBadge(status) {
    return `<span class="status-badge ${e(status)}">${e(S.STATUS_LABELS[status] || status)}</span>`;
  }
  function flagBadges(flags) {
    if (!flags?.length) return '<span class="status-badge">Tanpa catatan</span>';
    return flags.map((flag) => `<span class="flag-badge ${flag === 'duplikat_persis' ? 'duplicate' : ''}">${e(S.FLAG_LABELS[flag] || flag)}</span>`).join('');
  }
  function option(value, label, selected = false) {
    return `<option value="${e(value)}"${selected ? ' selected' : ''}>${e(label)}</option>`;
  }

  function readUrlState() {
    const params = new URLSearchParams(location.search);
    state.filters.provinsi = params.get('prov') || '';
    state.filters.yayasan = params.get('yay') || '';
    state.filters.status = params.get('status') || '';
    state.filters.q = params.get('q') || '';
    const hash = location.hash.replace('#', '');
    if (['ringkasan', 'pemerataan', 'kualitas', 'dataset'].includes(hash)) state.view = hash;
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (state.filters.provinsi) params.set('prov', state.filters.provinsi);
    if (state.filters.yayasan) params.set('yay', state.filters.yayasan);
    if (state.filters.status) params.set('status', state.filters.status);
    if (state.filters.q) params.set('q', state.filters.q);
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? '?' + query : ''}#${state.view}`);
  }

  function filteredRows() {
    const q = state.filters.q.trim().toLowerCase();
    return rows.filter((row) =>
      (!state.filters.provinsi || row.provinsi === state.filters.provinsi) &&
      (!state.filters.yayasan || row.yayasan === state.filters.yayasan) &&
      (!state.filters.status || row.statusOperasional === state.filters.status) &&
      (!q || [row.alamat, row.kabkota, row.provinsi, row.yayasan].some((value) => value.toLowerCase().includes(q)))
    );
  }

  function bindNavigation() {
    $$('[data-view-target], [data-go-view]').forEach((node) => node.addEventListener('click', () => {
      navigate(node.dataset.viewTarget || node.dataset.goView);
    }));
    addEventListener('hashchange', () => {
      const target = location.hash.replace('#', '');
      if (['ringkasan', 'pemerataan', 'kualitas', 'dataset'].includes(target)) navigate(target, false);
    });
  }

  function navigate(view, updateHistory = true) {
    state.view = view;
    $$('.view').forEach((section) => {
      const active = section.dataset.view === view;
      section.hidden = !active;
      section.classList.toggle('active', active);
    });
    $$('[data-view-target]').forEach((button) => button.classList.toggle('active', button.dataset.viewTarget === view));
    if (updateHistory) syncUrl();
    scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (view === 'ringkasan') setTimeout(() => { map?.invalidateSize(); renderOverviewCharts(filteredRows()); }, 80);
    if (view === 'pemerataan') setTimeout(renderEquity, 40);
    if (view === 'kualitas') renderQuality();
    if (view === 'dataset') renderDataset();
  }

  function fillControls() {
    const presentProvinces = model.provinces.filter((p) => p.count).sort((a, b) => a.name.localeCompare(b.name));
    const provinceOptions = presentProvinces.map((p) => option(p.name, `${p.name} (${p.count})`)).join('');
    $('#filterProvince').innerHTML = option('', 'Semua provinsi') + provinceOptions;
    $('#tableProvince').innerHTML = option('', 'Semua provinsi') + provinceOptions;
    $('#filterPartner').innerHTML = option('', 'Semua yayasan') + model.partners.map((p) => option(p.name === '(Tanpa yayasan)' ? '-' : p.name, `${p.name} (${p.count})`)).join('');
    $('#filterProvince').value = state.filters.provinsi;
    $('#filterPartner').value = state.filters.yayasan;
    $('#filterStatus').value = state.filters.status;
    $('#filterSearch').value = state.filters.q;

    const allProvinceOptions = model.provinces.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => option(p.name, `${p.name} · ${p.count} SPPG`)).join('');
    $('#compareA').innerHTML = allProvinceOptions;
    $('#compareB').innerHTML = allProvinceOptions;
    $('#compareA').value = model.provinces[0]?.name || '';
    $('#compareB').value = model.provinces[1]?.name || '';
  }

  function bindFilters() {
    $('#filterProvince').addEventListener('change', (event) => updateFilter('provinsi', event.target.value));
    $('#filterPartner').addEventListener('change', (event) => updateFilter('yayasan', event.target.value));
    $('#filterStatus').addEventListener('change', (event) => updateFilter('status', event.target.value));
    let searchTimer;
    $('#filterSearch').addEventListener('input', (event) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => updateFilter('q', event.target.value), 180);
    });
    $('#resetFilters').addEventListener('click', resetFilters);
    $('#applyMobileFilters').addEventListener('click', () => S.toast(`${S.fmt(filteredRows().length)} data sesuai filter.`));
    $('#activeFilters').addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-filter]');
      if (button) updateFilter(button.dataset.removeFilter, '');
    });
  }

  function updateFilter(key, value) {
    state.filters[key] = value;
    if (key !== 'q') {
      const control = { provinsi: '#filterProvince', yayasan: '#filterPartner', status: '#filterStatus' }[key];
      if (control) $(control).value = value;
    }
    if (key === 'q') $('#filterSearch').value = value;
    syncUrl();
    renderOverview();
  }

  function resetFilters() {
    Object.assign(state.filters, { provinsi: '', yayasan: '', status: '', q: '' });
    $('#filterProvince').value = '';
    $('#filterPartner').value = '';
    $('#filterStatus').value = '';
    $('#filterSearch').value = '';
    syncUrl();
    renderOverview();
  }

  function renderActiveFilters() {
    const labels = {
      provinsi: state.filters.provinsi,
      yayasan: state.filters.yayasan,
      status: S.STATUS_LABELS[state.filters.status],
      q: state.filters.q ? `“${state.filters.q}”` : '',
    };
    $('#activeFilters').innerHTML = Object.entries(labels).filter(([, value]) => value).map(([key, value]) =>
      `<span class="filter-chip">${e(value)}<button type="button" data-remove-filter="${key}" aria-label="Hapus filter ${e(value)}">×</button></span>`
    ).join('');
  }

  function kpiCard(label, value, detail, trend = '') {
    return `<article class="kpi-card"><small>${e(label)}</small><div><b>${value}</b><p class="${trend ? 'trend' : ''}">${e(detail)}</p></div></article>`;
  }

  function renderOverview() {
    const filtered = filteredRows();
    const current = S.derive(filtered, D.nationalProvinces);
    renderActiveFilters();
    $('#overviewKpis').innerHTML = [
      kpiCard('Hasil ditampilkan', S.fmt(current.total), current.total === model.total ? 'seluruh snapshot' : `dari ${S.fmt(model.total)} data`, current.total !== model.total),
      kpiCard('Provinsi tercakup', `${current.uniqueProvince}<small> / 38</small>`, `${38 - current.uniqueProvince} belum tercakup`),
      kpiCard('Kabupaten/kota', S.fmt(current.uniqueKab), 'wilayah unik'),
      kpiCard('Yayasan / mitra', S.fmt(current.uniquePartners), 'penyelenggara unik'),
      kpiCard('Berada di Jawa', S.pct(current.jawa, current.total), `${S.fmt(current.jawa)} dapur`),
      kpiCard('Status terverifikasi', S.pct(current.operationsKnown, 100), `${current.operationsKnown}% sudah diperbarui`),
    ].join('');
    $('#heroTotal').textContent = S.fmt(model.total);
    const top = model.provinces[0];
    $('#heroNarrative').textContent = `${top.name} memuat ${S.pct(top.count, model.total, 1)} dari seluruh snapshot, sementara ${model.uncovered.length} provinsi belum tercatat memiliki SPPG. Gunakan analitik untuk membaca konsentrasi ini secara hati-hati.`;
    $('#javaShareHeadline').textContent = `${S.pct(model.jawa, model.total)} berada di Pulau Jawa`;
    renderAttention(current);
    renderMap(filtered);
    renderOverviewCharts(filtered);
    renderTopPartners(current);
  }

  function renderAttention(current) {
    if (!current.total) {
      $('#attentionList').innerHTML = '<div class="attention-item"><span class="attention-index">00</span><div><b>Tidak ada data yang sesuai</b><small>Ubah atau reset filter untuk menampilkan kembali data.</small></div><button type="button" data-reset-empty aria-label="Reset filter">↺</button></div>';
      $('[data-reset-empty]', $('#attentionList')).addEventListener('click', resetFilters);
      return;
    }
    const top = current.provinces[0] || { name: '—', count: 0 };
    const items = [
      { index: '01', title: `${top.name} paling terkonsentrasi`, note: `${top.count} SPPG pada hasil saat ini`, view: 'pemerataan' },
      { index: '02', title: `${current.uncovered.length} provinsi belum tercakup`, note: 'Perlu pembacaan bersama data kebutuhan', view: 'pemerataan' },
      { index: '03', title: `${current.flagged} baris perlu ditinjau`, note: `${current.duplicateGroups.length} kelompok duplikat persis`, view: 'kualitas' },
      { index: '04', title: `${current.operationsKnown}% status telah diverifikasi`, note: 'Lengkapi melalui portal operasional', href: 'admin.html' },
    ];
    $('#attentionList').innerHTML = items.map((item) => `<div class="attention-item"><span class="attention-index">${item.index}</span><div><b>${e(item.title)}</b><small>${e(item.note)}</small></div>${item.href ? `<a href="${item.href}" aria-label="Buka ${e(item.title)}">→</a>` : `<button type="button" data-attention-view="${item.view}" aria-label="Buka ${e(item.title)}">→</button>`}</div>`).join('');
    $$('[data-attention-view]', $('#attentionList')).forEach((button) => button.addEventListener('click', () => navigate(button.dataset.attentionView)));
  }

  function initMap() {
    map = L.map('map', { minZoom: 4, zoomControl: true, attributionControl: true }).setView([-2.25, 118], 5);
    updateMapTiles();
    $('#mapClusters').addEventListener('click', () => setMarkerMode('cluster'));
    $('#mapPoints').addEventListener('click', () => setMarkerMode('points'));
    map.on('popupopen', (event) => {
      const button = event.popup.getElement()?.querySelector('[data-map-detail]');
      if (button) button.addEventListener('click', () => openDetail(button.dataset.mapDetail));
    });
  }

  function updateMapTiles() {
    if (!map) return;
    if (tileLayer) map.removeLayer(tileLayer);
    const dark = document.documentElement.dataset.theme === 'dark';
    tileLayer = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, {
      attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);
  }

  function setMarkerMode(mode) {
    markerMode = mode;
    $('#mapClusters').classList.toggle('active', mode === 'cluster');
    $('#mapPoints').classList.toggle('active', mode === 'points');
    renderMap(filteredRows());
  }

  function renderMap(list) {
    if (!map) return;
    if (markerLayer) map.removeLayer(markerLayer);
    markerLayer = markerMode === 'cluster' ? L.markerClusterGroup({ maxClusterRadius: 42, showCoverageOnHover: false }) : L.layerGroup();
    const bounds = [];
    for (const row of list) {
      if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
      const flagged = row.flags.length > 0;
      const operational = row.statusOperasional === 'operasional';
      const marker = L.circleMarker([row.lat, row.lng], {
        radius: markerMode === 'points' ? 5 : 6,
        weight: 1.5,
        color: '#ffffff',
        fillColor: flagged ? '#d68b12' : operational ? '#35a87e' : '#087f6f',
        fillOpacity: .94,
      });
      marker.bindPopup(`<div class="map-popup"><span class="popup-region">${e(row.provinsi)} · #${row.no}</span><p><b>${e(row.kabkota)}</b><br>${e(row.alamat)}</p><small>${e(row.yayasan === '-' ? 'Yayasan belum dicantumkan' : row.yayasan)}</small><br><button type="button" data-map-detail="${e(row.id)}">Buka detail →</button></div>`);
      markerLayer.addLayer(marker);
      bounds.push([row.lat, row.lng]);
    }
    markerLayer.addTo(map);
    if (state.filters.provinsi && bounds.length) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 8 });
    else if (!state.filters.provinsi) map.setView([-2.25, 118], 5);
  }

  function renderOverviewCharts(list) {
    if (state.view !== 'ringkasan') return;
    const current = S.derive(list, D.nationalProvinces);
    const colors = chartColors();
    Chart.defaults.color = colors.muted;
    Chart.defaults.font.family = 'Inter, ui-sans-serif, system-ui, sans-serif';
    Chart.defaults.animation = false;
    const top = current.provinces.filter((p) => p.count).slice(0, 7);
    provinceChart?.destroy();
    provinceChart = new Chart($('#overviewProvinceChart'), {
      type: 'bar',
      data: { labels: top.map((p) => p.name), datasets: [{ data: top.map((p) => p.count), backgroundColor: colors.brand, borderRadius: 7, barThickness: 14 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, onClick: (_event, elements) => { if (elements[0]) updateFilter('provinsi', top[elements[0].index].name); }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw} SPPG` } } }, scales: { x: { grid: { color: colors.line }, ticks: { precision: 0 } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } } },
    });
    islandChart?.destroy();
    islandChart = new Chart($('#islandChart'), {
      type: 'doughnut',
      data: { labels: ['Jawa', 'Luar Jawa'], datasets: [{ data: [current.jawa, current.luarJawa], backgroundColor: [colors.brand, colors.indigo], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16 } }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.raw} (${S.pct(ctx.raw, current.total)})` } } } },
    });
    $('#donutCenter').innerHTML = `<b>${S.fmt(current.total)}</b><small>SPPG</small>`;
  }

  function renderTopPartners(current) {
    $('#topPartners').innerHTML = current.partners.slice(0, 6).map((partner, index) => `<div class="rank-row"><span>${String(index + 1).padStart(2, '0')}</span><span class="rank-name" title="${e(partner.name)}">${e(partner.name)}</span><b>${partner.count}</b></div>`).join('');
  }

  function renderTrust() {
    $('#trustScore').textContent = model.qualityScore;
    $('#trustMeter').style.width = `${model.qualityScore}%`;
    $('#datasetPeriod').textContent = D.meta.datasetAsOf ? new Date(D.meta.datasetAsOf).toLocaleDateString('id-ID', { dateStyle: 'medium' }) : 'Belum dicantumkan';
    const source = D.meta.sourceName || 'Tabel yang diberikan';
    const sourceUrl = /^https?:\/\//i.test(D.meta.sourceUrl || '') ? D.meta.sourceUrl : '';
    $('#datasetSource').innerHTML = sourceUrl ? `<a href="${e(sourceUrl)}" target="_blank" rel="noreferrer">${e(source)}</a>` : e(source);
    $('#generatedDate').textContent = new Date(D.meta.generatedAt).toLocaleDateString('id-ID', { dateStyle: 'medium' });
  }

  function renderEquity() {
    const colors = chartColors();
    const banner = $('#view-pemerataan .method-banner');
    if (model.contextCoverage) {
      banner.innerHTML = `<b>Demand gap berbobot aktif untuk ${model.contextCoverage} provinsi.</b><span>Provinsi tanpa data konteks tetap memakai proxy pemerataan. Lengkapi seluruh 38 provinsi agar perbandingan nasional konsisten.</span>`;
    }
    $('#equityKpis').innerHTML = [
      kpiCard('Provinsi tanpa SPPG', model.uncovered.length, 'dari 38 provinsi'),
      kpiCard('Share provinsi tertinggi', S.pct(model.provinces[0].count, model.total, 1), model.provinces[0].name),
      kpiCard('Top 3 provinsi', S.pct(model.provinces.slice(0, 3).reduce((sum, p) => sum + p.count, 0), model.total, 1), 'dari seluruh snapshot'),
      kpiCard('Data kapasitas tersedia', S.pct(model.capacityKnown, model.total), `${model.capacityKnown} dari ${model.total} dapur`),
    ].join('');
    renderGapList();
    const provinceData = model.provinces.filter((p) => p.count).slice(0, 15);
    equityChart?.destroy();
    equityChart = new Chart($('#equityChart'), {
      type: 'bar',
      data: { labels: provinceData.map((p) => p.name), datasets: [{ data: provinceData.map((p) => p.count), backgroundColor: provinceData.map((_, i) => i < 3 ? colors.brand : colors.indigo), borderRadius: 6, barThickness: 12 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: colors.line }, ticks: { precision: 0 } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } } },
    });
    renderComparison();
  }

  function renderGapList() {
    const sort = $('#gapSort').value;
    const provinces = model.provinces.slice().sort((a, b) => sort === 'count' ? b.count - a.count : sort === 'alpha' ? a.name.localeCompare(b.name) : b.gap - a.gap || a.count - b.count);
    $('#gapList').innerHTML = provinces.map((province) => {
      const level = province.gap >= 75 ? 'high' : province.gap >= 35 ? 'medium' : '';
      const label = province.gap >= 75 ? 'Prioritas tinggi' : province.gap >= 35 ? 'Perlu perhatian' : province.gapMode === 'proxy' ? 'Di atas proxy' : 'Gap rendah';
      const mode = province.gapMode === 'capacity' ? 'kapasitas vs target' : province.gapMode === 'weighted' ? 'bobot kebutuhan' : 'proxy setara provinsi';
      return `<div class="gap-row"><div class="gap-region"><b>${e(province.name)}</b><small>${province.count} SPPG · ${province.kab} kab/kota · ${mode}</small></div><div class="gap-meter" title="Indeks gap ${province.gap}"><span style="width:${province.gap}%"></span></div><span class="gap-value">${province.gap}</span><span class="gap-status ${level}">${label}</span></div>`;
    }).join('');
  }

  function renderComparison() {
    const a = model.provinces.find((p) => p.name === $('#compareA').value) || model.provinces[0];
    const b = model.provinces.find((p) => p.name === $('#compareB').value) || model.provinces[1];
    const side = (p) => `<div class="comparison-side"><h3>${e(p.name)}</h3>${[
      ['Jumlah SPPG', S.fmt(p.count)], ['Kab/kota tercatat', S.fmt(p.kab)], ['Yayasan unik', S.fmt(p.partners)],
      ['Baris bercatatan', S.fmt(p.flagged)], ['Status operasional', S.fmt(p.operational)], [p.gapMode === 'proxy' ? 'Indeks gap proxy' : 'Indeks demand gap', p.gap],
      ['Populasi sasaran', p.context?.populationTarget ? S.fmt(p.context.populationTarget) : 'Belum tersedia'],
    ].map(([label, value]) => `<div class="comparison-metric"><span>${label}</span><b>${value}</b></div>`).join('')}</div>`;
    $('#comparisonResult').innerHTML = `${side(a)}<div class="comparison-divider"></div>${side(b)}`;
  }

  function renderQuality() {
    $('#qualityRing').innerHTML = `<b>${model.qualityScore}</b><small>/100</small>`;
    $('#qualityRing').style.background = `radial-gradient(circle at center, #172e2a 58%, transparent 60%), conic-gradient(var(--lime) 0 ${model.qualityScore}%, rgba(255,255,255,.12) ${model.qualityScore}% 100%)`;
    const dimensions = [
      ['Kelengkapan yayasan', model.completeness], ['Konsistensi wilayah', model.consistency],
      ['Keunikan baris', model.uniqueness], ['Kualitas alamat', model.addressQuality],
    ];
    $('#qualityDimensions').innerHTML = dimensions.map(([label, value]) => `<div class="dimension-card"><span>${e(label)}</span><b>${value}%</b><div class="dimension-bar"><i style="width:${value}%"></i></div></div>`).join('');
    $('#qualityKpis').innerHTML = [
      kpiCard('Baris bercatatan', model.flagged, `${S.pct(model.flagged, model.total, 1)} dari snapshot`),
      kpiCard('Pasangan duplikat', model.duplicateGroups.length, `${model.duplicateGroups.reduce((sum, group) => sum + group.length, 0)} baris terlibat`),
      kpiCard('Koordinat presisi', `${model.precision}%`, 'sisanya centroid kab/kota'),
      kpiCard('Status diverifikasi', `${model.operationsKnown}%`, 'perlu pembaruan operasional'),
    ].join('');
    const flagOrder = ['alamat_minim', 'duplikat_persis', 'yayasan_kosong', 'alamat_luar_provinsi'];
    $('#qualityFlags').innerHTML = flagOrder.map((flag) => `<div class="quality-flag"><span class="flag-count">${model.flagCounts[flag]}</span><div><b>${e(S.FLAG_LABELS[flag])}</b><small>${e(S.FLAG_DESCRIPTIONS[flag])}</small></div><button type="button" data-quality-filter="${flag}">Tinjau →</button></div>`).join('');
    $$('[data-quality-filter]', $('#qualityFlags')).forEach((button) => button.addEventListener('click', () => openDatasetFlag(button.dataset.qualityFilter)));
    $('#duplicateList').innerHTML = model.duplicateGroups.map((group) => `<div class="duplicate-pair"><span class="duplicate-nos">#${group.map((row) => row.no).join(' / #')}</span><div><b>${e(group[0].kabkota)}, ${e(group[0].provinsi)}</b><small>${e(group[0].alamat)}</small></div><button type="button" data-duplicate-detail="${e(group[0].id)}">Detail →</button></div>`).join('');
    $$('[data-duplicate-detail]', $('#duplicateList')).forEach((button) => button.addEventListener('click', () => openDetail(button.dataset.duplicateDetail)));
  }

  function openDatasetFlag(flag) {
    state.table.flag = flag;
    state.table.page = 1;
    $('#tableFlag').value = flag;
    navigate('dataset');
  }

  function datasetRows() {
    const q = state.table.q.trim().toLowerCase();
    const list = rows.filter((row) =>
      (!state.table.provinsi || row.provinsi === state.table.provinsi) &&
      (!state.table.flag || row.flags.includes(state.table.flag)) &&
      (!q || [row.provinsi, row.kabkota, row.alamat, row.yayasan].some((value) => value.toLowerCase().includes(q)))
    );
    return list.sort((a, b) => {
      let x = a[state.table.sortKey]; let y = b[state.table.sortKey];
      if (state.table.sortKey === 'flags') { x = a.flags.length; y = b.flags.length; }
      if (typeof x === 'string') return x.localeCompare(y) * state.table.sortDir;
      return ((x ?? -Infinity) - (y ?? -Infinity)) * state.table.sortDir;
    });
  }

  function renderDataset() {
    const list = datasetRows();
    const totalPages = Math.max(1, Math.ceil(list.length / state.table.size));
    state.table.page = Math.min(state.table.page, totalPages);
    const start = (state.table.page - 1) * state.table.size;
    const page = list.slice(start, start + state.table.size);
    $('#datasetCount').textContent = `${S.fmt(list.length)} baris`;
    $('#pageInfo').textContent = `Halaman ${state.table.page} dari ${totalPages}`;
    $('#prevPage').disabled = state.table.page <= 1;
    $('#nextPage').disabled = state.table.page >= totalPages;
    const rowHtml = page.map((row) => `<tr><td>${row.no}</td><td>${e(row.provinsi)}</td><td><b>${e(row.kabkota)}</b></td><td>${e(row.alamat)}</td><td>${e(row.yayasan === '-' ? '—' : row.yayasan)}</td><td>${statusBadge(row.statusOperasional)}</td><td>${flagBadges(row.flags)}</td><td><button type="button" class="row-action" data-detail="${e(row.id)}">Detail</button></td></tr>`).join('');
    $('#dataTable tbody').innerHTML = rowHtml || '<tr><td colspan="8">Tidak ada data yang sesuai.</td></tr>';
    $('#mobileDataCards').innerHTML = page.map((row) => `<article class="mobile-data-card"><div class="mobile-card-top"><div><b>#${row.no} · ${e(row.kabkota)}</b><br><small>${e(row.provinsi)}</small></div>${statusBadge(row.statusOperasional)}</div><p>${e(row.alamat)}</p><small>${e(row.yayasan === '-' ? 'Yayasan belum dicantumkan' : row.yayasan)}</small><div class="mobile-card-tags">${flagBadges(row.flags)}</div><button type="button" class="row-action" data-detail="${e(row.id)}">Buka detail</button></article>`).join('');
    $$('[data-detail]', $('#view-dataset')).forEach((button) => button.addEventListener('click', () => openDetail(button.dataset.detail)));
  }

  function bindDataset() {
    let timer;
    $('#tableSearch').addEventListener('input', (event) => { clearTimeout(timer); timer = setTimeout(() => { state.table.q = event.target.value; state.table.page = 1; renderDataset(); }, 160); });
    $('#tableProvince').addEventListener('change', (event) => { state.table.provinsi = event.target.value; state.table.page = 1; renderDataset(); });
    $('#tableFlag').addEventListener('change', (event) => { state.table.flag = event.target.value; state.table.page = 1; renderDataset(); });
    $('#prevPage').addEventListener('click', () => { state.table.page -= 1; renderDataset(); });
    $('#nextPage').addEventListener('click', () => { state.table.page += 1; renderDataset(); });
    $$('#dataTable th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      if (state.table.sortKey === th.dataset.sort) state.table.sortDir *= -1;
      else { state.table.sortKey = th.dataset.sort; state.table.sortDir = 1; }
      renderDataset();
    }));
  }

  function openDetail(id) {
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    $('#drawerContent').innerHTML = `<div class="drawer-hero"><span class="section-kicker">SPPG #${row.no}</span><h2 id="drawerTitle">${e(row.kabkota)}</h2><p>${e(row.provinsi)}</p></div><dl class="detail-list"><div><dt>Alamat</dt><dd>${e(row.alamat)}</dd></div><div><dt>Yayasan / mitra</dt><dd>${e(row.yayasan === '-' ? 'Belum dicantumkan' : row.yayasan)}</dd></div><div><dt>Status operasional</dt><dd>${statusBadge(row.statusOperasional)}</dd></div><div><dt>Kapasitas porsi / hari</dt><dd>${row.kapasitasPorsi === null ? 'Belum tersedia' : S.fmt(row.kapasitasPorsi)}</dd></div><div><dt>Penerima manfaat</dt><dd>${row.penerimaManfaat === null ? 'Belum tersedia' : S.fmt(row.penerimaManfaat)}</dd></div><div><dt>Presisi lokasi</dt><dd>${row.locationAccuracy === 'alamat_presisi' ? 'Koordinat alamat terverifikasi' : 'Centroid kabupaten/kota'}</dd></div><div><dt>Terakhir diverifikasi</dt><dd>${row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'Belum diverifikasi'}</dd></div></dl><div class="drawer-flags">${flagBadges(row.flags)}</div><p class="drawer-note">Koordinat pada snapshot publik tidak boleh digunakan sebagai petunjuk rute sebelum lokasi presisi diverifikasi.</p>`;
    $('#detailDrawer').classList.add('open');
    $('#drawerBackdrop').classList.add('open');
    $('#detailDrawer').setAttribute('aria-hidden', 'false');
    $('#drawerClose').focus();
  }

  function closeDrawer() {
    $('#detailDrawer').classList.remove('open');
    $('#drawerBackdrop').classList.remove('open');
    $('#detailDrawer').setAttribute('aria-hidden', 'true');
  }

  function bindDrawer() {
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerBackdrop').addEventListener('click', closeDrawer);
    addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDrawer(); });
  }

  function bindDownloads() {
    const download = () => {
      const list = state.view === 'dataset' ? datasetRows() : filteredRows();
      S.downloadCSV(list, `sppg_${list.length}_baris.csv`);
      S.toast(`CSV berisi ${list.length} baris disiapkan.`);
    };
    $('#heroDownload').addEventListener('click', download);
    $('#datasetDownload').addEventListener('click', download);
    $('#downloadAnalysis').addEventListener('click', () => {
      const headers = ['provinsi', 'jumlah_sppg', 'kabkota_tercatat', 'yayasan_unik', 'baris_bercatatan', 'status_operasional', 'indeks_gap_proxy'];
      const csv = [headers.join(','), ...model.provinces.map((p) => [p.name, p.count, p.kab, p.partners, p.flagged, p.operational, p.gap].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','))].join('\n');
      const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'analisis_pemerataan_sppg.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  async function hydrateRemoteData() {
    if (!S.hasBackend() || S.config().dataMode === 'snapshot') return;
    try {
      const [remote, remoteContext] = await Promise.all([S.loadRemoteRows(), S.loadRemoteContext().catch(() => [])]);
      if (remote.length) rows = remote;
      contextRows = remoteContext;
      if (!remote.length && !remoteContext.length) return;
      model = S.derive(rows, D.nationalProvinces, contextRows);
      $('#dataStatus').classList.add('live');
      $('#dataStatus').innerHTML = '<i></i> Data operasional';
      fillControls();
      renderTrust();
      renderOverview();
      renderQuality();
      if (state.view === 'pemerataan') renderEquity();
      if (state.view === 'dataset') renderDataset();
    } catch (error) {
      console.warn('Remote data unavailable, using bundled snapshot:', error.message);
      $('#dataStatus').title = 'Backend tidak dapat dijangkau; snapshot lokal tetap digunakan.';
    }
  }

  function bindMisc() {
    $('#gapSort').addEventListener('change', renderGapList);
    $('#compareA').addEventListener('change', renderComparison);
    $('#compareB').addEventListener('change', renderComparison);
    $('#filterDuplicates').addEventListener('click', () => openDatasetFlag('duplikat_persis'));
    $('#themeToggle').addEventListener('click', () => setTimeout(() => {
      updateMapTiles();
      renderOverviewCharts(filteredRows());
      if (state.view === 'pemerataan') renderEquity();
    }, 0));
  }

  function init() {
    if (!D?.rows?.length) {
      document.body.innerHTML = '<main class="admin-main"><section class="panel admin-login"><h1>Data tidak dapat dimuat</h1><p>Jalankan build ulang atau periksa berkas data.js.</p></section></main>';
      return;
    }
    S.bindThemeButton();
    readUrlState();
    bindNavigation();
    fillControls();
    bindFilters();
    bindDataset();
    bindDrawer();
    bindDownloads();
    bindMisc();
    initMap();
    renderTrust();
    renderOverview();
    renderQuality();
    navigate(state.view, false);
    hydrateRemoteData();
  }

  window.SPPGOpenDetail = openDetail;
  init();
})();
