import { defineConfig } from 'vitest/config';
import { preactAlias } from './vite.content.config';

/** Extension pages (settings, preview) and the background worker. The content script has its own config. */
export default defineConfig({
  base: './',
  resolve: { alias: preactAlias },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { preview: 'index.html', settings: 'settings.html', background: 'src/background/index.ts' },
      output: { entryFileNames: '[name].js' },
    },
  },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts', 'mcp/tests/**/*.test.ts'] },
});
