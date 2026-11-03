import { defineConfig } from 'tsup';

const common = {
format: ['cjs' as const], platform: 'node' as const, target: 'node24',
  outDir: 'dist/backend', clean: false, splitting: false, tsconfig: 'tsconfig.json',
  external: [/^@app\/schemas(?:\/|$)/, /^@plugin\/backend\//],
  noExternal: ['zod', 'fractional-indexing', '@linnya/markdown-document-core'],
  outExtension: () => ({ js: '.cjs' }),
};
export default defineConfig([
  { ...common, entry: { index: 'src/backend/index.ts' } },
  { ...common, entry: { 'canvas-computation-worker': 'src/backend/orchestration/canvasComputationWorker.ts' }, noExternal: [...common.noExternal, 'elkjs'] },
]);
