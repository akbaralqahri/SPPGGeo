# Dashboard Geospasial Sebaran SPPG Indonesia

Dataset bersih + dashboard peta interaktif untuk **315 SPPG** (Satuan Pelayanan
Pemenuhan Gizi — dapur Program Makan Bergizi) di **29 provinsi / 153 kabupaten-kota**.

## Cara pakai

**Paling mudah — file tunggal:** buka `dist/sppg-dashboard-standalone.html`
langsung di browser (dobel-klik). Semua CSS/JS/data sudah menyatu di satu file;
hanya *peta dasar* (tile) yang butuh internet.

**Versi proyek (butuh server kecil karena memuat file terpisah):**

```bash
npm run serve      # buka http://localhost:5177
```

## Skrip

| Perintah | Fungsi |
|---|---|
| `npm run build`    | Parse `data/raw_table.html` → `data/sppg.csv`, `data/sppg.json`, `dist/data.js` |
| `npm run portable` | Rakit `dist/sppg-dashboard-standalone.html` (semua di-inline) |
| `npm run all`      | build + portable |
| `npm run serve`    | Server statis lokal di port 5177 |

## Fitur dashboard

- **KPI ringkas** — total SPPG, cakupan provinsi (29/38), kab/kota, yayasan/mitra, % Jawa vs Luar Jawa.
- **Peta** (Leaflet):
  - **Choropleth** provinsi diwarnai per jumlah SPPG (provinsi pemekaran Papua digabung ke poligon induk).
  - **Titik/marker cluster** per SPPG di centroid kab/kota; titik oranye = ada catatan kualitas data. Klik provinsi untuk memfilter.
- **Grafik** — Top Provinsi, Top Yayasan, Jawa vs Luar Jawa (semua ikut ter-filter).
- **Filter** provinsi · yayasan · pencarian alamat/kab-kota · chip flag kualitas data.
- **Tabel** lengkap, bisa diurutkan, dengan tombol **Export CSV** (mengikuti filter).
- **Panel insight** — konsentrasi yayasan, ketimpangan wilayah + daftar 9 provinsi belum terjangkau, flag kualitas data.

## Skema dataset (`data/sppg.csv` / `sppg.json`)

| Kolom | Keterangan |
|---|---|
| `no` | Nomor urut asli |
| `provinsi`, `kabkota`, `alamat`, `yayasan` | Data sumber (sudah dibersihkan) |
| `pulau` | `Jawa` / `Luar Jawa` |
| `lat`, `lng` | Koordinat centroid kab/kota (disebar sedikit bila banyak dapur di satu kab/kota) |
| `flags` | Catatan kualitas data (dipisah `|`): `yayasan_kosong`, `alamat_minim`, `alamat_luar_provinsi` |

## Catatan penting (keterbatasan data)

- **Koordinat = pusat administratif kab/kota**, bukan lokasi presisi dapur. Sumber hanya
  memuat alamat teks tanpa lat/long, jadi titik akurat di level kabupaten. Untuk presisi
  per-dapur perlu geocoding alamat (butuh internet & verifikasi manual).
- Nama provinsi/kab-kota dari sumber punya artefak OCR (mis. "Diy", "Lhokseuma we") yang
  sudah dinormalkan saat transkripsi ke `data/raw_table.html`.
- **Flag kualitas data** bersifat *penanda untuk ditinjau*, bukan vonis salah:
  - `yayasan_kosong` (4) — kolom yayasan berisi `-`.
  - `alamat_minim` (26) — alamat sangat singkat / hanya nama desa.
  - `alamat_luar_provinsi` (1) — alamat menyebut provinsi lain (indikasi salah tempel; mis. dapur Gresik beralamat Kota Tegal).

## Ide pengembangan lanjutan

- Geocoding presisi per alamat (Nominatim/Google) + verifikasi.
- Kolom tambahan: kapasitas porsi, jumlah penerima manfaat, status operasional, tanggal berdiri.
- Tautkan ke batas **kecamatan/desa** untuk analisis mikro.
- Layer analitik: jarak ke sekolah/posyandu, populasi anak, indeks kemiskinan (overlay demand vs supply).
- Auto-refresh dari sumber data resmi (BGN) bila tersedia API.
