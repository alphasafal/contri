import { describe, queries, shareText, summarize, validLogin, validYear } from './wrapped-core.js';

/**
 * Open Source Wrapped: looks a username up on GitHub's public API from this browser,
 * draws a card on a canvas and offers it for download and sharing. Nothing is stored
 * and nothing is sent anywhere except the lookups to api.github.com.
 */
const API = 'https://api.github.com';
const SITE = 'https://contri-two.vercel.app';
const form = document.getElementById('lookup');
const field = document.getElementById('login');
const status = document.getElementById('status');
const result = document.getElementById('result');
const canvas = document.getElementById('card');
const button = form.querySelector('button');
// Share links carry the username after the #, which browsers never send to a server.
const params = new URLSearchParams(location.hash.slice(1));
const year = validYear(params.get('year'));

class LookupError extends Error {}

async function github(path) {
  let response;
  try {
    response = await fetch(`${API}${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  } catch {
    throw new LookupError('GitHub could not be reached. Check your connection and try again.');
  }
  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const wait = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : 1;
    throw new LookupError(
      `GitHub's limit for lookups without an account was reached on this network. Try again in about ${wait} minute${wait === 1 ? '' : 's'}.`,
    );
  }
  if (response.status === 404 || response.status === 422) throw new LookupError('No public GitHub activity was found for that username.');
  if (!response.ok) throw new LookupError(`GitHub answered ${response.status}. Try again in a minute.`);
  return response.json();
}

const search = (q, extra = '') => github(`/search/issues?q=${encodeURIComponent(q)}${extra}`);

async function lookup(login) {
  const user = await github(`/users/${login}`);
  const q = queries(user.login, year);
  // The merged list carries the details; the other three are only counted.
  const merged = await search(q.merged, '&per_page=100&sort=created&order=asc');
  const [opened, issues, reviewed] = await Promise.all([
    search(q.opened, '&per_page=1'),
    search(q.issues, '&per_page=1'),
    search(q.reviewed, '&per_page=1'),
  ]);
  return summarize({
    login: user.login,
    name: user.name,
    year,
    merged,
    opened: opened.total_count,
    issues: issues.total_count,
    reviewed: reviewed.total_count,
  });
}

/* ---------- the card ---------- */

const W = 1200;
const H = 630;
const SANS = 'DM, Arial, sans-serif';
const SERIF = 'Caslon, Georgia, serif';

