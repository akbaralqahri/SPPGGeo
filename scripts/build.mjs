// Build clean dataset + dashboard data bundle from raw_table.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(root, ...a);

/* ------------------------------------------------------------------ *
 * 1. Centroid lookup for every unique "Provinsi||Kab/Kota" (153)
 *    Approximate administrative-center coordinates [lat, lng].
 * ------------------------------------------------------------------ */
const COORDS = {
  'Aceh||Aceh Barat': [4.15, 96.13], 'Aceh||Aceh Besar': [5.40, 95.50],
  'Aceh||Aceh Jaya': [4.75, 95.60], 'Aceh||Aceh Selatan': [3.20, 97.18],
  'Aceh||Aceh Tamiang': [4.28, 98.00], 'Aceh||Aceh Tengah': [4.62, 96.85],
  'Aceh||Aceh Tenggara': [3.50, 97.80], 'Aceh||Aceh Timur': [4.85, 97.80],
  'Aceh||Bener Meriah': [4.75, 96.85], 'Aceh||Gayo Lues': [3.98, 97.30],
  'Aceh||Kota Banda Aceh': [5.55, 95.32], 'Aceh||Kota Langsa': [4.47, 97.97],
  'Aceh||Kota Lhokseumawe': [5.18, 97.15], 'Aceh||Kota Sabang': [5.89, 95.32],
  'Aceh||Nagan Raya': [4.15, 96.40], 'Aceh||Pidie Jaya': [5.25, 96.20],
  'Aceh||Pidie': [5.38, 95.96], 'Aceh||Simeulue': [2.48, 96.38],
  'Bali||Denpasar': [-8.67, 115.21],
  'Banten||Kabupaten Serang': [-6.15, 106.15], 'Banten||Kabupaten Tangerang': [-6.20, 106.53],
  'Banten||Kota Serang': [-6.12, 106.15], 'Banten||Kota Tangerang Selatan': [-6.29, 106.72],
  'Banten||Kota Tangerang': [-6.18, 106.63], 'Banten||Serang': [-6.12, 106.16],
  'DI Yogyakarta||Gunungkidul': [-7.97, 110.60], 'DI Yogyakarta||Kulon Progo': [-7.83, 110.16],
  'DI Yogyakarta||Sleman': [-7.70, 110.36], 'DI Yogyakarta||Yogyakarta': [-7.80, 110.37],
  'DKI Jakarta||Jakarta Selatan': [-6.28, 106.81], 'DKI Jakarta||Jakarta Timur': [-6.25, 106.90],
  'Gorontalo||Gorontalo': [0.62, 122.95], 'Gorontalo||Pohuwato': [0.45, 121.85],
  'Jawa Barat||Bandung Barat': [-6.83, 107.48], 'Jawa Barat||Bandung': [-7.02, 107.52],
  'Jawa Barat||Bekasi': [-6.25, 107.15], 'Jawa Barat||Bogor': [-6.55, 106.80],
  'Jawa Barat||Ciamis': [-7.33, 108.35], 'Jawa Barat||Cianjur': [-6.82, 107.14],
  'Jawa Barat||Cirebon': [-6.75, 108.55], 'Jawa Barat||Garut': [-7.22, 107.90],
  'Jawa Barat||Indramayu': [-6.35, 108.32], 'Jawa Barat||Karawang': [-6.30, 107.30],
  'Jawa Barat||Kota Bandung': [-6.92, 107.61], 'Jawa Barat||Kota Banjar': [-7.37, 108.53],
  'Jawa Barat||Kota Bekasi': [-6.24, 106.99], 'Jawa Barat||Kota Depok': [-6.40, 106.82],
  'Jawa Barat||Kota Sukabumi': [-6.92, 106.93], 'Jawa Barat||Kota Tasikmalaya': [-7.33, 108.22],
  'Jawa Barat||Kuningan': [-6.98, 108.48], 'Jawa Barat||Pangandaran': [-7.68, 108.65],
  'Jawa Barat||Purwakarta': [-6.56, 107.44], 'Jawa Barat||Subang': [-6.57, 107.76],
  'Jawa Barat||Sukabumi': [-7.00, 106.80], 'Jawa Barat||Sumedang': [-6.86, 107.92],
  'Jawa Barat||Tasikmalaya': [-7.45, 108.10],
  'Jawa Tengah||Banyumas': [-7.43, 109.24], 'Jawa Tengah||Batang': [-6.91, 109.73],
  'Jawa Tengah||Blora': [-6.97, 111.42], 'Jawa Tengah||Brebes': [-6.90, 108.90],
  'Jawa Tengah||Grobogan': [-7.09, 110.92], 'Jawa Tengah||Jepara': [-6.59, 110.67],
  'Jawa Tengah||Karanganyar': [-7.60, 111.03], 'Jawa Tengah||Kota Semarang': [-6.97, 110.42],
  'Jawa Tengah||Kota Tegal': [-6.87, 109.14], 'Jawa Tengah||Kudus': [-6.80, 110.84],
  'Jawa Tengah||Magelang': [-7.48, 110.22], 'Jawa Tengah||Pati': [-6.75, 111.04],
  'Jawa Tengah||Purbalingga': [-7.39, 109.36], 'Jawa Tengah||Purworejo': [-7.71, 110.01],
  'Jawa Tengah||Sragen': [-7.43, 111.02], 'Jawa Tengah||Surakarta': [-7.57, 110.83],
  'Jawa Timur||Banyuwangi': [-8.22, 114.37], 'Jawa Timur||Bondowoso': [-7.91, 113.82],
  'Jawa Timur||Gresik': [-7.16, 112.65], 'Jawa Timur||Jember': [-8.17, 113.70],
  'Jawa Timur||Kota Kediri': [-7.82, 112.01], 'Jawa Timur||Kota Madiun': [-7.63, 111.52],
  'Jawa Timur||Kota Malang': [-7.98, 112.63], 'Jawa Timur||Kota Surabaya': [-7.26, 112.75],
  'Jawa Timur||Lamongan': [-7.12, 112.42], 'Jawa Timur||Mojokerto': [-7.55, 112.48],
  'Jawa Timur||Pamekasan': [-7.16, 113.48],
  'Kalimantan Barat||Ketapang': [-1.85, 109.98],
  'Kalimantan Selatan||Hulu Sungai Selatan': [-2.79, 115.26], 'Kalimantan Selatan||Hulu Sungai Tengah': [-2.58, 115.38],
  'Kalimantan Selatan||Kota Banjarmasin': [-3.32, 114.59], 'Kalimantan Selatan||Kotabaru': [-3.24, 116.17],
  'Kalimantan Selatan||Tanah Bumbu': [-3.45, 115.95], 'Kalimantan Selatan||Tanah Laut': [-3.80, 114.77],
  'Kalimantan Selatan||Tapin': [-2.92, 115.15],
  'Kepulauan Bangka Belitung||Bangka Barat': [-2.07, 105.17], 'Kepulauan Bangka Belitung||Pangkal Pinang': [-2.13, 106.11],
  'Kepulauan Riau||Batam': [1.08, 104.03], 'Kepulauan Riau||Karimun': [1.00, 103.42],
  'Kepulauan Riau||Kota Batam': [1.08, 104.03],
  'Lampung||Bandar Lampung': [-5.43, 105.26], 'Lampung||Lampung Selatan': [-5.55, 105.55],
  'Lampung||Lampung Timur': [-5.10, 105.57], 'Lampung||Mesuji': [-3.92, 105.58],
  'Lampung||Pesawaran': [-5.42, 105.15], 'Lampung||Pringsewu': [-5.36, 104.97],
  'Lampung||Tulang Bawang Barat': [-4.42, 105.10], 'Lampung||Tulang Bawang': [-4.48, 105.50],
  'Lampung||Way Kanan': [-4.40, 104.55],
  'Maluku||Kota Ambon': [-3.70, 128.18], 'Maluku||Seram Bagian Barat': [-3.20, 128.30],
  'Papua Barat Daya||Kota Sorong': [-0.88, 131.25],
  'Papua Barat||Kaimana': [-3.66, 133.77], 'Papua Barat||Teluk Bintuni': [-2.10, 133.52],
  'Papua Pegunungan||Jayawijaya': [-4.10, 138.95],
  'Papua Tengah||Mimika': [-4.55, 136.89],
  'Papua||Kabupaten Jayapura': [-2.57, 140.52], 'Papua||Kepulauan Yapen': [-1.87, 136.23],
  'Papua||Kota Jayapura': [-2.53, 140.70], 'Papua||Sarmi': [-1.87, 138.75],
  'Riau||Indragiri Hilir': [-0.32, 103.16], 'Riau||Kota Pekanbaru': [0.51, 101.44],
  'Riau||Rokan Hilir': [2.15, 100.82],
  'Sulawesi Barat||Majene': [-3.55, 118.97], 'Sulawesi Barat||Polewali Mandar': [-3.43, 119.35],
  'Sulawesi Selatan||Bantaeng': [-5.48, 119.98], 'Sulawesi Selatan||Bone': [-4.54, 120.33],
  'Sulawesi Selatan||Bulukumba': [-5.55, 120.20], 'Sulawesi Selatan||Gowa': [-5.31, 119.55],
  'Sulawesi Selatan||Kepulauan Selayar': [-6.12, 120.46], 'Sulawesi Selatan||Luwu Timur': [-2.62, 121.09],
  'Sulawesi Selatan||Makassar': [-5.15, 119.43], 'Sulawesi Selatan||Maros': [-5.00, 119.57],
  'Sulawesi Selatan||Pangkajene Dan Kepulauan': [-4.83, 119.55], 'Sulawesi Selatan||Pinrang': [-3.79, 119.65],
  'Sulawesi Selatan||Sidenreng Rappang': [-3.86, 119.98], 'Sulawesi Selatan||Soppeng': [-4.35, 119.89],
  'Sulawesi Selatan||Toraja Utara': [-2.97, 119.90],
  'Sulawesi Tengah||Toli Toli': [1.05, 120.80],
  'Sulawesi Tenggara||Bombana': [-4.60, 121.85], 'Sulawesi Tenggara||Kendari': [-3.97, 122.51],
  'Sulawesi Tenggara||Kolaka Timur': [-3.95, 121.85], 'Sulawesi Tenggara||Muna Barat': [-4.85, 122.55],
  'Sulawesi Utara||Bolaang Mongondow Utara': [0.80, 123.50], 'Sulawesi Utara||Bolaang Mongondow': [0.75, 124.10],
  'Sulawesi Utara||Kotamobagu': [0.73, 124.32],
  'Sumatera Barat||Kota Payakumbuh': [-0.22, 100.63], 'Sumatera Barat||Pesisir Selatan': [-1.35, 100.58],
  'Sumatera Selatan||Banyuasin': [-2.75, 104.37], 'Sumatera Selatan||Ogan Komering Ilir': [-3.39, 104.83],
  'Sumatera Selatan||Ogan Komering Ulu': [-4.13, 104.17], 'Sumatera Selatan||Palembang': [-2.98, 104.76],
  'Sumatera Utara||Asahan': [2.98, 99.62], 'Sumatera Utara||Deli Serdang': [3.55, 98.87],
  'Sumatera Utara||Kota Binjai': [3.60, 98.49], 'Sumatera Utara||Kota Medan': [3.59, 98.67],
  'Sumatera Utara||Nias': [1.28, 97.60],
};

