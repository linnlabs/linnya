import { createRequire } from 'node:module';
import path from 'node:path';

import { writeViteBundleTrace } from '../functions/bundleBuildTrace.mjs';

const require = createRequire(import.meta.url);
const viteEntryPath = require.resolve('vite');
const viteVersion = require(path.resolve(path.dirname(viteEntryPath), '../../package.json')).version;

export function createViteBundleTracePlugin({ buildTarget, repositoryRoot }) {
  return {
    name: `linnya-bundle-trace-${buildTarget}`,
    apply: 'build',
    writeBundle(outputOptions, bundle) {
      const outputDirectory = outputOptions.dir
        ? path.resolve(outputOptions.dir)
        : path.dirname(path.resolve(outputOptions.file));
      writeViteBundleTrace({
        buildTarget,
        buildInputs: [...this.getModuleIds()],
        outputDirectory,
        outputs: bundle,
        repositoryRoot,
        toolVersion: viteVersion,
        workingDirectory: process.cwd(),
      });
    },
  };
}