function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function draw(s) {
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#3f5b5c');
  bg.addColorStop(0.55, '#2b4442');
  bg.addColorStop(1, '#4a5f4f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // A soft light in the corner, like the glass panel.
  const glow = ctx.createRadialGradient(W - 140, 90, 20, W - 140, 90, 520);
  glow.addColorStop(0, '#fce9b630');
  glow.addColorStop(1, '#fce9b600');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = 'alphabetic';
  // Header: the mark, the wordmark and the year.
  ctx.strokeStyle = '#f3f6eeb0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(86, 82, 20, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#f3f6ee';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(77, 96);
  ctx.lineTo(97, 66);
  ctx.moveTo(88, 68.5);
  ctx.lineTo(97, 66);
  ctx.lineTo(98, 75);
  ctx.stroke();
  ctx.fillStyle = '#f3f6ee';
  ctx.font = `600 30px ${SANS}`;
  ctx.fillText('contri.', 118, 93);
  ctx.textAlign = 'right';
  ctx.font = `400 15px ${SANS}`;
  ctx.fillStyle = '#d5dfcf';
  ctx.fillText(`OPEN SOURCE WRAPPED ${s.year}`, W - 66, 90);
  ctx.textAlign = 'left';

  // Who, and the line the numbers earned.
  ctx.fillStyle = '#d5dfcf';
  ctx.font = `400 22px ${SANS}`;
  ctx.fillText(fit(ctx, `@${s.login}`, 700), 66, 178);
  ctx.fillStyle = '#ffffff';
  ctx.font = `400 64px ${SERIF}`;
  ctx.fillText(fit(ctx, s.title, W - 132), 66, 250);

  // Four numbers.
  const stats = [
    [s.merged, s.merged === 1 ? 'pull request merged' : 'pull requests merged'],
    [s.otherProjects, s.otherProjects === 1 ? "project that isn't mine" : "projects that aren't mine"],
    [s.reviewed, s.reviewed === 1 ? 'review for others' : 'reviews for others'],
    [s.issues, s.issues === 1 ? 'issue opened' : 'issues opened'],
  ];
  const col = (W - 132) / 4;
  stats.forEach(([value, label], i) => {
    const x = 66 + i * col;
    ctx.fillStyle = '#fce9b6';
    ctx.font = `400 86px ${SERIF}`;
    const shown = `${i === 1 && s.partial && value ? '≥' : ''}${Number(value).toLocaleString('en-US')}`;
    ctx.fillText(fit(ctx, shown, col - 20), x, 380);
    ctx.fillStyle = '#e6ecdf';
    ctx.font = `400 17px ${SANS}`;
    ctx.fillText(label, x, 412);
  });

  // Where it went and when.
  ctx.strokeStyle = '#ffffff30';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(66, 456);
  ctx.lineTo(W - 66, 456);
  ctx.stroke();
  ctx.fillStyle = '#b9c9b4';
  ctx.font = `400 13px ${SANS}`;
  ctx.fillText(s.topProjects.length ? 'MOST MERGED IN' : 'THE YEAR SO FAR', 66, 492);
  ctx.fillStyle = '#f3f6ee';
  ctx.font = `400 21px ${SANS}`;
  // As many of the top projects as fit whole; a name cut in half says less than one name fewer.
  const room = W - 132 - (s.busiestMonth ? 240 : 0);
  let where = `${s.opened.toLocaleString('en-US')} pull request${s.opened === 1 ? '' : 's'} opened`;
  for (let n = s.topProjects.length; n > 0; n--) {
    where = s.topProjects
      .slice(0, n)
      .map((p) => `${p.repo} (${p.count})`)
      .join('   ·   ');
    if (ctx.measureText(where).width <= room) break;
  }
  ctx.fillText(fit(ctx, where, room), 66, 524);
  if (s.busiestMonth) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#b9c9b4';
    ctx.font = `400 13px ${SANS}`;
    ctx.fillText('BUSIEST MONTH', W - 66, 492);
    ctx.fillStyle = '#f3f6ee';
    ctx.font = `400 21px ${SANS}`;
    ctx.fillText(s.busiestMonth, W - 66, 524);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#b9c9b4';
  ctx.font = `400 14px ${SANS}`;
  ctx.fillText('Public GitHub activity  ·  make yours at contri-two.vercel.app/wrapped', 66, 586);
}

/* ---------- the page ---------- */

/** A canvas does not wait for web fonts: ask for the ones the card uses, and draw with fallbacks if they fail. */
const fonts = () =>
  Promise.all(
    [`400 64px Caslon`, `400 20px DM`, `600 30px DM`].map((font) => document.fonts?.load(font).catch(() => {})),
  );

function show(s) {
  draw(s);
  document.getElementById('card-text').textContent = describe(s);
  canvas.setAttribute('aria-label', describe(s));
  const link = `${SITE}/wrapped#u=${encodeURIComponent(s.login)}${params.get('year') ? `&year=${s.year}` : ''}`;
  const text = shareText(s);
  document.getElementById('share-x').href =
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`;
  document.getElementById('share-in').href =
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`;
  document.getElementById('download').onclick = () =>
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `open-source-wrapped-${s.year}-${s.login}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  const copy = document.getElementById('copy-link');
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      copy.textContent = 'Link copied';
    } catch {
      copy.textContent = link;
    }
  };
  result.hidden = false;
  status.textContent = s.partial
    ? `Counted ${s.merged.toLocaleString('en-US')} merged pull requests; projects and the busiest month come from the first ${s.sampled}.`
    : 'Download the card and post it with the share text, or copy a link that makes it again.';
}

async function make(raw) {
  const login = validLogin(raw);
  if (!login) {
    status.textContent = 'That does not look like a GitHub username: letters, numbers and single hyphens only.';
    return;
  }
  button.disabled = true;
  result.hidden = true;
  status.textContent = `Reading @${login}'s public ${year} on GitHub…`;
  try {
    const [summary] = await Promise.all([lookup(login), fonts()]);
    show(summary);
  } catch (error) {
    status.textContent = error instanceof LookupError ? error.message : 'Something went wrong while making the card. Please try again.';
  } finally {
    button.disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void make(field.value);
});
const preset = validLogin(params.get('u'));
if (preset) {
  field.value = preset;
  void make(preset);
}
