import { readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Fails when a Markdown file links to or embeds a local file that does not exist
 * (e.g. a README image that was renamed). Raw GitHub URLs to this repo are checked too.
 */
const FILES = [
  'README.md',
  'CHANGELOG.md',
  'AGENTS.md',
  'mcp/README.md',
  'CONTRIBUTING.md',
  'PRIVACY.md',
  'SECURITY.md',
  'SUPPORT.md',
  'docs/METRICS.md',
  'docs/ARCHITECTURE.md',
  'docs/LAUNCH.md',
  'docs/RELEASE-CHECKLIST.md',
  'docs/STORE-SUBMISSION.md',
];
const RAW = /^https:\/\/raw\.githubusercontent\.com\/alphasafal\/contri\/main\//;
const missing = [];
for (const file of FILES) {
  const text = await readFile(file, 'utf8');
  const refs = [...text.matchAll(/(?:\]\(|src="|srcset="|href=")([^)"#\s]+)/g)].map((m) => m[1]);
  for (const ref of refs) {
    let path;
    if (RAW.test(ref)) path = ref.replace(RAW, '');
    else if (/^(https?:|mailto:|#)/.test(ref)) continue;
    else path = join(dirname(file), ref);
    try {
      await access(path);
    } catch {
      missing.push(`${file} → ${ref}`);
    }
  }
}
if (missing.length) {
  console.error(`Missing files referenced from docs:\n${missing.join('\n')}`);
  process.exit(1);
}
console.log(`Checked local links and images in ${FILES.length} documents.`);
