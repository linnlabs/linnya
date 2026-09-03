import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backendBundlePath = path.join(repoRoot, 'dist', 'main', 'app-server-backend.cjs');
const backendBundle = fs.readFileSync(backendBundlePath, 'utf8');

const runtimeDomRequires = ['linkedom', 'css-select'].filter((packageName) => {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`require\\(["']${escapedName}["']\\)`).test(backendBundle);
});

if (runtimeDomRequires.length > 0) {
  console.error(
    '[backend-dom-runtime-guard] 后端 bundle 遗留 DOM 解析依赖的运行时 require：'
      + runtimeDomRequires.join(', '),
  );
  console.error(
    '[backend-dom-runtime-guard] standalone Node CJS 无法直接加载该纯 ESM 链；请保持 linkedom 内联。',
  );
  process.exit(1);
}

console.log('[backend-dom-runtime-guard] DOM 解析依赖已内联到后端 bundle。');
