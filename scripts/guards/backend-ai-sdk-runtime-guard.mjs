import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { findExternalProviderRuntimeRequires } from './functions/findExternalProviderRuntimeRequires.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backendBundlePath = path.join(repoRoot, 'dist', 'main', 'app-server-backend.cjs');
const backendBundle = fs.readFileSync(backendBundlePath, 'utf8');
const externalProviderRuntimeRequires = findExternalProviderRuntimeRequires(backendBundle);

if (externalProviderRuntimeRequires.length > 0) {
  console.error(
    '[backend-ai-sdk-runtime-guard] 后端 CJS bundle 遗留 AI SDK ESM 运行时 require：' +
      externalProviderRuntimeRequires.join(', ')
  );
  console.error(
    '[backend-ai-sdk-runtime-guard] App Server 使用 standalone Node CJS；AI SDK 必须在构建期内联转换。'
  );
  process.exit(1);
}

console.log('[backend-ai-sdk-runtime-guard] AI SDK 已内联到后端 CJS bundle。');
