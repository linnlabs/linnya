import { build } from 'esbuild';
import electron from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildProbeRenderer } from './build-probe-renderer.mjs';

const probeRoot = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(probeRoot, '../../../../..');
const output = path.join(root, '_dev_data', `document-preview-parity-${Date.now()}`);
await mkdir(output, { recursive: true });
for (const environment of ['worker', 'host']) {
  const directory = path.join(output, environment); await mkdir(directory);
  await buildProbeRenderer({ entry: path.join(probeRoot, environment === 'host' ? 'previewParityHostRenderer.ts' : 'previewParityRenderer.ts'), root, output: directory });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src data: blob:; font-src \'self\' data: blob:"><link rel="stylesheet" href="renderer.css"></head><body><script src="renderer.js"></script></body></html>');
}
await build({ entryPoints: [path.join(probeRoot, 'previewParityElectron.ts')], outfile: path.join(output, 'electron.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
console.log(`[preview parity] ${output}`);
const child = spawn(electron, [path.join(output, 'electron.cjs'), output], { stdio: 'inherit' });
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
