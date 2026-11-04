import { build } from 'esbuild';
import electron from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { buildProbeRenderer } from './build-probe-renderer.mjs';

const probeRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(probeRoot, '../../../../..');
const stagingContextArm = process.env.CANVAS_PERFORMANCE_STAGING_CONTEXT_CONTROL;
if (stagingContextArm !== undefined && !['A', 'B'].includes(stagingContextArm)) throw new Error('staging_context_control_arm');
if (stagingContextArm && process.env.CANVAS_PERFORMANCE_BODY_TRACE !== '1') throw new Error('staging_context_control_requires_body_trace');
const output = path.join(root, stagingContextArm ? `_dev_data/canvas-body-context-${stagingContextArm}-diagnostic`
  : process.env.CANVAS_PERFORMANCE_BODY_TRACE === '1' ? '_dev_data/canvas-body-task-diagnostic'
  : process.env.CANVAS_PERFORMANCE_INPUT_TRACE === '1' ? '_dev_data/canvas-input-diagnostic'
  : process.env.CANVAS_PERFORMANCE_ZOOM_PAINT_TRACE === '1' ? '_dev_data/canvas-zoom-paint-diagnostic'
  : process.env.CANVAS_PERFORMANCE_PAINT_TRACE === '1' ? '_dev_data/canvas-paint-diagnostic'
  : process.env.CANVAS_PERFORMANCE_SOFTWARE === '1' ? '_dev_data/canvas-software-probe' : process.env.CANVAS_PERFORMANCE_OFFSCREEN === '1' ? '_dev_data/canvas-counts-probe' : '_dev_data/canvas-performance-probe');
if (stagingContextArm) {
  // A/B各自只运行一次；已有profile不能静默复用或覆盖首败。
  await mkdir(path.dirname(output), { recursive: true }); await mkdir(output);
} else await mkdir(output, { recursive: true });
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
