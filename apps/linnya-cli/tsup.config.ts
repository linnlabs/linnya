import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/main.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  bundle: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  noExternal: ['@app/schemas', 'zod'],
});
