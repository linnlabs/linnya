import { build } from 'esbuild';
import electron from 'electron';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildProbeRenderer } from './build-probe-renderer.mjs';
import { readCanvasVisualDiagnostic } from './visualDiagnostic.ts';

const probeRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(probeRoot, '../../../../..');
// Node24的内置type stripping只读取这个无依赖纯入口；先拒绝未知模式，避免误覆盖完整suite证据。
const diagnostic = readCanvasVisualDiagnostic(process.env.CANVAS_VISUAL_DIAGNOSTIC, process.env.CANVAS_PERFORMANCE_SOFTWARE === '1');
const output = path.join(root, diagnostic ? '_dev_data/canvas-visual-software-line-diagnostic' : '_dev_data/canvas-visual-probe');
await mkdir(output, { recursive: !diagnostic });
await rm(path.join(output, 'results.json'), { force: true });
await buildProbeRenderer({ entry: path.join(probeRoot, 'visualRenderer.ts'), root, output });
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src data: blob:; font-src \'self\' data: blob:"><link rel="stylesheet" href="renderer.css"></head><body><script src="renderer.js"></script></body></html>');
await build({ entryPoints: [path.join(probeRoot, 'visualElectron.ts')], outfile: path.join(output, 'electron.cjs'),
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const child = spawn(electron, [path.join(output, 'electron.cjs'), output], { stdio: 'inherit' });
child.once('error', (error) => { console.error(error); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
