import { build } from 'esbuild';
import electron from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProbeRenderer } from './build-probe-renderer.mjs';

const probeRoot = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(probeRoot, '../../../../..');
const output = path.join(root, '_dev_data/canvas-identity-atlas-probe'); await mkdir(output, { recursive: true });
await buildProbeRenderer({ entry: path.join(probeRoot, 'identityAtlasRenderer.ts'), root, output });
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script src="renderer.js"></script></body></html>');
await build({ entryPoints: [path.join(probeRoot, 'identityAtlasElectron.ts')], outfile: path.join(output, 'electron.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const child = spawn(electron, [path.join(output, 'electron.cjs'), output], { stdio: 'inherit', env: { ...process.env,
  CANVAS_PROBE_SOURCE_COMMIT: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  CANVAS_PROBE_RENDERER_TREE: execFileSync('git', ['rev-parse', 'HEAD:packages/plugins/canvas/src/renderer'], { cwd: root, encoding: 'utf8' }).trim(),
  CANVAS_PROBE_SOURCE_DIRTY: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() ? '1' : '0' } });
child.once('error', error => { console.error(error); process.exitCode = 1; }); child.once('exit', code => { process.exitCode = code ?? 1; });
