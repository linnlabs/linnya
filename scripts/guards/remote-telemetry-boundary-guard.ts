/**
 * 远程 telemetry 零基线门禁。
 *
 * 该门禁只负责锁住当前可机器证明的边界：已退役的行为埋点数据面不得恢复，
 * 常见远程 analytics/crash SDK 不得进入依赖图。它不能替代对原生 fetch、插件和
 * 安装包的完整网络审计。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface RemoteTelemetryViolation {
  readonly file: string;
  readonly detail: string;
  readonly reason: 'retired-analytics-surface' | 'remote-telemetry-dependency';
}

const DEPENDENCY_SECTIONS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
] as const;

const REMOTE_TELEMETRY_PACKAGE_PREFIXES = [
  '@amplitude/',
  '@rudderstack/',
  '@segment/',
  '@sentry/',
  'amplitude-js',
  'analytics-node',
  'mixpanel',
  'mixpanel-browser',
  'posthog-js',
  'posthog-node',
] as const;

const RETIRED_ANALYTICS_IDENTIFIERS = ['behavior_events', 'install_id'] as const;
const PRODUCTION_SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
]);
const IGNORED_DIRECTORIES = new Set(['__tests__', 'dist', 'node_modules']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRemoteTelemetryPackage(packageName: string): boolean {
  return REMOTE_TELEMETRY_PACKAGE_PREFIXES.some(
    prefix => packageName === prefix || packageName.startsWith(prefix)
  );
}

export function analyzePackageManifestForRemoteTelemetry(
  relativePath: string,
  manifest: unknown
): RemoteTelemetryViolation[] {
  if (!isRecord(manifest)) {
    return [
      {
        file: relativePath,
        detail: 'package manifest 不是 JSON object',
        reason: 'remote-telemetry-dependency',
      },
    ];
  }

  return DEPENDENCY_SECTIONS.flatMap(section => {
    const dependencies = manifest[section];
    if (!isRecord(dependencies)) return [];
    return Object.keys(dependencies)
      .filter(isRemoteTelemetryPackage)
      .map(packageName => ({
        file: relativePath,
        detail: `${section}: ${packageName}`,
        reason: 'remote-telemetry-dependency' as const,
      }));
  });
}

export function analyzeProductionSourceForRetiredAnalytics(
  relativePath: string,
  content: string
): RemoteTelemetryViolation[] {
  return RETIRED_ANALYTICS_IDENTIFIERS.filter(identifier => content.includes(identifier)).map(
    identifier => ({
      file: relativePath,
      detail: identifier,
      reason: 'retired-analytics-surface' as const,
    })
  );
}

function collectFiles(root: string, output: string[]): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectFiles(absolutePath, output);
    } else if (entry.isFile()) {
      output.push(absolutePath);
    }
  }
}

export function runRemoteTelemetryBoundaryGuard(
  repoRoot = process.cwd()
): RemoteTelemetryViolation[] {
  const files: string[] = [];
  for (const root of ['apps', 'cloud', 'packages', 'src']) {
    collectFiles(path.join(repoRoot, root), files);
  }

  return files.sort().flatMap(absolutePath => {
    const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
    if (path.basename(absolutePath) === 'package.json') {
      const manifest: unknown = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
      return analyzePackageManifestForRemoteTelemetry(relativePath, manifest);
    }
    if (!PRODUCTION_SOURCE_EXTENSIONS.has(path.extname(absolutePath))) return [];
    return analyzeProductionSourceForRetiredAnalytics(
      relativePath,
      fs.readFileSync(absolutePath, 'utf8')
    );
  });
}

function main(): void {
  const violations = runRemoteTelemetryBoundaryGuard();
  if (violations.length === 0) {
    console.log('Remote telemetry boundary guard passed');
    return;
  }

  console.error('远程 telemetry 零基线被突破；实现前必须先完成新的产品与隐私评审：');
  for (const violation of violations) {
    console.error(`  ${violation.file}: ${violation.detail}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
