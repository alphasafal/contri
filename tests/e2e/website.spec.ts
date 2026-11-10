import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

/**
 * The website's data pages in a real browser: served from website/dist exactly as
 * deployed (clean URLs), with GitHub's hosts answered by fixtures. No extension here.
 */
const ROOT = resolve('website/dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
};
let server: Server;
let browser: Browser;
let origin = '';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = normalize(new URL(req.url ?? '/', 'http://x').pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, path === '/' ? 'index.html' : extname(path) ? path : `${path}.html`);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch(
    process.env.CONTRI_CHROMIUM ? { executablePath: process.env.CONTRI_CHROMIUM } : { channel: 'chromium' },
  );
});
test.afterAll(async () => {
  await browser?.close();
  await new Promise((done) => server.close(done));
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ISSUES = {
  generatedAt: hoursAgo(3),
  issues: [
    {
      repo: 'acme/widgets',
      number: 8,
      title: 'Tooltip is cut off <img src=x onerror=alert(1)>',
      url: 'https://github.com/acme/widgets/issues/8',
      labels: ['good first issue'],
      comments: 2,
      updatedAt: hoursAgo(30),
      language: 'TypeScript',
      stars: 1234,
      replyHours: 6.5,
    },
    {
      repo: 'gophers/tool',
      number: 3,
      title: 'Document the config file',
      url: 'javascript:alert(1)',
      labels: [],
      comments: 0,
      updatedAt: hoursAgo(50),
      language: 'Go',
      stars: 80,
      replyHours: null,
    },
    {
      repo: 'robots/instant',
      number: 5,
      title: 'Add a retry flag',
      url: 'https://github.com/robots/instant/issues/5',
      labels: [],
      comments: 1,
      updatedAt: hoursAgo(10),
      language: 'Go',
      stars: 46000,
      replyHours: 0,
      replyInstant: true,
    },
  ],
};
const REPOS = {
  generatedAt: hoursAgo(3),
  repos: [
    {
      repo: 'robots/instant',
      url: 'https://github.com/robots/instant',
      description: null,
      language: 'Go',
      stars: 46000,
      merges90: 50,
      // Published before the feed set the flag: the page applies the same 15-minute rule itself.
      reply: { hours: 0, basis: 'pull requests', answered: 14, sampled: 20 },
      listed: 'search',
    },
    {
      repo: 'acme/widgets',
      url: 'https://github.com/acme/widgets',
      description: null,
      language: 'TypeScript',
      stars: 1234,
      merges90: 41,
      reply: { hours: 6.5, basis: 'pull requests', answered: 9, sampled: 12, instant: false },
      listed: 'search',
    },
    {
      repo: 'alphasafal/contri',
      url: 'https://github.com/alphasafal/contri',
      description: null,
      language: 'TypeScript',
      stars: 3,
      merges90: null,
      reply: null,
      listed: 'opt-in',
    },
  ],
  skipped: [{ repo: 'gone/repo', reason: 'Not found on GitHub.' }],
};

async function open(path: string, data: Record<string, unknown> | null) {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => {
    errors.push(`dialog: ${d.message()}`);
    void d.dismiss();
  });
  await page.route('https://raw.githubusercontent.com/**', (route) => {
    const file = new URL(route.request().url()).pathname.split('/feed-data/')[1];
    const body = data?.[file];
    return body
      ? route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } })
      : route.fulfill({ status: 404, body: 'Not Found', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(`${origin}${path}`);
  return { page, errors };
}

test('free issues: lists what the feed published, filters by language, and never trusts the data as HTML', async () => {
  const { page, errors } = await open('/issues', { 'free-issues.json': ISSUES });
  await expect(page.locator('.rows li')).toHaveCount(3);
  await expect(page.getByRole('status').first()).toContainText('3 issues that looked free when checked 3 hours ago');
  // A reply "within minutes" is not shown as a zero, and sorts after the measured project but before the unknown one.
  await expect(page.locator('.rows li').nth(1).locator('.sub')).toContainText('robots/instant#5');
  await expect(page.locator('.rows li').nth(1).locator('.side')).toHaveText('minutesfirst reply, often automated');
  const first = page.locator('.rows li').first();
  await expect(first.locator('a.title')).toHaveAttribute('href', 'https://github.com/acme/widgets/issues/8');
  await expect(first.locator('a.title')).toContainText('<img src=x onerror=alert(1)>');
  await expect(first.locator('.side')).toContainText('~6.5h');
  await expect(first.locator('.sub')).toContainText('acme/widgets#8');
  // A URL that is not https://github.com is shown as text, not as a link.
  await expect(page.locator('.rows li').nth(2).locator('a')).toHaveCount(0);
  await expect(page.locator('.rows li').nth(2).locator('.side')).toContainText('reply time unknown');
  await expect(page.locator('.rows img')).toHaveCount(0);

  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.locator('.rows li')).toHaveCount(2);
  await expect(page).toHaveURL(/language=Go/);
  await expect(page.getByRole('button', { name: 'Go', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  await page.context().close();
});

test('free issues: before the first data exists the page says so instead of breaking', async () => {
  const { page, errors } = await open('/issues', null);
  await expect(page.locator('.notice')).toContainText('The first list is being prepared');
  expect(errors).toEqual([]);
  await page.context().close();
});

test('leaderboard: ranks timed projects, keeps "not enough evidence" unranked, and copies a README badge', async () => {
  const { page, errors } = await open('/repos', { 'repos.json': REPOS });
  await expect(page.locator('.rows li:not(.group)')).toHaveCount(3);
  // The measured project is first even though the data lists a 0-hour project before it.
  const first = page.locator('.rows li').first();
  await expect(first.locator('a.title')).toHaveText('acme/widgets');
  await expect(first.locator('.rank')).toHaveText('01');
  await expect(first.locator('.side')).toContainText('~6.5h');
  await expect(first.locator('.side')).toContainText('9 of 12 pull requests answered');
  // "Within minutes" is its own unranked group, then the projects without enough evidence.
  await expect(page.locator('.rows li.group')).toHaveText([
    'First reply within minutes — usually automation, so these are not ranked',
    'Not enough recent outside contributions to time',
  ]);
  const instant = page.locator('.rows li').nth(2);
  await expect(instant.locator('a.title')).toHaveText('robots/instant');
  await expect(instant.locator('.rank')).toHaveCount(0);
  await expect(instant.locator('.side b')).toHaveText('minutes');
  await expect(page.getByRole('status').first()).toContainText('2 of 3 projects had enough');
  const second = page.locator('.rows li').nth(4);
  await expect(second.locator('.rank')).toHaveCount(0);
  await expect(second.locator('.side')).toContainText('not enough evidence yet');
  await expect(second.locator('.sub')).toContainText('added by its maintainers');
  await expect(page.getByText('Not read this time: gone/repo.')).toBeVisible();

  await first.getByRole('button', { name: 'Copy README badge' }).click();
  await expect(first.locator('.copy')).toHaveText('Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('img.shields.io/endpoint?url=');
  expect(decodeURIComponent(copied)).toContain('/feed-data/badge/acme/widgets.json');
  await expect(page.locator('.notice a')).toHaveAttribute(
    'href',
    'https://github.com/alphasafal/contri/edit/main/feed/repos.txt',
  );
  expect(errors).toEqual([]);
  await page.context().close();
});

async function wrapped(page: Page, total: number) {
  const item = (repo: string, at: string) => ({
    repository_url: `https://api.github.com/repos/${repo}`,
    pull_request: { merged_at: at },
  });
  const asked: string[] = [];
  await page.route('https://api.github.com/**', (route) => {
    const url = new URL(route.request().url());
    asked.push(url.pathname + url.search);
    const headers = { 'access-control-allow-origin': '*' };
    if (url.pathname === '/users/ghost-user')
      return route.fulfill({ status: 404, json: { message: 'Not Found' }, headers });
    if (url.pathname === '/users/limited')
      return route.fulfill({
        status: 403,
        json: { message: 'API rate limit exceeded' },
        headers: {
          ...headers,
          'access-control-expose-headers': 'x-ratelimit-reset',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 170),
        },
      });
    if (url.pathname.startsWith('/users/')) return route.fulfill({ json: { login: 'Sam', name: 'Sam Lee' }, headers });
    const q = url.searchParams.get('q') ?? '';
    if (q.includes('is:merged'))
      return route.fulfill({
        json: {
          total_count: total,
          items: [
            item('acme/widgets', '2026-03-09T10:00:00Z'),
            item('acme/widgets', '2026-03-12T10:00:00Z'),
            item('zed/editor', '2026-06-01T10:00:00Z'),
            item('sam/site', '2026-01-01T10:00:00Z'),
          ],
        },
        headers,
      });
    return route.fulfill({
      json: { total_count: q.includes('reviewed-by') ? 12 : q.includes('type:issue') ? 4 : 9, items: [] },
      headers,
    });
  });
  return asked;
}

test('wrapped: a username becomes a drawn card with share links and a text alternative', async () => {
  const { page, errors } = await open('/wrapped#year=2026', null);
  const asked = await wrapped(page, 4);
  await page.locator('#login').fill('@sam');
  await page.getByRole('button', { name: 'Make my card' }).click();
  await expect(page.locator('#result')).toBeVisible();
  // The username never becomes part of the address the web host sees.
  expect(new URL(page.url()).search).toBe('');
  // Five lookups, all public, all for 2026.
  expect(asked).toHaveLength(5);
  expect(asked[0]).toBe('/users/sam');
  expect(asked.slice(1).every((a) => a.includes('is%3Apublic') && a.includes('2026-01-01..2026-12-31'))).toBe(true);

  await expect(page.locator('#card-text')).toHaveText(
    "Sam Lee's open source 2026: First merges of many. 4 merged pull requests, 9 opened, 12 reviewed for others, 4 issues opened. 3 projects, 2 of them other people's. Most merged in: acme/widgets (2), zed/editor (1). Busiest month: March.",
  );
  // The canvas was really painted: the corner is the card's dark teal and the title area has light pixels.
  const pixels = await page.evaluate(() => {
    const c = document.getElementById('card') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const corner = [...ctx.getImageData(4, 4, 1, 1).data];
    const band = ctx.getImageData(66, 200, 700, 60).data;
    let light = 0;
    for (let i = 0; i < band.length; i += 4) if (band[i] > 230 && band[i + 1] > 230 && band[i + 2] > 230) light++;
    return { corner, light };
  });
  expect(pixels.corner[3]).toBe(255);
  expect(pixels.corner[0]).toBeLessThan(90);
  expect(pixels.light).toBeGreaterThan(300);

  const tweet = new URL((await page.locator('#share-x').getAttribute('href'))!);
  expect(tweet.searchParams.get('text')).toBe(
    "My open source 2026: 4 merged pull requests across 2 projects that aren't mine. #OpenSourceWrapped",
  );
  expect(tweet.searchParams.get('url')).toBe('https://contri-two.vercel.app/wrapped#u=Sam&year=2026');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the card' }).click();
  expect((await download).suggestedFilename()).toBe('open-source-wrapped-2026-Sam.png');
  expect(errors).toEqual([]);
  await page.context().close();
});

test("wrapped: bad input, unknown users and GitHub's limit get a plain explanation and no card", async () => {
  const { page, errors } = await open('/wrapped', null);
  const asked = await wrapped(page, 0);
  const status = page.locator('#status');
  await page.locator('#login').fill('sam is:private');
  await page.getByRole('button', { name: 'Make my card' }).click();
  await expect(status).toContainText('does not look like a GitHub username');
  expect(asked).toEqual([]);

  await page.locator('#login').fill('ghost-user');
  await page.getByRole('button', { name: 'Make my card' }).click();
  await expect(status).toContainText('No public GitHub activity was found');

  await page.locator('#login').fill('limited');
  await page.getByRole('button', { name: 'Make my card' }).click();
  await expect(status).toContainText("GitHub's limit for lookups without an account was reached");
  await expect(status).toContainText('about 3 minutes');
  await expect(page.locator('#result')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Make my card' })).toBeEnabled();
  expect(errors).toEqual([]);
  await page.context().close();
});

test('wrapped: a shared link makes the card straight away', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await wrapped(page, 4);
  await page.goto(`${origin}/wrapped#u=sam`);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#login')).toHaveValue('sam');
  await context.close();
});
