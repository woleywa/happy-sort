// Copies the game into www/ — what GitHub Pages serves and what Capacitor puts in the iOS/Android apps.
// Usage: node tools/build-web.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
const FILES = ['index.html', 'style.css', 'js', 'sw.js', 'manifest.webmanifest', 'icons'];
// A number per build (the GitHub run number; 0 locally), for live updates in the apps later.
const BUILD = +(process.env.GITHUB_RUN_NUMBER || 0);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of FILES) if (fs.existsSync(path.join(root, f))) fs.cpSync(path.join(root, f), path.join(out, f), { recursive: true });
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ build: BUILD }) + '\n');
console.log(`www/ ready (build ${BUILD})`);
