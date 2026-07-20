import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mustExist = [
  'dist/index.html', 'dist/admin.html', 'dist/data.js', 'dist/config.js',
  'dist/assets/app.js', 'dist/assets/admin.js', 'dist/assets/shared.js',
  'dist/assets/styles.css', 'dist/vendor/leaflet.js', 'dist/vendor/chart.umd.min.js',
  'dist/og.png', 'dist/manifest.webmanifest', 'dist/robots.txt',
];
const failures = [];
for (const file of mustExist) if (!fs.existsSync(path.join(root, file))) failures.push(`missing ${file}`);

const rows = JSON.parse(fs.readFileSync(path.join(root, 'data/sppg.json'), 'utf8'));
if (rows.length !== 315) failures.push(`expected 315 rows, got ${rows.length}`);
if (new Set(rows.map((r) => r.id)).size !== rows.length) failures.push('record ids are not unique');
if (rows.some((r) => !Number.isFinite(r.lat) || !Number.isFinite(r.lng))) failures.push('invalid coordinates found');
if (rows.filter((r) => r.flags.includes('duplikat_persis')).length !== 8) failures.push('duplicate flag count should be 8');

for (const page of ['dist/index.html', 'dist/admin.html']) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  if (!html.includes('<html lang="id">')) failures.push(`${page} missing Indonesian language metadata`);
  if (/src\//.test(html)) failures.push(`${page} still references source files`);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (/^(?:https?:|#|data:|mailto:)/.test(reference)) continue;
    const target = reference.split(/[?#]/)[0];
    if (!target || target === 'admin') continue;
    if (!fs.existsSync(path.join(root, 'dist', target))) failures.push(`${page} has broken reference ${reference}`);
  }
}

try { JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')); }
catch { failures.push('vercel.json is not valid JSON'); }
if (fs.existsSync(path.join(root, 'dist', 'data', 'raw_table.html'))) failures.push('raw source table leaked into deploy output');

if (failures.length) {
  console.error('Validation failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Validation passed: 315 records, unique ids, complete deploy output.');
