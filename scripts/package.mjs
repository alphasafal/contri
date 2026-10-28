import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';

/**
 * Zips `dist/` into an installable package.
 *   node scripts/package.mjs            → contri-v<version>.zip (Chrome, Edge, Brave)
 *   node scripts/package.mjs --firefox  → contri-v<version>-firefox.zip (experimental)
 */
const firefox = process.argv.includes('--firefox');
const entries = {};

async function visit(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await visit(path);
    else entries[relative('dist', path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
  }
}

await visit('dist');
// The layout preview is for development only.
delete entries['index.html'];
delete entries['preview.js'];
for (const file of await readdir('licenses'))
  entries[`licenses/${file}`] = new Uint8Array(await readFile(join('licenses', file)));
entries['LICENSE'] = new Uint8Array(await readFile('LICENSE'));
entries['PRIVACY.md'] = new Uint8Array(await readFile('PRIVACY.md'));

if (firefox) {
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  manifest.background = { scripts: ['background.js'], type: 'module' };
  manifest.browser_specific_settings = { gecko: { id: 'contri@alphasafal.github.io', strict_min_version: '128.0' } };
  delete manifest.minimum_chrome_version;
  // Firefox only honours options_ui; without it openOptionsPage() rejects and
  // Settings (and sign-in) are unreachable after the welcome tab.
  manifest.options_ui = { page: manifest.options_page, open_in_tab: true };
  delete manifest.options_page;
  manifest.web_accessible_resources = manifest.web_accessible_resources.map(({ resources, matches }) => ({
    resources,
    matches,
  }));
  entries['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
}

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const name = `contri-v${version}${firefox ? '-firefox' : ''}.zip`;
const bytes = zipSync(entries);
await writeFile(name, bytes);
await writeFile(`${name}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
console.log(`Created ${name} (${Object.keys(entries).length} files, ${(bytes.length / 1024).toFixed(0)} KB)`);
