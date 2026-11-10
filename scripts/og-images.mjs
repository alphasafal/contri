import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

/**
 * Link preview images: one per website page (1200×630) and the repository's social
 * preview (1280×640). Run `node scripts/og-images.mjs` after changing a headline.
 * Everything shown is an illustration with made-up projects, like the demo on the site.
 */
const b64 = (path) => readFileSync(resolve(path)).toString('base64');
const font = (file) => `url(data:font/woff2;base64,${b64(`website/dist/assets/${file}`)})`;
const logo = b64('docs/assets/contri-logo-white.png');

const pill = (tone, label) =>
  `<span class="pill"><i style="background:${{ good: '#2f9e5b', warn: '#c9941a', busy: '#d1604a' }[tone]}"></i>${label}</span>`;
const issueRow = (title, meta, tone, label) =>
  `<div class="row"><div><b class="link">${title}</b>${pill(tone, label)}</div><small>${meta}</small></div>`;

const issueList = `<div class="mock"><div class="bar">acme / <b>widgets</b> · Issues</div>
  ${issueRow('Tooltip is cut off on small screens', '#8 · opened 2 weeks ago', 'good', 'Looks free')}
  ${issueRow('Document the theming API', '#9 · opened 5 days ago', 'warn', 'Claimed by @lena')}
  ${issueRow('Fix the widget crash', '#7 · opened 3 months ago', 'busy', 'Open PR #12')}
  ${issueRow('Add a dark mode toggle', '#11 · opened yesterday', 'good', 'Looks free')}</div>`;

const freeRow = (title, repo, reply) =>
  `<div class="row"><div><b>${title}</b></div><small>${repo} · typical first reply ${reply}</small></div>`;
const freeList = `<div class="mock"><div class="bar">Free right now · checked today</div>
  ${freeRow('Tooltip is cut off on small screens', 'acme/widgets · TypeScript', '6 hours')}
  ${freeRow('Add an example for the retry option', 'example/fetcher · Python', '1 day')}
  ${freeRow('Docs: explain the cache flag', 'sample/buildkit · Go', '9 hours')}
  ${freeRow('Add a dark mode toggle', 'acme/widgets · TypeScript', '6 hours')}</div>`;

const rankRow = (n, repo, reply) => `<div class="row rank"><span>${n}</span><b>${repo}</b><em>${reply}</em></div>`;
const ranking = `<div class="mock"><div class="bar">Median first reply to outside contributors</div>
  ${rankRow(1, 'acme/widgets', '3 hours')}${rankRow(2, 'sample/buildkit', '9 hours')}
  ${rankRow(3, 'example/fetcher', '1 day')}${rankRow(4, 'demo/charts', '2 days')}${rankRow(5, 'example/router', '4 days')}</div>`;

const stat = (value, label) => `<div><b>${value}</b><small>${label}</small></div>`;
const wrapped = `<div class="mock dark"><div class="bar">@you · open source 2026</div>
  <div class="stats">${stat(42, 'pull requests merged')}${stat(9, 'projects')}${stat(31, 'reviews')}${stat('May', 'busiest month')}</div>
  <div class="bar foot">Made in your browser from public data</div></div>`;

const CARDS = [
  {
    out: 'website/dist/assets/og-image.jpg',
    head: 'Know if an issue is',
    em: 'really free before you start.',
    sub: 'Claims · linked pull requests · maintainer reply times<br/>A badge on every GitHub issue.',
    foot: 'Free &amp; open source · Chrome, Edge, Brave',
    mock: issueList,
  },
  {
    out: 'website/dist/assets/og-issues.jpg',
    head: 'Good first issues that are',
    em: 'free right now.',
    sub: 'Unassigned · no open pull request · nobody claimed it<br/>In projects where maintainers answer newcomers.',
    foot: 'Rebuilt every day · contri-two.vercel.app/issues',
    mock: freeList,
  },
  {
    out: 'website/dist/assets/og-repos.jpg',
    head: 'Who answers',
    em: 'newcomers?',
    sub: 'Open-source projects ranked by how fast the team<br/>first replies to outside contributors.',
    foot: 'Last 90 days · contri-two.vercel.app/repos',
    mock: ranking,
  },
  {
    out: 'website/dist/assets/og-wrapped.jpg',
    head: 'Open Source',
    em: 'Wrapped 2026.',
    sub: 'Your year in pull requests on one card.<br/>Type a GitHub username, get the card.',
    foot: 'contri-two.vercel.app/wrapped',
    mock: wrapped,
  },
  {
    out: 'docs/assets/social-preview.png',
    width: 1280,
    height: 640,
    head: 'Know if an issue is',
    em: 'really free before you start.',
    sub: 'Claims · linked pull requests · maintainer reply times<br/>A badge on every GitHub issue.',
    foot: 'Free &amp; open source · github.com/alphasafal/contri',
    mock: issueList,
  },
];

