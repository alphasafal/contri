import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Bundles the MCP server and the extension code it reuses (src/core, the
 * reports) into one Node file. The MCP SDK and zod stay npm dependencies.
 */
export default defineConfig({
  build: {
    ssr: here('src/index.ts'),
    outDir: here('dist'),
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      external: [/^@modelcontextprotocol\//, /^zod(\/|$)/, /^node:/],
      output: { entryFileNames: 'contri-mcp.js', banner: '#!/usr/bin/env node' },
    },
  },
  plugins: [
    {
      name: 'contri-license',
      closeBundle() {
        mkdirSync(here('dist'), { recursive: true });
        copyFileSync(here('../LICENSE'), here('dist/LICENSE'));
      },
    },
  ],
});