// dataset province -> GeoJSON "state" (UPPERCASE). New split provinces merged onto parents.
const PROV_TO_GEO = {
  'Aceh': 'ACEH', 'Bali': 'BALI', 'Banten': 'BANTEN',
  'DI Yogyakarta': 'DAERAH ISTIMEWA YOGYAKARTA', 'DKI Jakarta': 'DKI JAKARTA',
  'Gorontalo': 'GORONTALO', 'Jawa Barat': 'JAWA BARAT', 'Jawa Tengah': 'JAWA TENGAH',
  'Jawa Timur': 'JAWA TIMUR', 'Kalimantan Barat': 'KALIMANTAN BARAT',
  'Kalimantan Selatan': 'KALIMANTAN SELATAN', 'Kepulauan Bangka Belitung': 'KEPULAUAN BANGKA BELITUNG',
  'Kepulauan Riau': 'KEPULAUAN RIAU', 'Lampung': 'LAMPUNG', 'Maluku': 'MALUKU',
  'Papua': 'PAPUA', 'Papua Barat': 'PAPUA BARAT', 'Papua Barat Daya': 'PAPUA BARAT',
  'Papua Pegunungan': 'PAPUA', 'Papua Tengah': 'PAPUA', 'Riau': 'RIAU',
  'Sulawesi Barat': 'SULAWESI BARAT', 'Sulawesi Selatan': 'SULAWESI SELATAN',
  'Sulawesi Tengah': 'SULAWESI TENGAH', 'Sulawesi Tenggara': 'SULAWESI TENGGARA',
  'Sulawesi Utara': 'SULAWESI UTARA', 'Sumatera Barat': 'SUMATERA BARAT',
  'Sumatera Selatan': 'SUMATERA SELATAN', 'Sumatera Utara': 'SUMATERA UTARA',
};

