import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'runtime-bindings': 'src/runtime-bindings.ts',
  },
  format: ['cjs', 'esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ['@app/schemas', /^@app\/schemas\//, 'zod'],
});
