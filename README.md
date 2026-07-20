# SPPG Insight Indonesia

Portal pemerataan, kualitas data, dan operasional SPPG Indonesia. Versi 2 tetap
dapat berjalan sebagai snapshot statis, tetapi bisa dihubungkan ke Supabase
untuk status operasional, kapasitas, penerima manfaat, koordinat presisi, data
konteks provinsi, autentikasi admin, dan audit perubahan.

## Fitur

### Dashboard publik

- Ringkasan nasional dengan KPI yang konsisten terhadap filter.
- Peta Leaflet dengan marker cluster dan penjelasan presisi lokasi.
- Filter provinsi, mitra, status, dan pencarian; state filter dapat dibagikan lewat URL.
- Detail setiap SPPG dalam side drawer.
- Tampilan desktop, tablet, dan mobile; tabel berubah menjadi kartu pada layar kecil.
- Tema terang/gelap dan elemen interaktif yang dapat digunakan dengan keyboard.

### Pemerataan dan demand gap

- Konsentrasi provinsi, share top 3, dan provinsi tanpa cakupan.
- Indeks gap proxy ketika data kebutuhan belum tersedia.
- Demand gap berbobot otomatis ketika populasi sasaran atau target porsi diisi.
- Perbandingan dua provinsi dan ekspor ringkasan analitik.
- Label metodologi yang membedakan proxy dari metrik berbobot.

### Kualitas data

- Skor kesiapan berdasarkan kelengkapan, konsistensi, keunikan, kualitas alamat,
  dan presisi lokasi.
- Flag `yayasan_kosong`, `alamat_minim`, `alamat_luar_provinsi`, dan
  `duplikat_persis`.
- Snapshot saat ini memiliki 4 pasangan duplikat persis atau 8 baris terlibat.
- Catatan bahwa koordinat snapshot adalah centroid kabupaten/kota, bukan lokasi
  presisi dapur.

### Portal admin opsional

- Login email/password melalui Supabase Auth.
- Otorisasi admin menggunakan Row Level Security.
- Pembaruan status, kapasitas, penerima manfaat, tanggal berdiri, lokasi presisi,
  dan catatan verifikasi.
- Data konteks per provinsi: populasi sasaran, target porsi, sekolah, stunting,
  kemiskinan, periode, dan sumber.
- Audit perubahan tersimpan di `sppg_audit_log`.
- Dashboard publik otomatis memakai database dan kembali ke snapshot lokal bila
  backend tidak tersedia.

## Menjalankan lokal

```bash
npm run build
npm run serve
```

Buka `http://localhost:5177`. Portal admin tersedia di
`http://localhost:5177/admin`.

Perintah lain:

| Perintah | Fungsi |
|---|---|
| `npm run build` | Bersihkan data dan buat website produksi di `dist/` |
| `npm run serve` | Sajikan folder produksi di port 5177 |
| `npm run portable` | Buat dashboard publik file tunggal |
| `npm run validate` | Validasi data, ID, koordinat, dan output deploy |
| `npm run all` | Build, portable, dan validasi |

## Mengaktifkan backend

1. Buat project Supabase.
2. Jalankan `supabase/schema.sql` di SQL Editor.
3. Buat pengguna melalui Authentication > Users.
4. Tambahkan UUID pengguna tersebut ke `public.admin_users` dengan contoh
   `INSERT` pada bagian akhir schema.
5. Salin `.env.example` menjadi konfigurasi lingkungan lokal atau isi variabel
   yang sama di Vercel.
6. Build ulang, masuk ke `/admin`, lalu pilih **Sinkronkan snapshot awal**.

`SUPABASE_ANON_KEY` memang dikirim ke browser. Keamanan data tulis tidak
bergantung pada kerahasiaan key tersebut, tetapi pada Auth dan kebijakan RLS di
schema. Jangan pernah menaruh service-role key pada frontend atau Vercel env
yang disuntikkan ke `config.js`.

## Deploy ke Vercel

Repository sudah memiliki `vercel.json` dengan:

- Build Command: `npm run build`
- Output Directory: `dist`
- clean URLs
- security headers dan Content Security Policy
- caching terpisah untuk aset, data, dan konfigurasi

Hubungkan repository ke Vercel lalu isi variabel dari `.env.example`. Tanpa
Supabase, deployment tetap berfungsi penuh dalam mode snapshot publik; halaman
admin menampilkan petunjuk aktivasi backend.

## Struktur penting

```text
index.html                 halaman publik
admin.html                 portal operasional
src/                       CSS dan JavaScript sumber
data/                      tabel mentah dan dataset bersih
scripts/build.mjs          pipeline data + output deploy
supabase/schema.sql        database, RLS, dan audit
dist/                      output produksi untuk Vercel
vercel.json                konfigurasi hosting
```

## Keterbatasan analisis

- Koordinat bawaan adalah centroid kabupaten/kota dan beberapa titik digeser
  secara visual agar tidak bertumpuk.
- Indeks gap tanpa data konteks merupakan proxy pemerataan terhadap rata-rata
  38 provinsi, bukan estimasi kebutuhan gizi.
- Isi tanggal snapshot dan sumber resmi melalui `DATASET_AS_OF`,
  `DATA_SOURCE_NAME`, dan `DATA_SOURCE_URL` sebelum publikasi final.
- Verifikasi duplikat terhadap sumber primer sebelum menghapus baris; pasangan
  identik belum tentu duplikasi administratif.