const html = ({ width = 1200, height = 630, head, em, sub, foot, mock }) => `<!doctype html><html><head><style>
@font-face{font-family:Sans;src:${font('sans.woff2')};font-weight:400}
@font-face{font-family:Sans;src:${font('sans-semibold.woff2')};font-weight:600}
@font-face{font-family:Serif;src:${font('serif.woff2')}}
*{box-sizing:border-box}body{margin:0}
.card{width:${width}px;height:${height}px;display:flex;align-items:center;gap:46px;padding:0 60px;
  background:linear-gradient(120deg,#9fb4b5,#b9c7c3 55%,#c9cfc6);font-family:Sans,Arial,sans-serif;color:#24413b}
.copy{flex:1;min-width:0}.copy img{width:250px;display:block;margin-bottom:34px}
h1{font-size:50px;font-weight:600;line-height:1.08;letter-spacing:-1.8px;margin:0 0 22px}
h1 em{display:block;font-family:Serif,serif;font-style:normal;font-weight:400;font-size:52px;letter-spacing:-1px;white-space:nowrap}
p{font-size:21px;line-height:1.55;margin:0;color:#2f4c46}
.foot{margin-top:30px;display:inline-block;background:#24413b;color:#f3f6ee;border-radius:30px;padding:10px 22px;font-size:18px}
.mock{width:470px;flex:none;background:#fff;border-radius:22px;box-shadow:0 30px 60px #1f3a3455;overflow:hidden;color:#1f2328}
.bar{padding:18px 24px;font-size:17px;color:#59636e;background:#f6f8fa;border-bottom:1px solid #d1d9e0}
.bar b{color:#1f2328}.row{padding:17px 24px;border-bottom:1px solid #e3e8ed}.row:last-child{border-bottom:0}
.row b{font-size:18px;font-weight:600;line-height:1.3}.row b.link{color:#0969da}.row small{display:block;margin-top:5px;font-size:14px;color:#59636e}
.pill{display:inline-flex;align-items:center;gap:6px;margin-left:8px;padding:2px 10px 2px 8px;border-radius:999px;font-size:13px;font-weight:500;
  color:#2c4443;border:1px solid #47626359;background:#4762631c;white-space:nowrap;vertical-align:middle}
.pill i{width:8px;height:8px;border-radius:50%}
.rank{display:flex;align-items:center;gap:16px}.rank span{width:22px;font-size:15px;color:#59636e}.rank b{flex:1}.rank em{font-style:normal;font-size:16px;color:#2c4443}
.dark{background:#253c38;color:#eef1df}.dark .bar{background:#1f3330;border-color:#ffffff1f;color:#c6d3c4}.dark .foot{margin:0;display:block;border-radius:0;border-top:1px solid #ffffff1f;border-bottom:0;font-size:14px}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:26px 20px;padding:30px 24px}.stats b{display:block;font-family:Serif,serif;font-weight:400;font-size:54px;line-height:1}
.stats small{display:block;margin-top:6px;font-size:15px;color:#c6d3c4}
</style></head><body><div class="card"><div class="copy"><img src="data:image/png;base64,${logo}" alt=""/>
<h1>${head}<em>${em}</em></h1><p>${sub}</p><div class="foot">${foot}</div></div>${mock}</div></body></html>`;

const browser = await chromium.launch(
  process.env.CONTRI_CHROMIUM ? { executablePath: process.env.CONTRI_CHROMIUM } : { channel: 'chromium' },
);
for (const card of CARDS) {
  const { width = 1200, height = 630, out } = card;
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html(card));
  await page.evaluate('document.fonts.ready');
  const png = await page.screenshot({ type: 'png' });
  await (out.endsWith('.jpg') ? sharp(png).jpeg({ quality: 86, mozjpeg: true }) : sharp(png).png()).toFile(
    resolve(out),
  );
  await page.close();
  console.log(`${out} ${width}×${height}`);
}
await browser.close();
