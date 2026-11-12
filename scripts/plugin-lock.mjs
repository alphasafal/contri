import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

/**
 * Points the Claude plugin at the contri-mcp version in mcp/package.json and rewrites
 * plugin/package-lock.json, which pins that package and everything it needs to exact
 * versions and hashes. Run it after the version is on npm: the lockfile records the hash
 * of the published package, so it cannot be written before the release.
 */
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const server = await read('mcp/package.json');
const manifest = await read('plugin/.claude-plugin/plugin.json');
const plugin = await read('plugin/package.json');

plugin.version = manifest.version;
plugin.dependencies = { [server.name]: server.version };
await writeFile('plugin/package.json', `${JSON.stringify(plugin, null, 2)}\n`);

try {
  execFileSync(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org/',
    ],
    { cwd: 'plugin', stdio: 'inherit', shell: process.platform === 'win32' },
  );
} catch {
  console.error(
    `\nCould not lock ${server.name}@${server.version}. Is that version on npm yet? Publish it first (push the mcp-v${server.version} tag), then run this again.`,
  );
  process.exit(1);
}

const lock = await read('plugin/package-lock.json');
const count = Object.keys(lock.packages).filter(Boolean).length;
console.log(
  `plugin ${manifest.version} now starts ${server.name}@${server.version}: ${count} packages locked in plugin/package-lock.json.`,
);
