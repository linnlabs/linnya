import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { CanvasCliObservationBuild } from './definitions';

interface Preparation {
  readonly productionPluginDirectory: string;
  readonly outputDirectory: string;
  readonly evidenceDirectory: string;
  readonly productionSourceRevision: string;
  readonly observationSourceRevision: string;
}

function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }

function filesBelow(directory: string, relative = ''): string[] {
  return readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap(entry => {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) return filesBelow(directory, child);
    if (entry.isFile()) return [child];
    throw new Error('cli_observation_artifact_requires_regular_files');
  });
}

/** 只生成独立开发制品；不覆写原plugin、不安装、不启动Backend或Worker。 */
export async function prepareCanvasCliObservation(input: Preparation) {
  const production = path.resolve(input.productionPluginDirectory), output = path.resolve(input.outputDirectory);
  if (!path.isAbsolute(input.evidenceDirectory) || existsSync(input.evidenceDirectory)) throw new Error('cli_observation_requires_fresh_absolute_evidence_directory');
  // 清单统一用POSIX相对路径；Windows的原生分隔符不能改变index识别或封存协议。
  const originalFiles = ['plugin.json', ...filesBelow(path.join(production, 'dist')).map(file => 'dist/' + file.split(path.sep).join('/')),
    ...filesBelow(path.join(production, 'resources')).map(file => 'resources/' + file.split(path.sep).join('/'))].sort();
  const payloads = originalFiles.map(file => {
    const bytes = readFileSync(path.join(production, file));
    return { originalPath: file, observedPath: file === 'dist/backend/index.cjs' ? 'dist/backend/index.production.cjs' : file,
      bytes: bytes.length, sha256: sha256(bytes) };
  });
  const originalBackend = payloads.find(file => file.originalPath === 'dist/backend/index.cjs');
  if (!originalBackend) throw new Error('cli_observation_original_backend_missing');
  if (payloads.some(file => file.originalPath === 'dist/backend/index.production.cjs')) throw new Error('cli_observation_requires_unobserved_backend');
  const payloadManifest = JSON.stringify({ productionSourceRevision: input.productionSourceRevision, payloads }, null, 2) + '\n';
  mkdirSync(output, { mode: 0o700 });
  for (const name of ['plugin.json', 'dist', 'resources']) cpSync(path.join(production, name), path.join(output, name), { recursive: true, force: false, errorOnExist: true });
  const backend = path.join(output, 'dist/backend');
  renameSync(path.join(backend, 'index.cjs'), path.join(backend, 'index.production.cjs'));
  writeFileSync(path.join(output, 'cli-observation-payloads.json'), payloadManifest, { flag: 'wx', mode: 0o600 });
  const config: CanvasCliObservationBuild = { evidenceDirectory: input.evidenceDirectory,
    observationSourceRevision: input.observationSourceRevision, productionSourceRevision: input.productionSourceRevision,
    originalBackendSha256: originalBackend.sha256, payloadManifestSha256: sha256(payloadManifest) };
  const entry = fileURLToPath(new URL('./entry.ts', import.meta.url));
  const result = await build({ entryPoints: [entry], outfile: path.join(backend, 'index.cjs'), bundle: true, platform: 'node', format: 'cjs',
    target: 'node24', metafile: true, define: { CANVAS_CLI_OBSERVATION_BUILD: JSON.stringify(config) },
    plugins: [{ name: 'canvas-observation-original-backend', setup(builder) {
      // 仅wrapper自己的typed入口外置；不重编译生产backend，不改其相对依赖和__dirname。
      builder.onResolve({ filter: /^\.\.\/\.\.\/\.\.\/src\/backend\/index$/ }, args => {
        if (args.importer !== entry) return;
        return { path: './index.production.cjs', external: true };
      });
    } }],
  });
  for (const payload of payloads) {
    if (sha256(readFileSync(path.join(output, payload.observedPath))) !== payload.sha256) throw new Error('cli_observation_original_payload_changed');
  }
  const wrapper = readFileSync(path.join(backend, 'index.cjs'));
  const manifest = { schemaVersion: 1, ...config, productionPluginDirectory: production, outputDirectory: output,
    originalBackendPath: 'dist/backend/index.production.cjs', wrapperPath: 'dist/backend/index.cjs', wrapperSha256: sha256(wrapper),
    originalModuleDirectoryUnchanged: true, copiedPayloadCount: payloads.length, metafile: result.metafile,
    installationPerformed: false, performanceQualification: 'observed-task-conservative-latency-only' };
  writeFileSync(path.join(output, 'cli-observation-build.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return manifest;
}
