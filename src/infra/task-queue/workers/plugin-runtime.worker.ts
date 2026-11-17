import { createRequire, registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workerData } from 'node:worker_threads';
import { WORKER_HOST_DATA_KEY } from '../definitions/workerHostData';
import { createScopedHostModuleResolution } from '../../../shared/host-module-resolution/functions/createScopedHostModuleResolution';

// Host 随包入口先安装解析，再求值插件。Node 24 的同步 resolve 同时覆盖 CJS 与动态 ESM。
// 传递依赖仍由原包目录解析；不为插件开放任意 package 子路径。
const specifiers = new Set([
  'better-sqlite3', 'sharp', '@napi-rs/canvas',
  'pdfjs-dist/package.json', 'pdfjs-dist/legacy/build/pdf.mjs',
  '@node-rs/jieba', '@node-rs/jieba/dict',
]);
const data: unknown = workerData;
if (typeof data !== 'object' || data === null || !(WORKER_HOST_DATA_KEY in data)) {
  throw new Error('插件 Worker 缺少 Host 运行身份');
}
const host = data[WORKER_HOST_DATA_KEY];
if (typeof host !== 'object' || host === null || !('pluginRuntime' in host)) {
  throw new Error('插件 Worker 缺少 Host 运行身份');
}
const runtime = host.pluginRuntime;
if (typeof runtime !== 'object' || runtime === null ||
    !('artifactDirectory' in runtime) || typeof runtime.artifactDirectory !== 'string' ||
    !('entryPath' in runtime) || typeof runtime.entryPath !== 'string') {
  throw new Error('插件 Worker Host 运行身份无效');
}
const resolveHostModule = createScopedHostModuleResolution({
  artifactDirectory: runtime.artifactDirectory,
  // 该文件始终属于 Host dist；不是业务 job 传入的依赖目录，也不由 cwd/env 推断。
  hostModuleAnchor: __filename,
  specifiers,
});
registerHooks({
  resolve(specifier, context, nextResolve) {
    const parentFilename = context.parentURL?.startsWith('file:')
      ? fileURLToPath(context.parentURL) : undefined;
    const resolved = resolveHostModule(specifier, parentFilename);
    return resolved ? { url: pathToFileURL(resolved).href, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
createRequire(__filename)(runtime.entryPath);