const JAWA = new Set(['Jawa Barat', 'Jawa Tengah', 'Jawa Timur', 'DKI Jakarta', 'DI Yogyakarta', 'Banten']);

// province signal tokens for "wrong region" detection (token -> canonical province)
const PROV_TOKENS = {
  'jawa tengah': 'Jawa Tengah', 'jateng': 'Jawa Tengah',
  'jawa timur': 'Jawa Timur', 'jatim': 'Jawa Timur',
  'jawa barat': 'Jawa Barat', 'jabar': 'Jawa Barat',
  'banten': 'Banten', 'lampung': 'Lampung', 'bali': 'Bali',
  'kepri': 'Kepulauan Riau', 'sumut': 'Sumatera Utara', 'sumbar': 'Sumatera Barat',
  'sumsel': 'Sumatera Selatan', 'kalsel': 'Kalimantan Selatan', 'kalbar': 'Kalimantan Barat',
  'sulsel': 'Sulawesi Selatan', 'sulut': 'Sulawesi Utara', 'sulteng': 'Sulawesi Tengah',
  'sultra': 'Sulawesi Tenggara',
};

/* ------------------------------------------------------------------ *
 * 2. Parse raw table
 * ------------------------------------------------------------------ */
const raw = fs.readFileSync(P('data', 'raw_table.html'), 'utf8');
const rows = [];
for (const m of raw.matchAll(/<tr>(.*?)<\/tr>/gs)) {
  const tds = [...m[1].matchAll(/<td>(.*?)<\/td>/gs)].map((x) => x[1].replace(/\s+/g, ' ').trim());
  if (tds.length < 5) continue;
  rows.push({ no: Number(tds[0]), provinsi: tds[1], kabkota: tds[2], alamat: tds[3], yayasan: tds[4] });
}

