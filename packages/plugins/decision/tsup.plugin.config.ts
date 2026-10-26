import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/backend/index.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist/backend',
  clean: true,
  splitting: false,
  tsconfig: 'tsconfig.json',
  external: ['@app/schemas', /^@plugin\/backend\//],
  noExternal: ['zod'],
  outExtension: () => ({ js: '.cjs' }),
});
