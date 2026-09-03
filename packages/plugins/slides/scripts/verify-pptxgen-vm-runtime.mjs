import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const packageRequire = createRequire(import.meta.url);
const entryPath = packageRequire.resolve('pptxgenjs');
const source = await readFile(entryPath, 'utf8');
const wrapperSource = `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`;

// Electron 的主进程字节码链通过 vm cached data 恢复 CommonJS。这里复现同一约束：
// 被恢复的脚本没有 importModuleDynamically callback，依赖若偷偷动态 import 会直接失败。
const compiler = new vm.Script(wrapperSource, {
  filename: entryPath,
  produceCachedData: true,
});
const cachedData = compiler.createCachedData();
const restored = new vm.Script(wrapperSource, {
  cachedData,
  filename: entryPath,
});
if (restored.cachedDataRejected) {
  throw new Error('PptxGenJS VM smoke rejected freshly generated cached data.');
}

const moduleRecord = { exports: {} };
const factory = restored.runInThisContext();
factory(
  moduleRecord.exports,
  createRequire(entryPath),
  moduleRecord,
  entryPath,
  path.dirname(entryPath),
);

const exported = moduleRecord.exports;
const PptxGenJS = exported && typeof exported === 'object' && 'default' in exported
  ? exported.default
  : exported;
if (typeof PptxGenJS !== 'function') {
  throw new Error('PptxGenJS VM smoke did not load a constructor.');
}

const presentation = new PptxGenJS();
presentation.layout = 'LAYOUT_WIDE';
presentation.addSlide().addText('VM runtime smoke', { x: 1, y: 1, w: 4, h: 1 });
const output = await presentation.write({ outputType: 'nodebuffer' });
if (!Buffer.isBuffer(output) || output.length === 0) {
  throw new Error('PptxGenJS VM smoke did not produce a non-empty Node buffer.');
}

// 未 await 的 rejected promise 要到下一轮 microtask/事件循环才会成为进程错误。
await new Promise(resolve => setImmediate(resolve));
process.stdout.write(`[pptxgen-vm] runtime smoke passed: ${output.length} bytes\n`);
