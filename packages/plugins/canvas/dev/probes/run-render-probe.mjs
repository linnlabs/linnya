import { build } from 'esbuild';
import electron from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const probeRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(probeRoot, '../../../../..');
const output = path.join(repositoryRoot, '_dev_data/canvas-render-probe');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [path.join(probeRoot, 'renderer.ts')],
  outfile: path.join(output, 'renderer.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"' },
});
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><script src="renderer.js"></script></body></html>');
await build({
  entryPoints: [path.join(probeRoot, 'electron.ts')],
  outfile: path.join(output, 'electron.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
const child = spawn(electron, [path.join(output, 'electron.cjs'), output], { stdio: 'inherit' });
child.once('error', (error) => { console.error(error); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
