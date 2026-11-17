import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import JSZip from 'jszip';

const packageRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(packageRoot, '../../..');
const manifest = JSON.parse(await readFile(path.join(packageRoot, 'plugin.json'), 'utf8'));
const zip = await JSZip.loadAsync(await readFile(path.join(packageRoot, 'dist/artifacts', `knowledge-${manifest.version}.zip`)));
const workerNames = ['knowledgeIngestion', 'graphExtraction', 'graphIndexing'];
const nativeDependencies = ['better-sqlite3', 'pdfjs-dist', '@napi-rs/canvas', '@node-rs/jieba', 'sharp'];
const files = Object.keys(zip.files).filter(file => !zip.files[file].dir);
const required = ['dist/backend/index.cjs', 'dist/renderer/index.js', 'dist/renderer/renderer-stylesheets.json',
  ...workerNames.map(name => `dist/backend/workers/${name}.worker.cjs`)];
for (const file of required) assert(zip.file(file), `artifact missing ${file}`);
assert(!files.some(file => /(?:^|\/)(?:src|dev|scripts|node_modules|\.metadata|__tests__)(?:\/|$)|\.map$/.test(file)), 'artifact contains development/source output');

const isBuiltin = value => builtinModules.includes(value.replace(/^node:/, ''));
const normalize = value => value.replaceAll('\\', '/');
const reports = [];
for (const name of ['index', ...workerNames]) {
  const worker = name !== 'index';
  const outputPath = worker ? `dist/backend/workers/${name}.worker.cjs` : 'dist/backend/index.cjs';
  const record = JSON.parse(await readFile(path.join(packageRoot, 'dist/.metadata', `${name}.json`), 'utf8'));
  const entry = Object.entries(record.metafile.outputs).find(([file]) => path.resolve(record.workingDirectory, file) === path.join(packageRoot, outputPath));
  assert(entry, `${name}: actual output metadata missing`);
  const output = entry[1];
  const actualBytes = (await stat(path.join(packageRoot, outputPath))).size;
  assert.equal(output.bytes, actualBytes, `${name}: stale output metadata`);
  assert.deepEqual(await zip.file(outputPath).async('nodebuffer'), await readFile(path.join(packageRoot, outputPath)), `${name}: artifact differs from built output`);
  const inputs = Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0)
    .map(([file]) => normalize(path.resolve(record.workingDirectory, file)));
  // Worker 只内联纯运行 SDK；不能把原 Host 知识库、模型目录、凭据或应用组合根一并搬入。
  for (const input of inputs) {
    assert(!/\/src\/(?:features\/knowledge-base\/|app-hosts\/|domains\/(?:model-catalog|model-inference)\/)/.test(input), `${name}: Host business implementation bundled: ${input}`);
    assert(!/\/src\/electron-main\/services\/database\.ts$/.test(input), `${name}: full Host database lifecycle bundled`);
  }
  for (const dependency of output.imports.filter(value => value.external)) {
    const permitted = isBuiltin(dependency.path) || (worker
      ? nativeDependencies.some(name => dependency.path === name || dependency.path.startsWith(`${name}/`))
      : /^(?:@app\/schemas(?:\/|$)|@plugin\/backend\/)/.test(dependency.path));
    assert(permitted, `${name}: unclosed runtime dependency ${dependency.path}`);
  }
  reports.push({ name, actualBytes, liveInputs: inputs.length });
}

// 共用校验负责 SHA512、Renderer CSS/external、manifest 和正式包清单；本包只补三个 Node Worker 的闭包。
execFileSync(process.execPath, [path.join(repositoryRoot, 'scripts/release/verify-plugin-artifact.mjs'), 'knowledge', '--require-renderer-assets'], {
  cwd: repositoryRoot, stdio: 'inherit',
});
console.log(JSON.stringify({ plugin: 'knowledge', artifactFiles: files.length, bundles: reports, passed: true }));
