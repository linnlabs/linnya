import { build } from 'esbuild';
import electron from 'electron';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const probeRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(probeRoot, '../../../../..');
const output = path.join(root, '_dev_data/canvas-performance-probe');
await mkdir(output, { recursive: true });
await rm(path.join(output, 'results.json'), { force: true });
await build({ entryPoints: [path.join(probeRoot, 'performanceRenderer.ts')], outfile: path.join(output, 'renderer.js'),
  bundle: true, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
  tsconfig: path.join(root, 'packages/plugins/canvas/tsconfig.json') });
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><script src="renderer.js"></script></body></html>');
await build({ entryPoints: [path.join(probeRoot, 'performanceElectron.ts')], outfile: path.join(output, 'electron.cjs'),
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const child = spawn(electron, [path.join(output, 'electron.cjs'), output], { stdio: 'inherit', env: process.env });
child.once('error', (error) => { console.error(error); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
