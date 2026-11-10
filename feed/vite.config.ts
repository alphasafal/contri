import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Bundles the feed builder and the reports it reuses into one Node file (not committed; the workflow builds it). */
export default defineConfig({
  // The extension's public/ folder (icons, fonts, manifest) has no place in this bundle.
  publicDir: false,
  build: {
    ssr: here('src/main.ts'),
    outDir: here('dist'),
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: { external: [/^node:/], output: { entryFileNames: 'feed.js' } },
  },
});
