import { build } from 'esbuild';
import electron from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { buildProbeRenderer } from './build-probe-renderer.mjs';

const probeRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(probeRoot, '../../../../..');
const output = path.join(root, process.env.CANVAS_PERFORMANCE_PAINT_TRACE === '1' ? '_dev_data/canvas-paint-diagnostic'
  : process.env.CANVAS_PERFORMANCE_SOFTWARE === '1' ? '_dev_data/canvas-software-probe' : process.env.CANVAS_PERFORMANCE_OFFSCREEN === '1' ? '_dev_data/canvas-counts-probe' : '_dev_data/canvas-performance-probe');
await mkdir(output, { recursive: true });
await buildProbeRenderer({ entry: path.join(probeRoot, 'performanceRenderer.ts'), root, output });
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src data: blob:; font-src \'self\' data: blob:"><link rel="stylesheet" href="renderer.css"></head><body><script src="renderer.js"></script></body></html>');
await build({ entryPoints: [path.join(probeRoot, 'performanceElectron.ts')], outfile: path.join(output, 'electron.cjs'),
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const rendererTree = execFileSync('git', ['rev-parse', 'HEAD:packages/plugins/canvas/src/renderer'], { cwd: root, encoding: 'utf8' }).trim();
const sourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
const child = spawn(electron, [path.join(output, 'electron.cjs'), output], { stdio: 'inherit', env: { ...process.env, CANVAS_PROBE_SOURCE_COMMIT: sourceCommit, CANVAS_PROBE_RENDERER_TREE: rendererTree, CANVAS_PROBE_SOURCE_DIRTY: sourceDirty ? '1' : '0' } });
child.once('error', (error) => { console.error(error); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
