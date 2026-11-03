import { build } from 'esbuild';
import { build as buildVite } from 'vite';
import electron from 'electron';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const probeRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(probeRoot, '../..');
const root = path.resolve(packageRoot, '../../..');
await rm(path.join(root, '_dev_data/canvas-worker-smoke/results.json'), { force: true });
await buildVite({ configFile: path.join(packageRoot, 'vite.render-worker.config.mts') });
await build({ entryPoints: [path.join(packageRoot, 'src/backend/features/canvasRender/infrastructure/preload.ts')],
  outfile: path.join(packageRoot, 'dist/backend/render-worker-preload.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
  tsconfig: path.join(packageRoot, 'tsconfig.json') });
const output = path.join(root, '_dev_data/canvas-worker-smoke/worker-smoke.cjs');
await build({ entryPoints: [path.join(probeRoot, 'workerSmoke.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'], tsconfig: path.join(root, 'tsconfig.json') });
const child = spawn(electron, [output, root], { stdio: 'inherit' });
child.once('error', (error) => { console.error(error); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
