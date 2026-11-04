import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareCanvasCliObservation } from '../prepare';

it('实际CJS外壳只装饰named contribution，原factory/exports/非CLI引用及相邻payload保持不变，正常exit封存', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'canvas-observer-artifact-'));
  try {
    const production = path.join(root, 'production'), output = path.join(root, 'observed'), evidence = path.join(root, 'evidence');
    mkdirSync(path.join(production, 'dist/backend'), { recursive: true }); mkdirSync(path.join(production, 'resources'));
    const original = `const result={exitCode:8,stdout:'original\\r\\n',stderr:'original stderr'};
const cli={prepare(){return {status:'completed',result};}};
const backendPlugin={meta:{id:'canvas'},pluginCli:cli,runtimeEffects:[],hiddenWorkers:[],ipc:{},ownedTables:[]};
exports.backendPlugin=backendPlugin;exports.createCanvasBackendPlugin=()=>backendPlugin;exports.originalDirectory=__dirname;`;
    writeFileSync(path.join(production, 'plugin.json'), '{}'); writeFileSync(path.join(production, 'dist/backend/index.cjs'), original);
    writeFileSync(path.join(production, 'dist/backend/worker.cjs'), 'original worker');
    writeFileSync(path.join(production, 'resources/skill.txt'), 'original skill');
    const built = await prepareCanvasCliObservation({ productionPluginDirectory: production, outputDirectory: output, evidenceDirectory: evidence,
      productionSourceRevision: 'a'.repeat(40), observationSourceRevision: 'b'.repeat(40) });
    expect(readFileSync(path.join(production, 'dist/backend/index.cjs'), 'utf8')).toBe(original);
    expect(readFileSync(path.join(output, 'dist/backend/index.production.cjs'), 'utf8')).toBe(original);
    expect(readFileSync(path.join(output, 'dist/backend/worker.cjs'), 'utf8')).toBe('original worker');
    expect(Object.keys(built.metafile?.inputs ?? {}).some(file => file.includes('src/backend'))).toBe(false);
    const stdout = execFileSync(process.execPath, ['-e', `const path=require('node:path');const root=process.argv[1];
const original=require(path.join(root,'dist/backend/index.production.cjs'));const observed=require(path.join(root,'dist/backend/index.cjs'));
for(const key of Object.keys(original))if(key!=='backendPlugin'&&observed[key]!==original[key])throw Error('module_export_changed');
for(const key of Object.keys(original.backendPlugin))if(key!=='pluginCli'&&observed.backendPlugin[key]!==original.backendPlugin[key])throw Error('contribution_changed');
if(observed.backendPlugin.pluginCli===original.backendPlugin.pluginCli)throw Error('cli_not_observed');
const a=original.backendPlugin.pluginCli.prepare({});const b=observed.backendPlugin.pluginCli.prepare({argv:['help'],invocationId:'i',conversationRoot:'/conversation'});
if(a.result!==b.result)throw Error('result_changed');if(original.originalDirectory!==require('node:fs').realpathSync(path.join(root,'dist/backend')))throw Error('dirname_changed');
process.stdout.write('references-preserved');`, output], { encoding: 'utf8' });
    expect(stdout).toBe('references-preserved');
    const seal: unknown = JSON.parse(readFileSync(path.join(evidence, 'seal.json'), 'utf8')); expect(seal).toMatchObject({ status: 'complete', exitCode: 0, invocations: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
