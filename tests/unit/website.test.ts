import { existsSync, readFileSync } from 'node:fs';
import { describe as group, expect, it } from 'vitest';
import { ago, badgeMarkdown, badgeUrl, githubUrl, hours, isInstant, languagesOf } from '../../website/dist/feed.js';
import {
  describe,
  queries,
  shareText,
  summarize,
  titleFor,
  validLogin,
  validYear,
} from '../../website/dist/wrapped-core.js';
import { hours as extensionHours } from '../../src/shared/format';
import { badgePath, INSTANT_HOURS } from '../../feed/src/feed';
import { INSTANT_HOURS as PAGE_INSTANT_HOURS } from '../../website/dist/feed.js';

group('website: feed pages', () => {
  it('formats reply times exactly like the extension', () => {
    for (const value of [0.2, 0.999, 1, 6.46, 47.9, 48, 60, 200, null])
      expect(hours(value)).toBe(extensionHours(value));
  });
  it('calls a reply "within minutes" by the feed\'s flag, or by the same threshold for older data', () => {
    expect(PAGE_INSTANT_HOURS).toBe(INSTANT_HOURS);
    expect(isInstant({ hours: 0.1, instant: true })).toBe(true);
    expect(isInstant({ hours: 0.1 })).toBe(true);
    expect(isInstant({ hours: 0.25 })).toBe(false);
    expect(isInstant({ hours: 6, instant: false })).toBe(false);
    expect(isInstant(null)).toBe(false);
  });
  it('links only plain https github.com URLs from the data', () => {
    expect(githubUrl('https://github.com/acme/widgets/issues/7')).toBe('https://github.com/acme/widgets/issues/7');
    expect(githubUrl('javascript:alert(1)')).toBeNull();
    expect(githubUrl('http://github.com/acme/widgets')).toBeNull();
    expect(githubUrl('https://github.com.evil.example/a/b')).toBeNull();
    expect(githubUrl('https://user:pw@github.com/a/b')).toBeNull();
    expect(githubUrl('nonsense')).toBeNull();
  });
  it('orders language filters by how many issues they have', () => {
    expect(languagesOf([{ language: 'Go' }, { language: 'Rust' }, { language: null }, { language: 'Rust' }])).toEqual([
      'Rust',
      'Go',
    ]);
  });
  it('says how long ago the data was checked', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(ago('2026-11-10T11:59:30Z', now)).toBe('just now');
    expect(ago('2026-11-10T09:00:00Z', now)).toBe('3 hours ago');
    expect(ago('2026-11-07T12:00:00Z', now)).toBe('3 days ago');
    expect(ago('garbage', now)).toBe('');
  });
  it('points the README badge at the file the feed publishes for that repository', () => {
    expect(decodeURIComponent(badgeUrl('Acme/Widgets'))).toBe(
      `https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/alphasafal/contri/feed-data/${badgePath('Acme/Widgets')}`,
    );
    expect(badgeMarkdown('acme/widgets')).toMatch(
      /^\[!\[first reply to contributors\]\(https:\/\/img\.shields\.io\/endpoint\?url=.+\)\]\(https:\/\/contri-two\.vercel\.app\/repos\)$/,
    );
  });
});

