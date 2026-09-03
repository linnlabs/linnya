import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const applicationRoot = 'src/app-hosts/linnya/application/';
const legacyRoot = ['src', 'app-hosts', 'linnya', 'workflows'].join('/') + '/';
const guardPath = 'scripts/guards/application-layer-naming-guard.mjs';
const sourceExtensions = new Set(['.cjs', '.js', '.mjs', '.ts', '.tsx', '.vue']);
const referenceExtensions = new Set([...sourceExtensions, '.json', '.md', '.yaml', '.yml']);
const applicationFeatureNames = [
  'configured-model-removal',
  'conversation-control',
  'conversation-lifecycle',
  'custom-api-onboarding',
  'development-data-lifecycle',
  'document-assets',
  'document-image-assets',
  'document-svg-assets',
  'execution-audit-export',
  'file-link',
  'file-read',
  'image-generation',
  'model-picker',
  'ollama-onboarding',
  'plugin-cli-shell-bridge',
  'provider-account-authorization',
  'provider-configuration-migration',
  'provider-onboarding',
  'storage-space',
];
const legacyReferencePattern = new RegExp(
  `workflows/(?:${applicationFeatureNames.join('|')})(?:/|['\"\`])`,
  'u',
);
const trackedAndUntrackedFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: repoRoot, encoding: 'utf8' },
).split('\n').filter(relativePath => (
  relativePath.length > 0
  // staged / working-tree deletions仍存在于 index；命名守卫只审计实际会保留的文件。
  && fs.existsSync(path.join(repoRoot, relativePath))
));

const violations = [];

for (const relativePath of trackedAndUntrackedFiles) {
  if (relativePath.startsWith(legacyRoot)) {
    violations.push(`${relativePath}: 旧 application-layer 目录不得恢复`);
    continue;
  }
  const extension = path.extname(relativePath);
  if (relativePath !== guardPath && referenceExtensions.has(extension)) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    if (source.includes(legacyRoot) || legacyReferencePattern.test(source)) {
      violations.push(`${relativePath}: 仍引用旧 application-layer 路径`);
    }
  }
  if (!relativePath.startsWith(applicationRoot) || !sourceExtensions.has(extension)) {
    continue;
  }
  if (/workflow/iu.test(relativePath)) {
    violations.push(`${relativePath}: application layer 文件名必须使用 UseCase 等准确语义`);
  }
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  if (/workflow/iu.test(source)) {
    violations.push(`${relativePath}: application layer 源码不得占用 Workflow 产品命名`);
  }
}

if (violations.length > 0) {
  process.stderr.write('[application-layer-naming-guard] 命名边界违规：\n');
  for (const violation of violations) process.stderr.write(`  - ${violation}\n`);
  process.exit(1);
}

process.stdout.write('[application-layer-naming-guard] application / UseCase 命名边界有效。\n');
