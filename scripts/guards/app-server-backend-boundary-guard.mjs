import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const entryPath = path.join(root, 'dist', 'main', 'app-server-entry.cjs');
const backendPath = path.join(root, 'dist', 'main', 'app-server-backend.cjs');
const entry = fs.readFileSync(entryPath, 'utf8');
const backend = fs.readFileSync(backendPath, 'utf8');

if (Buffer.byteLength(entry, 'utf8') > 64 * 1024) {
  throw new Error('App Server tiny entry 超过 64 KiB，可能在 console 重定向前加载了 Backend');
}
const consoleBoundary = entry.indexOf('Object.defineProperty(globalThis, "console"');
const backendLoad = entry.indexOf('app-server-backend.cjs');
if (consoleBoundary < 0 || backendLoad < 0 || consoleBoundary > backendLoad) {
  throw new Error('App Server tiny entry 必须先固定 stderr console，再加载 Backend bundle');
}
if (/require\(["']electron["']\)/u.test(backend)) {
  throw new Error('App Server Backend bundle 不得加载 Electron runtime');
}
if (/ELECTRON_RUN_AS_NODE/u.test(entry)) {
  throw new Error('App Server entry 不得借 Electron executable 启动 Node 模式');
}
if (/process\.stdout/u.test(entry)) {
  throw new Error('App Server tiny entry 不得直接写 stdout');
}

console.log('[app-server-backend-boundary-guard] headless bundle、tiny entry 与 stdout 边界有效。');

