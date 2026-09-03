import { defineConfig } from 'tsup';

import { createTsupBundleTrace } from './scripts/build/bundle-trace/adapters/tsupBundleTracePlugin.mjs';

const bundleTrace = createTsupBundleTrace({
  buildTarget: 'desktop/sandbox-runner',
  repositoryRoot: import.meta.dirname,
});

export default defineConfig({
  entry: {
    sandboxUtilityProcess:
      'src/infra/adapters/sandbox-runtime/local-process/child/sandboxUtilityProcess.ts',
    sandboxEvaluatorProcess:
      'src/infra/adapters/sandbox-runtime/local-process/evaluator/sandboxEvaluatorProcess.ts',
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist/main/sandbox',
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  noExternal: ['zod'],
  esbuildPlugins: bundleTrace.esbuildPlugins,
  plugins: bundleTrace.plugins,
});