/* ------------------------------------------------------------------ *
 * 3. Enrich: coords (with phyllotaxis jitter for same kab/kota), flags
 * ------------------------------------------------------------------ */
const groupIdx = {};
const missingCoords = new Set();
for (const r of rows) {
  const key = `${r.provinsi}||${r.kabkota}`;
  const base = COORDS[key];
  if (!base) missingCoords.add(key);
  const i = (groupIdx[key] = (groupIdx[key] || 0));
  groupIdx[key]++;
  // deterministic golden-angle spread so multiple dapur in one kab/kota don't overlap
  const angle = i * 2.399963229728653;
  const radius = i === 0 ? 0 : 0.018 * Math.sqrt(i);
  const [lat, lng] = base || [-2.5, 118];
  r.lat = +(lat + radius * Math.cos(angle)).toFixed(5);
  r.lng = +(lng + radius * Math.sin(angle)).toFixed(5);
  r.geoprov = PROV_TO_GEO[r.provinsi] || null;
  r.pulau = JAWA.has(r.provinsi) ? 'Jawa' : 'Luar Jawa';
  r.hasCoord = !!base;

  // data-quality flags
  const flags = [];
  if (!r.yayasan || r.yayasan === '-') flags.push('yayasan_kosong');
  const words = r.alamat.split(/\s+/).filter(Boolean);
  if (r.alamat.length < 12 || words.length <= 1) flags.push('alamat_minim');
  const low = ' ' + r.alamat.toLowerCase() + ' ';
  for (const [tok, prov] of Object.entries(PROV_TOKENS)) {
    if (prov === r.provinsi) continue;
    const re = new RegExp(`(^|[^a-z])${tok.replace(/ /g, '\\s+')}([^a-z]|$)`, 'i');
    if (re.test(low)) { flags.push('alamat_luar_provinsi'); break; }
  }
  r.flags = flags;
}

if (missingCoords.size) {
  console.log('WARNING missing coords for:', [...missingCoords]);
}

/* ------------------------------------------------------------------ *
 * 4. Aggregations
 * ------------------------------------------------------------------ */
const provinceAgg = {};
for (const r of rows) {
  const p = (provinceAgg[r.provinsi] ||= { provinsi: r.provinsi, count: 0, kabkota: new Set(), yayasan: new Set(), pulau: r.pulau });
  p.count++; p.kabkota.add(r.kabkota); p.yayasan.add(r.yayasan);
}
const provinceList = Object.values(provinceAgg)
  .map((p) => ({ provinsi: p.provinsi, pulau: p.pulau, count: p.count, kabkota: p.kabkota.size, yayasan: p.yayasan.size }))
  .sort((a, b) => b.count - a.count);

// choropleth counts keyed by GeoJSON state (with Papua merges)
const geoCount = {};
for (const r of rows) if (r.geoprov) geoCount[r.geoprov] = (geoCount[r.geoprov] || 0) + 1;

