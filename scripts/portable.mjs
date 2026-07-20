// Build a single self-contained HTML (all CSS/JS/data inlined) for easy sharing.
// Only external dependency left is the online map-tile layer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(root, ...a);
const read = (p) => fs.readFileSync(P(p), 'utf8');

let html = read('index.html');

// inline <link rel="stylesheet" href="vendor/x.css">
html = html.replace(/<link rel="stylesheet" href="(vendor\/[^"]+)"\s*\/>/g,
  (_, href) => `<style>\n${read(href)}\n</style>`);

// inline <script src="vendor/x.js"></script> and dist/data.js
html = html.replace(/<script src="((?:vendor|dist)\/[^"]+)"><\/script>/g,
  (_, src) => `<script>\n${read(src)}\n</script>`);

fs.mkdirSync(P('dist'), { recursive: true });
fs.writeFileSync(P('dist', 'sppg-dashboard-standalone.html'), html);
const kb = (fs.statSync(P('dist', 'sppg-dashboard-standalone.html')).size / 1024).toFixed(0);
console.log(`Wrote dist/sppg-dashboard-standalone.html (${kb} KB) — single portable file.`);
