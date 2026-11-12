import { Resvg } from '@resvg/resvg-js';
import { writeFile, copyFile } from 'node:fs/promises';

/**
 * Draws the contri. symbol (an arrow rising out of a circle, as on the website) onto
 * the CONTRI glass tile and writes the toolbar/store icons. Small sizes get heavier
 * strokes so the mark stays legible at 16 px.
 */
function icon(size) {
  const small = size <= 32;
  const ring = small ? 8 : 5.5;
  const arrow = small ? 11 : 7.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#5f7d77"/><stop offset="1" stop-color="#1d3934"/></linearGradient></defs>
  <rect x="3" y="3" width="122" height="122" rx="32" fill="url(#g)" stroke="#a9bdb4" stroke-width="2"/>
  <g transform="translate(19 19) scale(.9)">
    <circle cx="50" cy="50" r="44" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="${ring}"/>
    <path d="M30 81 74 15M55 20.5l19-5.5 2 19" fill="none" stroke="#fff" stroke-width="${arrow}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

for (const size of [16, 32, 48, 128])
  await writeFile(
    `public/icon-${size}.png`,
    new Resvg(icon(size), { fitTo: { mode: 'width', value: size } }).render().asPng(),
  );
await copyFile('public/icon-32.png', 'website/dist/assets/icon-32.png');
// The Claude plugin's listing icon: a square PNG of at least 512 px. The plugin directory
// takes it once, when the plugin is first submitted; changing it later does not change the listing.
await writeFile(
  'plugin/.claude-plugin/icon.png',
  new Resvg(icon(512), { fitTo: { mode: 'width', value: 512 } }).render().asPng(),
);
// A 400x400 PNG, the size Cline's MCP Marketplace asks for with a submission.
await writeFile(
  'docs/assets/contri-icon-400.png',
  new Resvg(icon(400), { fitTo: { mode: 'width', value: 400 } }).render().asPng(),
);
console.log('Icons written to public/, website/dist/assets/, plugin/.claude-plugin/ and docs/assets/.');