const yayasanAgg = {};
for (const r of rows) {
  const name = r.yayasan === '-' ? '(Tanpa Yayasan)' : r.yayasan;
  const y = (yayasanAgg[name] ||= { yayasan: name, count: 0, provinsi: new Set(), kabkota: new Set() });
  y.count++; y.provinsi.add(r.provinsi); y.kabkota.add(`${r.provinsi}|${r.kabkota}`);
}
const yayasanList = Object.values(yayasanAgg)
  .map((y) => ({ yayasan: y.yayasan, count: y.count, provinsi: y.provinsi.size, kabkota: y.kabkota.size }))
  .sort((a, b) => b.count - a.count || a.yayasan.localeCompare(b.yayasan));

const kabkotaAgg = {};
for (const r of rows) {
  const key = `${r.provinsi}|${r.kabkota}`;
  const k = (kabkotaAgg[key] ||= { provinsi: r.provinsi, kabkota: r.kabkota, count: 0 });
  k.count++;
}
const kabkotaList = Object.values(kabkotaAgg).sort((a, b) => b.count - a.count);

const NASIONAL_38 = [
  'Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Riau', 'Jambi', 'Sumatera Selatan', 'Bengkulu',
  'Lampung', 'Kepulauan Bangka Belitung', 'Kepulauan Riau', 'DKI Jakarta', 'Jawa Barat', 'Jawa Tengah',
  'DI Yogyakarta', 'Jawa Timur', 'Banten', 'Bali', 'Nusa Tenggara Barat', 'Nusa Tenggara Timur',
  'Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan', 'Kalimantan Timur', 'Kalimantan Utara',
  'Sulawesi Utara', 'Sulawesi Tengah', 'Sulawesi Selatan', 'Sulawesi Tenggara', 'Gorontalo', 'Sulawesi Barat',
  'Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Selatan', 'Papua Tengah', 'Papua Pegunungan', 'Papua Barat Daya',
];
const covered = new Set(provinceList.map((p) => p.provinsi));
const uncoveredProvinces = NASIONAL_38.filter((p) => !covered.has(p));

const jawaCount = rows.filter((r) => r.pulau === 'Jawa').length;
const meta = {
  generatedFrom: 'raw_table.html',
  totalSPPG: rows.length,
  totalProvinsi: provinceList.length,
  totalKabkota: kabkotaList.length,
  totalYayasan: new Set(rows.map((r) => (r.yayasan === '-' ? '(Tanpa Yayasan)' : r.yayasan))).size,
  jawa: jawaCount,
  luarJawa: rows.length - jawaCount,
  flagged: {
    yayasan_kosong: rows.filter((r) => r.flags.includes('yayasan_kosong')).length,
    alamat_minim: rows.filter((r) => r.flags.includes('alamat_minim')).length,
    alamat_luar_provinsi: rows.filter((r) => r.flags.includes('alamat_luar_provinsi')).length,
  },
  provinsiNasional: 38,
  provinsiTanpaSPPGjumlah: 38 - provinceList.length,
  provinsiTanpaSPPG: uncoveredProvinces,
};

/* ------------------------------------------------------------------ *
 * 5. Outputs
 * ------------------------------------------------------------------ */
// CSV
const csvCols = ['no', 'provinsi', 'kabkota', 'alamat', 'yayasan', 'pulau', 'lat', 'lng', 'flags'];
const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = [csvCols.join(',')]
  .concat(rows.map((r) => csvCols.map((c) => esc(c === 'flags' ? r.flags.join('|') : r[c])).join(',')))
  .join('\n');
fs.writeFileSync(P('data', 'sppg.csv'), '﻿' + csv);
fs.writeFileSync(P('data', 'sppg.json'), JSON.stringify(rows, null, 2));

// Dashboard bundle (assigns a global so it works over file:// without fetch/CORS)
const geo = JSON.parse(fs.readFileSync(P('data', 'id-provinces-34.geojson'), 'utf8'));
const bundle = { meta, rows, provinceList, yayasanList, kabkotaList, geoCount, geojson: geo };
fs.writeFileSync(P('dist', 'data.js'), 'window.SPPG_DATA = ' + JSON.stringify(bundle) + ';\n');

console.log('Rows:', rows.length, '| Provinsi:', provinceList.length, '| Kab/kota:', kabkotaList.length, '| Yayasan:', meta.totalYayasan);
console.log('Missing coords:', missingCoords.size);
console.log('Flags:', JSON.stringify(meta.flagged));
console.log('Top yayasan:', yayasanList.slice(0, 5).map((y) => `${y.yayasan} (${y.count})`).join(', '));
console.log('Wrote data/sppg.csv, data/sppg.json, dist/data.js');
