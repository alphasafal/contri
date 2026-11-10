import { test, chromium, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { resolve } from 'node:path';
import { startMockGitHub } from './mock-github';

/**
 * Regenerates README screenshots, the social preview card (1280×640) and the Chrome
 * Web Store graphics (exact 1280×800 screenshots, 440×280 and 1400×560 promo images)
 * from the real built extension running on the GitHub-like mock pages. The repository
 * data shown is the mock's example data, not a real project.
 *   npm run build && npm run screenshots
 */
test.skip(!process.env.CONTRI_SCREENSHOTS, 'Set CONTRI_SCREENSHOTS=1 to regenerate docs/assets screenshots.');

const OUT = resolve('docs/assets');
const STORE = resolve('docs/store');
const DIST = resolve('dist');

test('README screenshots and social card', async () => {
  test.setTimeout(90_000);
  const mock = startMockGitHub(8443);
  const context = await chromium.launchPersistentContext('', {
    ...(process.env.CONTRI_CHROMIUM ? { executablePath: process.env.CONTRI_CHROMIUM } : { channel: 'chromium' }),
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--host-resolver-rules=MAP github.com 127.0.0.1:8443, MAP api.github.com 127.0.0.1:8443',
      '--ignore-certificate-errors',
      '--no-proxy-server',
    ],
  });
  await (context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker'));
  const settle = async (page: Page) => {
    await page.mouse.move(640, 60);
    await page.waitForTimeout(600);
  };
  const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });

  // 1. Issue page: inline badge + availability details.
  const issue = await context.newPage();
  await issue.goto('https://github.com/acme/widgets/issues/7');
  const badge = issue.locator('#contri-issue-badge button');
  await badge.click();
  await issue.locator('#contri-issue-badge button', { hasText: 'Claim went quiet' }).waitFor();
  await settle(issue);
  await issue.screenshot({ path: `${OUT}/issue-badge.png`, clip: { x: 0, y: 90, width: 860, height: 150 } });
  await badge.click();
  await issue.locator('.cc-insight').waitFor();
  await settle(issue);
  await shot(issue, 'screenshot-issue');

  // 2. Repository overview.
  const repo = await context.newPage();
  await repo.goto('https://github.com/acme/widgets');
  await repo.locator('.cc-launcher').click();
  await repo.getByText('v1.2.0').waitFor();
  await settle(repo);
  await shot(repo, 'screenshot-overview');

  // 3. Team responses.
  await repo.locator('.cc-nav button', { hasText: 'Team' }).click();
  await repo.getByRole('button', { name: /Analyze team responses/ }).click();
  await repo.locator('.cc-person').first().waitFor();
  await settle(repo);
  await shot(repo, 'screenshot-team');

  // 4. GitHub dark mode.
  await repo.evaluate(() => (document.documentElement.dataset.colorMode = 'dark'));
  await repo.locator('.cc-nav button', { hasText: 'Overview' }).click();
  await repo.getByText('v1.2.0').waitFor();
  await settle(repo);
  await shot(repo, 'screenshot-dark');

  // 5. Social preview card for GitHub (Settings → Social preview).
  const logo = readFileSync(resolve('docs/assets/contri-logo-white.png')).toString('base64');
  const font = (file: string) => readFileSync(resolve(`public/fonts/${file}`)).toString('base64');
  const widget = await repo.locator('#contri-widget-root').screenshot();
  await repo.evaluate(() => (document.documentElement.dataset.colorMode = 'light'));
  const card = await context.newPage();
  await card.setViewportSize({ width: 1280, height: 640 });
  await card.setContent(`<!doctype html><html><head><style>
    @font-face{font-family:Contri;src:url(data:font/woff2;base64,${font('dm-sans-400.woff2')});font-weight:400}
    @font-face{font-family:Contri;src:url(data:font/woff2;base64,${font('dm-sans-600.woff2')});font-weight:600}
    </style></head><body style="margin:0">
    <div style="width:1280px;height:640px;display:flex;align-items:center;gap:40px;padding:0 70px;box-sizing:border-box;
      background:linear-gradient(120deg,#a9bdbf,#bfcac6 55%,#c9cfc6);font-family:Contri,Arial,sans-serif;color:#fff">
      <div style="flex:1">
        <img src="data:image/png;base64,${logo}" style="width:400px;display:block;margin-bottom:26px" />
        <div style="font-size:50px;font-weight:600;line-height:1.1;letter-spacing:-1.8px;margin:6px 0 22px;color:#24413b">
          Find open-source issues<br/>you can actually take.</div>
        <div style="font-size:22px;line-height:1.6;color:#2f4c46">Project activity · maintainer reply times<br/>claims &amp; linked PRs — right on GitHub.</div>
        <div style="margin-top:26px;display:inline-block;background:#24413b;color:#f3f6ee;border-radius:30px;padding:10px 22px;font-size:20px">
          Free &amp; open source · github.com/alphasafal/contri</div>
      </div>
      <img src="data:image/png;base64,${widget.toString('base64')}" style="height:560px;border-radius:24px;box-shadow:0 30px 60px #1f3a3455" />
    </div></body></html>`);
  await card.waitForTimeout(400);
  await card.screenshot({ path: `${OUT}/social-preview.png` });

  // 6. Chrome Web Store: screenshots must be exactly 1280×800; promo images avoid text.
  mkdirSync(STORE, { recursive: true });
  const store = [
    ['screenshot-issue', 'screenshot-1-issue-availability'],
    ['screenshot-overview', 'screenshot-2-project-activity'],
    ['screenshot-team', 'screenshot-3-team-replies'],
    ['screenshot-dark', 'screenshot-4-dark-mode'],
  ];
  for (const [from, to] of store)
    await sharp(`${OUT}/${from}.png`).resize(1280, 800).png().toFile(`${STORE}/${to}.png`);
  const symbol = `<svg viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="44" stroke="#f3f6ee" stroke-opacity=".62" stroke-width="5"/><path d="M30 81 74 15M55 20.5l19-5.5 2 19" stroke="#f3f6ee" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const promo = async (width: number, height: number, name: string) => {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    const panel = Math.round(height * 0.86);
    await page.setContent(`<!doctype html><body style="margin:0"><div style="width:${width}px;height:${height}px;
      display:flex;align-items:center;justify-content:space-evenly;overflow:hidden;
      background:linear-gradient(125deg,#3f5b5c,#2b4442 55%,#4a5f4f)">
      <div style="width:${Math.round(height * 0.5)}px;height:${Math.round(height * 0.5)}px">${symbol}</div>
      <img src="data:image/png;base64,${widget.toString('base64')}" style="height:${panel}px;border-radius:${Math.round(panel / 22)}px;box-shadow:0 20px 50px #0c1f1d80" />
    </div></body>`);
    await page.waitForTimeout(300);
    await sharp(await page.screenshot())
      .resize(width, height)
      .png()
      .toFile(`${STORE}/${name}.png`);
    await page.close();
  };
  await promo(440, 280, 'promo-small-440x280');
  await promo(1400, 560, 'promo-marquee-1400x560');

  // 7. Issue list badges. Last, because it signs in and the earlier shots are anonymous.
  const extensionId = new URL(context.serviceWorkers()[0].url()).host;
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/settings.html`);
  await settings.getByText('Use a personal access token instead').click();
  await settings.locator('#token').fill('github_pat_e2e');
  await settings.getByRole('button', { name: 'Connect token' }).click();
  await settings.getByText(/Signed in as @tester/).waitFor();
  const list = await context.newPage();
  await list.goto('https://github.com/acme/widgets/issues');
  await list.locator('[data-contri="list-badge"]').nth(2).waitFor();
  await settle(list);
  await list.screenshot({ path: `${OUT}/screenshot-list.png`, clip: { x: 0, y: 0, width: 1100, height: 420 } });

  await context.close();
  await mock.close();
});
