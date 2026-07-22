(function () {
  'use strict';

  const FIELD_DEFINITIONS = [
    { key: 'no', label: 'Nomor', aliases: ['no', 'nomor', 'number', 'urut'] },
    { key: 'id', label: 'ID stabil', aliases: ['id', 'record id', 'sppg id'] },
    { key: 'provinsi', label: 'Provinsi', required: true, aliases: ['provinsi', 'province', 'propinsi'] },
    { key: 'kabkota', label: 'Kabupaten/Kota', required: true, aliases: ['kabkota', 'kab kota', 'kabupaten kota', 'kabupaten/kota', 'kota', 'kabupaten'] },
    { key: 'alamat', label: 'Alamat', required: true, aliases: ['alamat', 'address', 'alamat dapur', 'lokasi'] },
    { key: 'yayasan', label: 'Yayasan/Mitra', required: true, aliases: ['yayasan', 'mitra', 'yayasan mitra', 'partner'] },
    { key: 'lat', label: 'Lintang', aliases: ['lat', 'latitude', 'lintang'] },
    { key: 'lng', label: 'Bujur', aliases: ['lng', 'lon', 'longitude', 'bujur'] },
    { key: 'statusOperasional', label: 'Status operasional', aliases: ['status', 'status operasional', 'operasional'] },
    { key: 'kapasitasPorsi', label: 'Kapasitas porsi', aliases: ['kapasitas', 'kapasitas porsi', 'porsi', 'kapasitas harian'] },
    { key: 'penerimaManfaat', label: 'Penerima manfaat', aliases: ['penerima manfaat', 'beneficiaries', 'penerima'] },
    { key: 'tanggalBerdiri', label: 'Tanggal berdiri', aliases: ['tanggal berdiri', 'berdiri', 'tanggal operasional'] },
  ];
  const OPERATIONAL_STATUSES = new Set(['belum_diverifikasi', 'persiapan', 'operasional', 'nonaktif']);
  const JAVA = new Set(['Jawa Barat', 'Jawa Tengah', 'Jawa Timur', 'DKI Jakarta', 'DI Yogyakarta', 'Banten']);

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const canonical = (value) => clean(value).toLowerCase().replace(/[_./-]+/g, ' ').replace(/\s+/g, ' ');

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const normalized = String(text || '').replace(/^\ufeff/, '');
    for (let index = 0; index < normalized.length; index += 1) {
      const char = normalized[index];
      if (quoted) {
        if (char === '"' && normalized[index + 1] === '"') { field += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
      else field += char;
    }
    if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
    return rows.filter((cells) => cells.some((cell) => clean(cell)));
  }

  async function parseFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'csv') return parseCSV(await file.text());
    if (extension === 'xlsx') {
      if (!window.SPPGXlsxReader) throw new Error('Pembaca Excel belum tersedia. Muat ulang halaman dan coba lagi.');
      return window.SPPGXlsxReader(file, { trim: true });
    }
    throw new Error('Format tidak didukung. Gunakan .csv atau .xlsx.');
  }

  function suggestMapping(headers) {
    const normalized = headers.map(canonical);
    const mapping = {};
    for (const field of FIELD_DEFINITIONS) {
      const aliases = field.aliases.map(canonical);
      let index = normalized.findIndex((header) => aliases.includes(header));
      if (index < 0) index = normalized.findIndex((header) => aliases.some((alias) => header.includes(alias) || alias.includes(header)));
      mapping[field.key] = index;
    }
    return mapping;
  }

  const numberOrNull = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    const text = String(value).trim();
    const normalized = Number(text.includes('.') && text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text.replace(',', '.'));
    return Number.isFinite(normalized) ? normalized : NaN;
  };

  function formatDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
    const text = clean(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    return text;
  }

  function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 16777619);
    }
    return (value >>> 0).toString(36).padStart(7, '0');
  }

  function stableId(record) {
    const identity = [record.provinsi, record.kabkota, record.alamat, record.yayasan].map(canonical).join('|');
    return `sppg_import_${hash(identity)}`;
  }

  function buildRecords(matrix, mapping, currentRows, nationalProvinces) {
    const existingByNo = new Map(currentRows.map((row) => [Number(row.no), row]));
    const existingById = new Map(currentRows.map((row) => [row.id, row]));
    const coordinateByArea = new Map(currentRows.map((row) => [`${canonical(row.provinsi)}|${canonical(row.kabkota)}`, { lat: row.lat, lng: row.lng }]));
    const maxNo = Math.max(0, ...currentRows.map((row) => Number(row.no) || 0));
    const seenIdentity = new Map();
    const seenNo = new Map();

    return matrix.slice(1).map((cells, rowIndex) => {
      const get = (key) => mapping[key] >= 0 ? cells[mapping[key]] : undefined;
      const rawNo = numberOrNull(get('no'));
      const imported = {
        id: clean(get('id')) || null,
        no: Number.isFinite(rawNo) ? Math.trunc(rawNo) : maxNo + rowIndex + 1,
        provinsi: clean(get('provinsi')),
        kabkota: clean(get('kabkota')),
        alamat: clean(get('alamat')),
        yayasan: clean(get('yayasan')) || '-',
        lat: numberOrNull(get('lat')),
        lng: numberOrNull(get('lng')),
        statusOperasional: canonical(get('statusOperasional')).replaceAll(' ', '_') || undefined,
        kapasitasPorsi: numberOrNull(get('kapasitasPorsi')),
        penerimaManfaat: numberOrNull(get('penerimaManfaat')),
        tanggalBerdiri: formatDate(get('tanggalBerdiri')),
      };
      const matched = (imported.id && existingById.get(imported.id)) || existingByNo.get(imported.no) || null;
      if (!imported.id) imported.id = matched?.id || stableId(imported);
      const areaCoord = coordinateByArea.get(`${canonical(imported.provinsi)}|${canonical(imported.kabkota)}`);
      if (!Number.isFinite(imported.lat) && areaCoord) imported.lat = areaCoord.lat;
      if (!Number.isFinite(imported.lng) && areaCoord) imported.lng = areaCoord.lng;
      imported.pulau = JAVA.has(imported.provinsi) ? 'Jawa' : 'Luar Jawa';
      imported.locationAccuracy = Number.isFinite(numberOrNull(get('lat'))) ? 'alamat_presisi' : 'centroid_kabkota';

      const errors = [];
      const warnings = [];
      for (const field of FIELD_DEFINITIONS.filter((item) => item.required)) if (!clean(imported[field.key])) errors.push(`${field.label} wajib diisi`);
      if (imported.provinsi && !nationalProvinces.includes(imported.provinsi)) errors.push('Provinsi tidak dikenali');
      if (!Number.isFinite(imported.lat) || !Number.isFinite(imported.lng)) errors.push('Koordinat tidak tersedia dan tidak dapat diwarisi dari kab/kota yang sama');
      if (Number.isFinite(imported.lat) && (imported.lat < -11 || imported.lat > 6)) errors.push('Lintang di luar wilayah Indonesia');
      if (Number.isFinite(imported.lng) && (imported.lng < 95 || imported.lng > 142)) errors.push('Bujur di luar wilayah Indonesia');
      if (imported.statusOperasional && !OPERATIONAL_STATUSES.has(imported.statusOperasional)) errors.push('Status operasional tidak valid');
      if (seenNo.has(imported.no)) errors.push(`Nomor duplikat dengan baris ${seenNo.get(imported.no)}`);
      else seenNo.set(imported.no, rowIndex + 2);
      if (Number.isNaN(imported.kapasitasPorsi) || imported.kapasitasPorsi < 0) errors.push('Kapasitas porsi tidak valid');
      if (Number.isNaN(imported.penerimaManfaat) || imported.penerimaManfaat < 0) errors.push('Penerima manfaat tidak valid');
      if (imported.alamat.length < 12) warnings.push('Alamat sangat singkat');
      if (imported.yayasan === '-') warnings.push('Yayasan belum tersedia');
      const identity = [imported.provinsi, imported.kabkota, imported.alamat, imported.yayasan].map(canonical).join('|');
      if (seenIdentity.has(identity)) errors.push(`Duplikat dengan baris ${seenIdentity.get(identity)}`);
      else seenIdentity.set(identity, rowIndex + 2);

      const merged = matched ? { ...matched } : {
        ...imported,
        flags: [],
        geoprov: null,
        statusOperasional: 'belum_diverifikasi',
        kapasitasPorsi: null,
        penerimaManfaat: null,
        tanggalBerdiri: null,
        lastVerifiedAt: null,
        catatanOperasional: null,
        workflowStatus: 'draft',
      };
      for (const [key, value] of Object.entries(imported)) {
        if (value !== undefined && value !== null && value !== '') merged[key] = value;
      }
      if (!matched) merged.workflowStatus = 'draft';

      const compareKeys = ['provinsi', 'kabkota', 'alamat', 'yayasan', 'lat', 'lng', 'statusOperasional', 'kapasitasPorsi', 'penerimaManfaat', 'tanggalBerdiri'];
      const changedFields = matched ? compareKeys.filter((key) => String(matched[key] ?? '') !== String(merged[key] ?? '')) : compareKeys;
      const action = errors.length ? 'invalid' : !matched ? 'added' : changedFields.length ? 'changed' : 'unchanged';
      return { rowNumber: rowIndex + 2, record: merged, matched, errors, warnings, changedFields, action };
    });
  }

  function summarize(items) {
    return {
      total: items.length,
      added: items.filter((item) => item.action === 'added').length,
      changed: items.filter((item) => item.action === 'changed').length,
      unchanged: items.filter((item) => item.action === 'unchanged').length,
      invalid: items.filter((item) => item.action === 'invalid').length,
      warnings: items.filter((item) => item.warnings.length).length,
    };
  }

  window.SPPGImporter = { FIELD_DEFINITIONS, parseCSV, parseFile, suggestMapping, buildRecords, summarize, stableId };
})();
