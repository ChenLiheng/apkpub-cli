import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin/apkpub.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  dts: false,
  shims: true,
  external: ['keytar', 'app-info-parser'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
