(function () {
  'use strict';

  const FLAG_LABELS = {
    yayasan_kosong: 'Yayasan kosong',
    alamat_minim: 'Alamat minim',
    alamat_luar_provinsi: 'Beda wilayah',
    duplikat_persis: 'Duplikat persis',
  };
  const FLAG_DESCRIPTIONS = {
    yayasan_kosong: 'Nama yayasan belum tersedia pada sumber.',
    alamat_minim: 'Alamat terlalu singkat untuk diverifikasi atau digeocode presisi.',
    alamat_luar_provinsi: 'Alamat menyebut provinsi yang berbeda dari kolom wilayah.',
    duplikat_persis: 'Provinsi, kab/kota, alamat, dan yayasan identik dengan baris lain.',
  };
  const STATUS_LABELS = {
    operasional: 'Operasional',
    persiapan: 'Persiapan',
    nonaktif: 'Nonaktif',
    belum_diverifikasi: 'Belum diverifikasi',
  };
  const NATIONAL_PROVINCES = [
    'Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Riau', 'Jambi', 'Sumatera Selatan', 'Bengkulu',
    'Lampung', 'Kepulauan Bangka Belitung', 'Kepulauan Riau', 'DKI Jakarta', 'Jawa Barat', 'Jawa Tengah',
    'DI Yogyakarta', 'Jawa Timur', 'Banten', 'Bali', 'Nusa Tenggara Barat', 'Nusa Tenggara Timur',
    'Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan', 'Kalimantan Timur', 'Kalimantan Utara',
    'Sulawesi Utara', 'Sulawesi Tengah', 'Sulawesi Selatan', 'Sulawesi Tenggara', 'Gorontalo', 'Sulawesi Barat',
    'Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Selatan', 'Papua Tengah', 'Papua Pegunungan', 'Papua Barat Daya',
  ];

  const escapeHTML = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const fmt = (value, digits = 0) => Number(value || 0).toLocaleString('id-ID', { maximumFractionDigits: digits });
  const pct = (value, total, digits = 0) => total ? `${(value / total * 100).toLocaleString('id-ID', { maximumFractionDigits: digits })}%` : '0%';
  const compact = (value) => Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
  const safeNumber = (value) => value === null || value === '' || value === undefined ? null : Number(value);

  function normalizeRecord(row) {
    const flags = Array.isArray(row.flags) ? row.flags : String(row.flags || '').split('|').filter(Boolean);
    return {
      id: row.id,
      no: Number(row.no),
      provinsi: row.provinsi || '',
      kabkota: row.kabkota || row.kab_kota || '',
      alamat: row.alamat || '',
      yayasan: row.yayasan || '-',
      pulau: row.pulau || '',
      lat: Number(row.lat),
      lng: Number(row.lng),
      geoprov: row.geoprov || null,
      hasCoord: row.hasCoord ?? row.has_coord ?? true,
      locationAccuracy: row.locationAccuracy || row.location_accuracy || 'centroid_kabkota',
      flags,
      statusOperasional: row.statusOperasional || row.status_operasional || 'belum_diverifikasi',
      kapasitasPorsi: safeNumber(row.kapasitasPorsi ?? row.kapasitas_porsi),
      penerimaManfaat: safeNumber(row.penerimaManfaat ?? row.penerima_manfaat),
      tanggalBerdiri: row.tanggalBerdiri || row.tanggal_berdiri || null,
      lastVerifiedAt: row.lastVerifiedAt || row.last_verified_at || null,
      catatanOperasional: row.catatanOperasional || row.catatan_operasional || null,
      workflowStatus: row.workflowStatus || row.workflow_status || 'published',
      assignedTo: row.assignedTo || row.assigned_to || null,
      reviewNotes: row.reviewNotes || row.review_notes || null,
      verifiedBy: row.verifiedBy || row.verified_by || null,
      verifiedAt: row.verifiedAt || row.verified_at || null,
      approvedBy: row.approvedBy || row.approved_by || null,
      approvedAt: row.approvedAt || row.approved_at || null,
      publishedAt: row.publishedAt || row.published_at || null,
      version: Number(row.version || 1),
    };
  }

  function normalizeContext(row) {
    return {
      provinsi: row.provinsi,
      populationTarget: safeNumber(row.populationTarget ?? row.population_target),
      schoolCount: safeNumber(row.schoolCount ?? row.school_count),
      stuntingRate: safeNumber(row.stuntingRate ?? row.stunting_rate),
      povertyRate: safeNumber(row.povertyRate ?? row.poverty_rate),
      targetPortions: safeNumber(row.targetPortions ?? row.target_portions),
      sourceName: row.sourceName || row.source_name || null,
      sourceUrl: row.sourceUrl || row.source_url || null,
      period: row.period || null,
    };
  }

  function derive(rows, nationalProvinces = NATIONAL_PROVINCES, contextRows = []) {
    const total = rows.length;
    const provinceMap = Object.fromEntries(nationalProvinces.map((name) => [name, {
      name, count: 0, kab: new Set(), partners: new Set(), flagged: 0, operational: 0,
      capacity: 0, capacityKnown: 0, beneficiaries: 0, beneficiariesKnown: 0,
    }]));
    const partnerMap = {};
    const exactGroups = {};
    let jawa = 0;
    let flagged = 0;
    let operational = 0;
    let capacity = 0;
    let capacityKnown = 0;
    let beneficiaries = 0;
    let beneficiariesKnown = 0;

    for (const row of rows) {
      const p = provinceMap[row.provinsi] ||= { name: row.provinsi, count: 0, kab: new Set(), partners: new Set(), flagged: 0, operational: 0, capacity: 0, capacityKnown: 0, beneficiaries: 0, beneficiariesKnown: 0 };
      p.count += 1;
      p.kab.add(row.kabkota);
      p.partners.add(row.yayasan === '-' ? '(Tanpa yayasan)' : row.yayasan);
      if (row.flags.length) { p.flagged += 1; flagged += 1; }
      if (row.statusOperasional === 'operasional') { p.operational += 1; operational += 1; }
      if (row.kapasitasPorsi !== null) { p.capacity += row.kapasitasPorsi; p.capacityKnown += 1; capacity += row.kapasitasPorsi; capacityKnown += 1; }
      if (row.penerimaManfaat !== null) { p.beneficiaries += row.penerimaManfaat; p.beneficiariesKnown += 1; beneficiaries += row.penerimaManfaat; beneficiariesKnown += 1; }
      if (row.pulau === 'Jawa') jawa += 1;

      const partner = row.yayasan === '-' ? '(Tanpa yayasan)' : row.yayasan;
      const y = partnerMap[partner] ||= { name: partner, count: 0, provinces: new Set(), kab: new Set() };
      y.count += 1; y.provinces.add(row.provinsi); y.kab.add(`${row.provinsi}|${row.kabkota}`);

      const dupKey = [row.provinsi, row.kabkota, row.alamat, row.yayasan].join('|').toLowerCase();
      (exactGroups[dupKey] ||= []).push(row);
    }

    const ideal = total / nationalProvinces.length;
    const context = contextRows.map(normalizeContext);
    const contextMap = Object.fromEntries(context.map((item) => [item.provinsi, item]));
    const totalDemandWeight = context.reduce((sum, item) => sum + (item.targetPortions || item.populationTarget || 0), 0);
    const provinces = Object.values(provinceMap).map((p) => ({
      name: p.name,
      count: p.count,
      kab: p.kab.size,
      partners: p.partners.size,
      flagged: p.flagged,
      operational: p.operational,
      capacity: p.capacity,
      capacityKnown: p.capacityKnown,
      beneficiaries: p.beneficiaries,
      beneficiariesKnown: p.beneficiariesKnown,
      share: total ? p.count / total : 0,
      context: contextMap[p.name] || null,
      gap: (() => {
        const item = contextMap[p.name];
        const demand = item?.targetPortions || item?.populationTarget || 0;
        if (item?.targetPortions && p.capacityKnown) return Math.round(Math.max(0, (item.targetPortions - p.capacity) / item.targetPortions * 100));
        if (demand && totalDemandWeight) {
          const expected = total * demand / totalDemandWeight;
          return expected ? Math.round(Math.max(0, 100 - Math.min(100, p.count / expected * 100))) : 100;
        }
        return ideal ? Math.round(Math.max(0, 100 - Math.min(100, p.count / ideal * 100))) : 100;
      })(),
      gapMode: (() => {
        const item = contextMap[p.name];
        const demand = item?.targetPortions || item?.populationTarget || 0;
        if (item?.targetPortions && p.capacityKnown) return 'capacity';
        if (demand && totalDemandWeight) return 'weighted';
        return 'proxy';
      })(),
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const partners = Object.values(partnerMap).map((p) => ({ name: p.name, count: p.count, provinces: p.provinces.size, kab: p.kab.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const duplicateGroups = Object.values(exactGroups).filter((group) => group.length > 1);
    const flagCounts = Object.fromEntries(Object.keys(FLAG_LABELS).map((flag) => [flag, rows.filter((r) => r.flags.includes(flag)).length]));
    const uniqueProvince = provinces.filter((p) => p.count > 0).length;
    const uniqueKab = new Set(rows.map((r) => `${r.provinsi}|${r.kabkota}`)).size;
    const uniquePartners = new Set(rows.map((r) => r.yayasan === '-' ? '(Tanpa yayasan)' : r.yayasan)).size;
    const duplicateExtras = duplicateGroups.reduce((sum, group) => sum + group.length - 1, 0);
    const completeness = total ? Math.round((1 - flagCounts.yayasan_kosong / total) * 100) : 0;
    const consistency = total ? Math.round((1 - flagCounts.alamat_luar_provinsi / total) * 100) : 0;
    const uniqueness = total ? Math.round((1 - duplicateExtras / total) * 100) : 0;
    const addressQuality = total ? Math.round((1 - flagCounts.alamat_minim / total) * 100) : 0;
    const precision = total ? Math.round(rows.filter((r) => r.locationAccuracy === 'alamat_presisi').length / total * 100) : 0;
    const operationsKnown = total ? Math.round(rows.filter((r) => r.statusOperasional !== 'belum_diverifikasi').length / total * 100) : 0;
    const qualityScore = Math.round(completeness * .22 + consistency * .18 + uniqueness * .22 + addressQuality * .18 + Math.max(45, precision) * .2);
    const hhi = provinces.reduce((sum, p) => sum + p.share ** 2, 0);

    return {
      total, provinces, partners, duplicateGroups, flagCounts, uniqueProvince, uniqueKab, uniquePartners,
      jawa, luarJawa: total - jawa, flagged, operational, capacity, capacityKnown, beneficiaries,
      beneficiariesKnown, qualityScore, completeness, consistency, uniqueness, addressQuality, precision,
      operationsKnown, hhi, uncovered: provinces.filter((p) => !p.count), ideal,
      context, contextCoverage: context.filter((item) => item.targetPortions || item.populationTarget).length,
    };
  }

  function toDatabaseRecord(row) {
    return {
      id: row.id,
      no: row.no,
      provinsi: row.provinsi,
      kabkota: row.kabkota,
      alamat: row.alamat,
      yayasan: row.yayasan,
      pulau: row.pulau,
      lat: row.lat,
      lng: row.lng,
      geoprov: row.geoprov,
      location_accuracy: row.locationAccuracy,
      flags: row.flags,
      status_operasional: row.statusOperasional,
      kapasitas_porsi: row.kapasitasPorsi,
      penerima_manfaat: row.penerimaManfaat,
      tanggal_berdiri: row.tanggalBerdiri,
      last_verified_at: row.lastVerifiedAt,
      catatan_operasional: row.catatanOperasional,
      workflow_status: row.workflowStatus || 'published',
      assigned_to: row.assignedTo || null,
      review_notes: row.reviewNotes || null,
      verified_by: row.verifiedBy || null,
      verified_at: row.verifiedAt || null,
      approved_by: row.approvedBy || null,
      approved_at: row.approvedAt || null,
      published_at: row.publishedAt || null,
      version: row.version || 1,
    };
  }

  const config = () => window.SPPG_CONFIG || {};
  const hasBackend = () => Boolean(config().supabaseUrl && config().supabaseAnonKey);

  async function api(path, options = {}) {
    if (!hasBackend()) throw new Error('Backend belum dikonfigurasi.');
    const { method = 'GET', token = config().supabaseAnonKey, body, prefer, headers = {} } = options;
    const response = await fetch(`${config().supabaseUrl}${path}`, {
      method,
      headers: {
        apikey: config().supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.msg || payload.message || payload.error_description || payload.error || `Permintaan gagal (${response.status}).`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function loadRemoteRows(token) {
    const resource = token ? 'sppg_records' : 'sppg_public';
    const rows = await api(`/rest/v1/${resource}?select=*&order=no.asc`, { token });
    return (rows || []).map(normalizeRecord);
  }

  async function loadRemoteContext(token) {
    const rows = await api('/rest/v1/province_context?select=*&order=provinsi.asc', { token });
    return (rows || []).map(normalizeContext);
  }

  function applyTheme() {
    const saved = localStorage.getItem('sppg-theme');
    const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    return theme;
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('sppg-theme', next);
    return next;
  }
  function bindThemeButton() {
    applyTheme();
    document.querySelector('#themeToggle')?.addEventListener('click', () => toggleTheme());
  }

  let toastTimer;
  function toast(message) {
    const node = document.querySelector('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  function downloadCSV(rows, filename = 'sppg.csv') {
    const columns = ['no', 'provinsi', 'kabkota', 'alamat', 'yayasan', 'pulau', 'lat', 'lng', 'statusOperasional', 'kapasitasPorsi', 'penerimaManfaat', 'flags'];
    const esc = (value) => {
      const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const csv = [columns.join(','), ...rows.map((row) => columns.map((column) => esc(row[column])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.SPPGShared = {
    FLAG_LABELS, FLAG_DESCRIPTIONS, STATUS_LABELS, NATIONAL_PROVINCES,
    escapeHTML, fmt, pct, compact, normalizeRecord, normalizeContext, derive, toDatabaseRecord,
    config, hasBackend, api, loadRemoteRows, loadRemoteContext, bindThemeButton, toggleTheme, toast, downloadCSV,
  };
})();
