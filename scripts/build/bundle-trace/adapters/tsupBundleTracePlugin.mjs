import { createRequire } from 'node:module';
import path from 'node:path';

import {
  isBundleTraceEnabled,
  writeEsbuildBundleTrace,
} from '../functions/bundleBuildTrace.mjs';

const require = createRequire(import.meta.url);
const esbuildVersion = require('esbuild/package.json').version;
const tsupVersion = require('tsup/package.json').version;

/**
 * tsup 的 esbuild onEnd 早于最终文件写盘，因此这里只捕获 metafile；等 tsup
 * buildEnd 明确给出 writtenFiles 后再 hash 磁盘字节，不能用延时或重试猜生命周期。
 */
export function createTsupBundleTrace({ buildTarget, repositoryRoot }) {
  if (!isBundleTraceEnabled()) return { esbuildPlugins: [], plugins: [] };
  const pendingMetafiles = [];
  return {
    esbuildPlugins: [{
      name: `linnya-bundle-trace-capture-${buildTarget}`,
      setup(build) {
        build.onEnd(result => {
          if (result.errors.length === 0 && result.metafile) {
            pendingMetafiles.push(result.metafile);
          }
        });
      },
    }],
    plugins: [{
      name: `linnya-bundle-trace-${buildTarget}`,
      buildEnd({ writtenFiles }) {
        const format = this.format;
        const writtenPaths = new Set(
          writtenFiles.map(file => path.resolve(process.cwd(), file.name)),
        );
        const metafileIndex = pendingMetafiles.findIndex(candidate => (
          Object.keys(candidate.outputs).some(outputPath => (
            writtenPaths.has(path.resolve(process.cwd(), outputPath))
          ))
        ));
        const metafile = metafileIndex === -1 ? undefined : pendingMetafiles[metafileIndex];
        if (!metafile) {
          throw new Error(`tsup ${buildTarget}/${format} 没有生成 esbuild metafile`);
        }
        if (writtenFiles.length === 0) {
          throw new Error(`tsup ${buildTarget}/${format} 没有写入 bundle 文件`);
        }
        writeEsbuildBundleTrace({
          buildTarget,
          engineVersion: esbuildVersion,
          inputAttribution: 'build-graph',
          metafile,
          repositoryRoot,
          toolName: 'tsup',
          toolVersion: tsupVersion,
          workingDirectory: process.cwd(),
        });
        pendingMetafiles.splice(metafileIndex, 1);
      },
    }],
  };
}
