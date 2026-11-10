import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Bundles the action and the extension code it reuses (src/core, the reports) into
 * one dependency-free Node file. GitHub runs actions straight from the repository, so
 * `action/dist/index.js` is committed; CI fails if it is out of date.
 */
export default defineConfig({
  // The extension's public/ folder (icons, fonts, manifest) has no place in this bundle.
  publicDir: false,
  build: {
    ssr: here('src/index.ts'),
    outDir: here('dist'),
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: { external: [/^node:/], output: { entryFileNames: 'index.js' } },
  },
});
