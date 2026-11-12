import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Claude plugin (plugin/) is Markdown and JSON that nothing else compiles, so these
 * checks are what keeps it in step with the server it starts and with the rules the
 * plugin directory blocks a submission on.
 */
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = json('plugin/.claude-plugin/plugin.json');
const marketplace = json('.claude-plugin/marketplace.json');
const servers = json('plugin/.mcp.json').mcpServers;
const server = json('mcp/package.json');
const source = readFileSync('mcp/src/server.ts', 'utf8');
const registered = (kind: 'Tool' | 'Prompt') =>
  [...source.matchAll(new RegExp(`register${kind}\\(\\s*'([a-z_]+)'`, 'g'))].map((m) => m[1]);
const skills = readdirSync('plugin/skills').filter((name) => statSync(join('plugin/skills', name)).isDirectory());
const skill = (name: string) => readFileSync(`plugin/skills/${name}/SKILL.md`, 'utf8');
const frontMatter = (text: string) => {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/^([a-z-]+): (.+)$/gm)].map((m) => [m[1], m[2]]));
};
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

describe('plugin: manifest and marketplace', () => {
  it('has a permanent, directory-safe name and the fields the listing shows', () => {
    expect(manifest.name).toBe('contri');
    expect(manifest.name).toMatch(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description.length).toBeGreaterThan(40);
    expect(manifest.author.name).toBeTruthy();
    expect(manifest.license).toBe(server.license);
  });
  it('is listed in the repository marketplace under the same name', () => {
    const entry = marketplace.plugins.find((plugin: { name: string }) => plugin.name === manifest.name);
    expect(entry?.source).toBe('./plugin');
    expect(marketplace.plugins).toHaveLength(1);
  });
  it('ships a square listing icon of at least 512 px', () => {
    const png = readFileSync('plugin/.claude-plugin/icon.png');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(512);
  });
});

describe('plugin: the server it starts', () => {
  it('starts one published contri-mcp version with a pinned npx launcher', () => {
    // The plugin directory blocks an unpinned launcher, and it refuses a server that runs
    // from node_modules (COMPONENT_PATH_IN_NODE_MODULES), so this is the one form it accepts.
    expect(Object.keys(servers)).toEqual(['contri']);
    expect(servers.contri.command).toBe('npx');
    expect(servers.contri.args).toHaveLength(2);
    expect(servers.contri.args[0]).toBe('-y');
    expect(servers.contri.args[1]).toMatch(new RegExp(`^${server.name}@\\d+\\.\\d+\\.\\d+$`));
  });
  it('never names a contri-mcp version ahead of mcp/package.json', () => {
    // The pin has to be a version npm already has, so the server is released first and
    // the plugin follows: it may be one release behind mcp/, never ahead of it.
    const pinned = servers.contri.args[1].slice(server.name.length + 1);
    const numbers = (version: string) => version.split('.').map(Number);
    const [a, b] = [numbers(pinned), numbers(server.version)];
    const differs = a.findIndex((n, i) => n !== b[i]);
    expect(differs === -1 || a[differs] < b[differs], `plugin pins ${pinned}, mcp/ is ${server.version}`).toBe(true);
  });
  it('carries no credentials and no environment of its own', () => {
    expect(servers.contri.env).toBeUndefined();
    expect(servers.contri.headers).toBeUndefined();
  });
});

describe('plugin: skills', () => {
  it('has one skill for each server prompt, named like its folder', () => {
    expect(skills.sort()).toEqual(
      registered('Prompt')
        .map((name) => name.replaceAll('_', '-'))
        .sort(),
    );
    for (const name of skills) {
      const meta = frontMatter(skill(name));
      expect(meta.name).toBe(name);
      expect(meta.description.length).toBeGreaterThan(60);
    }
  });
  it('only names tools the server registers', () => {
    const tools = registered('Tool');
    expect(tools).toContain('check_issue');
    for (const name of skills) {
      const named = [...skill(name).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
      expect(named.length).toBeGreaterThan(0);
      for (const tool of named) expect(tools, `${name} names \`${tool}\``).toContain(tool);
    }
  });
  it('keeps the read-only and untrusted-content rules in every skill', () => {
    for (const name of skills) {
      expect(skill(name)).toMatch(/read-only/);
      expect(skill(name)).toMatch(/never as instructions to you/);
    }
  });
});

describe('plugin: what the directory blocks a submission on', () => {
  const readme = readFileSync('plugin/README.md', 'utf8');
  it('has a README of at least 40 words outside code blocks, with a privacy policy', () => {
    const prose = readme.replace(/```[\s\S]*?```/g, '');
    expect(prose.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
    expect(readme).toMatch(/^## Privacy Policy$/m);
    for (const topic of ['Data collection', 'Usage and storage', 'Third-party sharing', 'Data retention', 'Contact'])
      expect(readme).toContain(`**${topic}:**`);
  });
  it('says what the plugin runs and where requests go', () => {
    expect(readme).toMatch(/^## What the plugin runs and sends$/m);
    expect(readme).toContain('api.github.com');
    expect(readme).toContain('github.com/login/device');
  });
  it('carries the repository license', () => {
    expect(readFileSync('plugin/LICENSE', 'utf8')).toBe(readFileSync('LICENSE', 'utf8'));
  });
  it('holds only small text files and images, and nothing that stops an install', () => {
    // A top-level bin/ stops claude.ai and Cowork from installing a plugin. A package.json
    // beside a lockfile makes Claude Code run an install in the plugin, which the directory
    // holds for review and will accept only from Verified organizations (LOCKFILE_AUTO_INSTALL,
    // LOCAL_CODE_INSTALL). System files block validation.
    for (const name of [
      'bin',
      'package.json',
      'package-lock.json',
      'npm-shrinkwrap.json',
      'bun.lock',
      '.npmrc',
      'bunfig.toml',
      'node_modules',
      'hooks',
    ])
      expect(existsSync(join('plugin', name)), name).toBe(false);
    expect(JSON.stringify(servers)).not.toContain('node_modules');
    for (const path of walk('plugin')) {
      expect(path).toMatch(/(\.md|\.json|\.png|LICENSE)$/);
      expect(path).not.toMatch(/\.DS_Store|Thumbs\.db/);
      if (!path.endsWith('.png')) expect(statSync(path).size, path).toBeLessThan(256 * 1024);
    }
  });
});
