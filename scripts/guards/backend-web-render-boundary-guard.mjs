import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backendBundlePath = path.join(repoRoot, 'dist', 'main', 'app-server-backend.cjs');
const backendBundle = fs.readFileSync(backendBundlePath, 'utf8');
const forbiddenRenderRuntimeSymbols = [
  'WebPageRenderWorker',
  'WebPageRenderManager',
  'electronWebPageRenderRuntime',
  'installWebPageRendererAdapter',
];
const leakedSymbols = forbiddenRenderRuntimeSymbols.filter((symbol) => backendBundle.includes(symbol));

if (leakedSymbols.length > 0) {
  console.error(
    '[backend-web-render-boundary-guard] Electron 网页渲染实现泄漏进 backend bundle：'
      + leakedSymbols.join(', '),
  );
  console.error(
    '[backend-web-render-boundary-guard] backend 只能包含 WebPageRenderer contract/port，具体实现必须留在 main.cjs。',
  );
  process.exit(1);
}

console.log('[backend-web-render-boundary-guard] Web 渲染实现仅存在于 Electron main bundle。');
