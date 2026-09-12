import { defineConfig } from 'tsup';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// 与 CJS launcher 共用同一指纹算法；保持原生加载，避免配置打包器改写 Node require。
const { createCliSourceFingerprint }: typeof import('./build/sourceFingerprint.cjs') =
  createRequire(import.meta.url)('./build/sourceFingerprint.cjs');

const cliRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceHash = createCliSourceFingerprint(cliRoot);

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
  define: { __LINNYA_CLI_BUILD_ID__: JSON.stringify(sourceHash) },
  async onSuccess() {
    if (createCliSourceFingerprint(cliRoot) !== sourceHash) {
      throw new Error('CLI sources changed during build; build again before using the bundle.');
    }
    const bundle = readFileSync(path.join(cliRoot, 'dist/cli.cjs'));
    writeFileSync(path.join(cliRoot, 'dist/build.json'), `${JSON.stringify({
      schema_version: 1,
      source_sha256: sourceHash,
      bundle_sha256: createHash('sha256').update(bundle).digest('hex'),
    }, null, 2)}\n`);
  },
});
