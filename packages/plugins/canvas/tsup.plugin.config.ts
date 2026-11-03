import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/backend/index.ts' }, format: ['cjs'], platform: 'node', target: 'node24',
  outDir: 'dist/backend', clean: false, splitting: false, tsconfig: 'tsconfig.json',
  external: [/^@app\/schemas(?:\/|$)/, /^@plugin\/backend\//],
  noExternal: ['zod', 'fractional-indexing', '@linnya/markdown-document-core'],
  outExtension: () => ({ js: '.cjs' }),
});
