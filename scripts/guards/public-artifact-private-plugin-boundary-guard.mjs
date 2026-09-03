import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_HOST_ARTIFACTS = [
  'dist/main/main.cjs',
  'dist/main/app-server-backend.cjs',
];

const FORBIDDEN_HOST_ARTIFACT_FRAGMENTS = [
  'packages/plugins/sheet/src',
  'packages/plugins/supplystrata/src',
  'SHEET_BACKEND_AVAILABLE = true',
  'SUPPLYSTRATA_BACKEND_AVAILABLE = true',
  'SupplystrataStartResearchTool',
  // 根 package.json 若被 runtime import，esbuild 会把整份 scripts 一并内联。
  'test:conversation-semantic-gate',
];

export function analyzePublicHostArtifact(relativePath, content) {
  return FORBIDDEN_HOST_ARTIFACT_FRAGMENTS
    .filter(fragment => content.includes(fragment))
    .map(fragment => ({ file: relativePath, fragment }));
}

export function runPublicArtifactPrivatePluginBoundaryGuard(repoRoot = process.cwd()) {
  return DEFAULT_HOST_ARTIFACTS.flatMap(relativePath => {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`公开 Host 产物边界门禁缺少构建产物: ${relativePath}`);
    }
    return analyzePublicHostArtifact(relativePath, fs.readFileSync(absolutePath, 'utf8'));
  });
}

function main() {
  const violations = runPublicArtifactPrivatePluginBoundaryGuard();
  if (violations.length === 0) {
    console.log('Public Host artifact/private plugin boundary guard passed');
    return;
  }

  console.error('公开 Host bundle 禁止内联私有插件实现或根 package.json：');
  for (const violation of violations) {
    console.error(`  ${violation.file}: ${violation.fragment}`);
  }
  process.exitCode = 1;
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  main();
}
