/**
 * 公开 package / app 对闭源插件源码的零边界门禁。
 *
 * 当前私有 monorepo 仍为迁移期开发真源，但已确认公开的 owner 必须能够独立于
 * Sheet / SupplyStrata 源码演进。Host 自身的存量耦合另走 catalog/artifact 迁移；
 * 已完成迁移的 Host 切片逐项加入精确门禁，不为其余债务建立 allowlist。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PublicPackagePrivatePluginViolation {
  readonly file: string;
  readonly reference: string;
}

const PUBLIC_OWNER_ROOTS = [
  'apps/linnya-benchmark',
  'apps/linnya-cli',
  'packages/linnkit-provider-ai-sdk',
  'packages/parser-wasm',
  'packages/plugin-host-contract',
  'packages/plugins/build',
  'packages/plugins/mindmap',
  'packages/plugins/slides',
  'packages/provider-catalog',
  'packages/renderer-ui',
  'packages/schemas',
  'packages/stream-markdown-parser',
  'packages/text-measurement-core',
] as const;

const MIGRATED_PUBLIC_HOST_FILES = [
  'apps/renderer/tsconfig.paths.generated.json',
  'scripts/build/renderer-module-resolution/definitions/rendererModuleResolutionCatalog.ts',
  'scripts/development/features/plugin-backend-composition/functions/discoverWorkspaceDiskBackendPlugins.mjs',
  'scripts/development/orchestration/buildWorkspaceDiskPluginBackends.mjs',
  'scripts/development/orchestration/startElectronDevelopment.mjs',
  'scripts/release/plugin-release-targets.mjs',
  'scripts/release/run-official-plugin-scripts.mjs',
  'src/app-hosts/linnya/plugin-registry/builtin/index.ts',
  'src/app-hosts/linnya/plugin-registry/builtin/platform-meta.ts',
  'src/app-hosts/linnya/plugin-registry/formatOwnershipCatalog.ts',
  'src/electron-main/app-server-runtime/functions/createAppServerProcessEnvironment.ts',
  'src/electron-main/ipc/handlers/plugins/plugins-ipc.ts',
  'src/electron-main/plugins/loader/pluginLayout.ts',
  'tsup.backend.config.ts',
  'vitest.renderer.config.ts',
] as const;

// Sheet 尚暂停迁移，因此根测试/类型配置当前只锁定已经完成外置的 SupplyStrata。
const SUPPLYSTRATA_MIGRATED_HOST_FILES = [
  'tsconfig.json',
  'vitest.config.ts',
] as const;

const SUPPLYSTRATA_PRIVATE_SOURCE_REFERENCES = [
  '@plugin/supplystrata',
  'packages/plugins/supplystrata',
] as const;

const PRIVATE_PLUGIN_SOURCE_REFERENCES = [
  ...SUPPLYSTRATA_PRIVATE_SOURCE_REFERENCES,
  '@plugin/sheet',
  'packages/plugins/sheet',
] as const;

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.vue',
  '.yaml',
  '.yml',
]);

const IGNORED_DIRECTORIES = new Set([
  'dist',
  'node_modules',
  'pkg',
  'pkg-node',
  'target',
]);

export function analyzePublicOwnerSourceForPrivatePluginReferences(
  relativePath: string,
  content: string,
): PublicPackagePrivatePluginViolation[] {
  return PRIVATE_PLUGIN_SOURCE_REFERENCES
    .filter(reference => content.includes(reference))
    .map(reference => ({ file: relativePath, reference }));
}

function collectAuditedFiles(directory: string, output: string[]): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectAuditedFiles(absolutePath, output);
      continue;
    }
    if (
      entry.isFile()
      && (entry.name === 'package.json' || SOURCE_EXTENSIONS.has(path.extname(entry.name)))
    ) {
      output.push(absolutePath);
    }
  }
}

export function runPublicPackagePrivatePluginBoundaryGuard(
  repoRoot = process.cwd(),
): PublicPackagePrivatePluginViolation[] {
  const files: string[] = [];
  for (const relativeRoot of PUBLIC_OWNER_ROOTS) {
    collectAuditedFiles(path.join(repoRoot, relativeRoot), files);
  }
  for (const relativeFile of MIGRATED_PUBLIC_HOST_FILES) {
    const absolutePath = path.join(repoRoot, relativeFile);
    if (fs.existsSync(absolutePath)) {
      files.push(absolutePath);
    }
  }

  const publicOwnerViolations = files.sort().flatMap(absolutePath => {
    const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
    return analyzePublicOwnerSourceForPrivatePluginReferences(
      relativePath,
      fs.readFileSync(absolutePath, 'utf8'),
    );
  });

  const migratedConfigViolations = SUPPLYSTRATA_MIGRATED_HOST_FILES.flatMap(relativePath => {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) return [];
    const content = fs.readFileSync(absolutePath, 'utf8');
    return SUPPLYSTRATA_PRIVATE_SOURCE_REFERENCES
      .filter(reference => content.includes(reference))
      .map(reference => ({ file: relativePath, reference }));
  });

  return [...publicOwnerViolations, ...migratedConfigViolations];
}

function main(): void {
  const violations = runPublicPackagePrivatePluginBoundaryGuard();
  if (violations.length === 0) {
    console.log('Public package/private plugin source boundary guard passed');
    return;
  }

  console.error('已确认公开的 package/app 禁止依赖 Sheet 或 SupplyStrata 私有源码：');
  for (const violation of violations) {
    console.error(`  ${violation.file}: ${violation.reference}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