group('website: Open Source Wrapped', () => {
  const pr = (repo: string, mergedAt: string) => ({
    repository_url: `https://api.github.com/repos/${repo}`,
    pull_request: { merged_at: mergedAt },
  });

  it('accepts GitHub usernames and nothing that could change a search', () => {
    expect(validLogin(' @alphasafal ')).toBe('alphasafal');
    expect(validLogin('a-b-c')).toBe('a-b-c');
    expect(validLogin('a--b')).toBeNull();
    expect(validLogin('-ab')).toBeNull();
    expect(validLogin('ab-')).toBeNull();
    expect(validLogin('sam is:private')).toBeNull();
    expect(validLogin('sam+repo:x/y')).toBeNull();
    expect(validLogin('a'.repeat(40))).toBeNull();
    expect(validLogin(null)).toBeNull();
  });
  it("keeps the year between GitHub's first year and now", () => {
    const now = new Date('2026-11-10T00:00:00Z');
    expect(validYear('2025', now)).toBe(2025);
    expect(validYear('2027', now)).toBe(2026);
    expect(validYear('1999', now)).toBe(2026);
    expect(validYear(null, now)).toBe(2026);
    expect(validYear('20x6', now)).toBe(2026);
  });
  it('searches public activity of that year only', () => {
    const q = queries('sam', 2026);
    expect(q.merged).toBe('author:sam type:pr is:merged is:public merged:2026-01-01..2026-12-31');
    expect(q.reviewed).toBe('reviewed-by:sam -author:sam type:pr is:public created:2026-01-01..2026-12-31');
    for (const value of Object.values(q)) expect(value).toContain('is:public');
  });
  it("counts projects, other people's projects, the top three and the busiest month", () => {
    const s = summarize({
      login: 'Sam',
      name: 'Sam Lee',
      year: 2026,
      merged: {
        total_count: 7,
        items: [
          pr('sam/dotfiles', '2026-01-05T10:00:00Z'),
          pr('sam/dotfiles', '2026-03-02T10:00:00Z'),
          pr('sam/dotfiles', '2026-03-03T10:00:00Z'),
          pr('acme/widgets', '2026-03-09T10:00:00Z'),
          pr('acme/widgets', '2026-06-01T10:00:00Z'),
          pr('zed/editor', '2026-03-20T10:00:00Z'),
          pr('old/merge', '2025-12-31T23:00:00Z'),
        ],
      },
      opened: 9,
      issues: 4,
      reviewed: 12,
    });
    expect(s).toMatchObject({
      login: 'Sam',
      name: 'Sam Lee',
      merged: 7,
      opened: 9,
      issues: 4,
      reviewed: 12,
      projects: 4,
      otherProjects: 3,
      mergedElsewhere: 4,
      busiestMonth: 'March',
      firstMerge: '2026-01-05',
      sampled: 7,
      partial: false,
      title: 'Many projects, one contributor',
    });
    // The user's own repositories are left out of "most merged in" when there is anything else.
    expect(s.topProjects).toEqual([
      { repo: 'acme/widgets', count: 2 },
      { repo: 'old/merge', count: 1 },
      { repo: 'zed/editor', count: 1 },
    ]);
    expect(shareText(s)).toBe(
      "My open source 2026: 7 merged pull requests across 3 projects that aren't mine. #OpenSourceWrapped",
    );
    expect(describe(s)).toContain('Busiest month: March.');
  });
  it('says "at least" when the year has more merges than were loaded, and is kind to an empty year', () => {
    const many = summarize({
      login: 'sam',
      year: 2026,
      merged: {
        total_count: 340,
        items: Array.from({ length: 100 }, (_, i) => pr(`org/repo${i % 12}`, '2026-02-01T00:00:00Z')),
      },
    });
    expect(many).toMatchObject({
      merged: 340,
      sampled: 100,
      partial: true,
      otherProjects: 12,
      title: 'Everywhere at once',
    });
    expect(shareText(many)).toContain('at least 12 projects');
    const none = summarize({ login: 'sam', year: 2026, merged: { total_count: 0, items: [] } });
    expect(none).toMatchObject({
      merged: 0,
      projects: 0,
      topProjects: [],
      busiestMonth: null,
      title: 'Getting started',
    });
    expect(shareText(none)).toBe('My open source 2026 starts now. #OpenSourceWrapped');
    const own = summarize({
      login: 'sam',
      year: 2026,
      merged: { total_count: 1, items: [pr('sam/site', '2026-05-05T00:00:00Z')] },
    });
    expect(own.topProjects).toEqual([{ repo: 'sam/site', count: 1 }]);
    expect(shareText(own)).toBe('My open source 2026: 1 merged pull request. #OpenSourceWrapped');
  });
  it('gives titles by the numbers', () => {
    expect([
      titleFor(0, 0),
      titleFor(2, 1),
      titleFor(6, 1),
      titleFor(25, 2),
      titleFor(120, 2),
      titleFor(8, 4),
      titleFor(30, 11),
    ]).toEqual([
      'Getting started',
      'First merges of many',
      'Finding a rhythm',
      'Steady shipper',
      'Merge machine',
      'Many projects, one contributor',
      'Everywhere at once',
    ]);
  });
});

group('website: static pages', () => {
  const SITE = 'https://contri-two.vercel.app';
  const read = (file: string) => readFileSync(`website/dist/${file}`, 'utf8');
  const PAGES = ['index', 'issues', 'repos', 'wrapped'];
  const attr = (html: string, pattern: RegExp) => html.match(pattern)?.[1] ?? '';

  it('gives every page a title, a canonical address and a complete link preview', () => {
    for (const name of PAGES) {
      const html = read(`${name}.html`);
      const address = name === 'index' ? `${SITE}/` : `${SITE}/${name}`;
      expect(attr(html, /<link rel="canonical" href="([^"]+)">/)).toBe(address);
      expect(attr(html, /<meta property="og:url" content="([^"]+)">/)).toBe(address);
      const title = attr(html, /<title>([^<]+)<\/title>/);
      expect(title).not.toBe('');
      expect(attr(html, /<meta property="og:title" content="([^"]+)">/)).toBe(title);
      expect(attr(html, /<meta name="twitter:title" content="([^"]+)">/)).toBe(title);
      expect(attr(html, /<meta name="twitter:description" content="([^"]+)">/)).not.toBe('');
      const image = attr(html, /<meta property="og:image" content="([^"]+)">/);
      expect(attr(html, /<meta name="twitter:image" content="([^"]+)">/)).toBe(image);
      expect(image.startsWith(`${SITE}/assets/`)).toBe(true);
      expect(existsSync(`website/dist/${new URL(image).pathname}`)).toBe(true);
    }
  });
  it('links between pages only where the page exists', () => {
    for (const name of [...PAGES, '404']) {
      const html = read(`${name}.html`);
      const local = [...html.matchAll(/(?:href|src)="([^"#?:]+)(?:\?[^"]*)?"/g)].map((m) => m[1]);
      for (const ref of local) {
        const path = ref.replace(/^\.?\//, '') || 'index';
        const file = /\.[a-z0-9]+$/.test(path) ? path : `${path}.html`;
        expect(existsSync(`website/dist/${file}`), `${name}.html → ${ref}`).toBe(true);
      }
      for (const [, id] of html.matchAll(/href="#([\w-]+)"/g))
        expect(html.includes(`id="${id}"`), `${name}.html → #${id}`).toBe(true);
    }
  });
  it('lists every page in the sitemap and points robots at it', () => {
    const sitemap = read('sitemap.xml');
    const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(PAGES.map((name) => (name === 'index' ? `${SITE}/` : `${SITE}/${name}`)).sort());
    expect(read('robots.txt')).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(read('404.html')).toContain('<meta name="robots" content="noindex">');
  });
  it('shows the free tools and the maintainer tools on the home page', () => {
    const home = read('index.html');
    for (const link of ['href="issues"', 'href="repos"', 'href="wrapped"', 'href="#tools"', 'id="maintainers"'])
      expect(home).toContain(link);
  });
});
