import { createHash } from 'node:crypto';

import type {
  ArtifactContentBom,
  ArtifactBuildEnvironment,
  ArtifactContentCategory,
  ArtifactContentEntry,
  ArtifactContentIdentity,
  ArtifactContentScope,
  ArtifactEnvelopeDescriptor,
  ArtifactSourceIdentity,
} from '../definitions/artifactContentBom';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SHA512_PATTERN = /^[a-f0-9]{128}$/u;

export function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function sha512Hex(content: Buffer | string): string {
  return createHash('sha512').update(content).digest('hex');
}

export function normalizeArtifactPath(rawPath: string): string {
  const slashPath = rawPath.replaceAll('\\', '/');
  if (slashPath.startsWith('/') || /^[a-z]:\//iu.test(slashPath)) {
    throw new Error(`artifact 内容路径不能是绝对路径：${rawPath}`);
  }
  const normalized = slashPath.replace(/^\.\//u, '');
  if (
    !normalized ||
    normalized.endsWith('/') ||
    normalized
      .split('/')
      .some(segment => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error(`artifact 内容路径无效：${rawPath}`);
  }
  return normalized;
}

export function classifyPluginArtifactPath(rawPath: string): ArtifactContentCategory {
  const artifactPath = normalizeArtifactPath(rawPath);
  if (artifactPath === 'plugin.json') return 'plugin-manifest';
  if (artifactPath === 'SHA512SUMS') return 'checksum';
  if (artifactPath.startsWith('dist/backend/')) return 'plugin-backend-runtime';
  if (artifactPath.startsWith('dist/renderer/')) return 'plugin-renderer-runtime';
  if (artifactPath.startsWith('dist/cli/')) return 'plugin-command-runtime';
  if (artifactPath.startsWith('resources/')) return 'plugin-resource';
  return 'plugin-asset';
}

export function classifyDesktopArtifactPath(
  rawPath: string,
  scope: Extract<ArtifactContentScope, 'app-asar' | 'app-filesystem'>
): ArtifactContentCategory {
  const artifactPath = normalizeArtifactPath(rawPath);
  const lowerPath = artifactPath.toLowerCase();
  if (scope === 'app-asar') {
    if (lowerPath.startsWith('node_modules/')) return 'production-dependency';
    return 'application-code';
  }
  const unpackedMarker = 'resources/app.asar.unpacked/';
  const unpackedMarkerIndex = lowerPath.indexOf(unpackedMarker);
  if (unpackedMarkerIndex === 0 || lowerPath[unpackedMarkerIndex - 1] === '/') {
    // 中文说明：asar.unpacked 只是 app.asar 中相同逻辑路径的物理落盘副本，owner
    // 仍由其内部路径决定。若把它们统称为 application-resource，原生 npm runtime
    // 会绕过后续 artifact package/license 归因。
    const unpackedPath = lowerPath.slice(unpackedMarkerIndex + unpackedMarker.length);
    if (unpackedPath.startsWith('node_modules/')) return 'production-dependency';
    return 'application-code';
  }
  if (lowerPath.includes('/resources/plugins/') || lowerPath.startsWith('resources/plugins/')) {
    return 'plugin-resource';
  }
  if (
    lowerPath.includes('/resources/bin/') ||
    lowerPath.includes('/resources/headless-node-runtime/') ||
    lowerPath.includes('/resources/command-runtime/') ||
    lowerPath.startsWith('resources/bin/') ||
    lowerPath.startsWith('resources/headless-node-runtime/') ||
    lowerPath.startsWith('resources/command-runtime/')
  ) {
    return 'bundled-runtime';
  }
  if (lowerPath.endsWith('/third_party_notices.txt') || lowerPath === 'third_party_notices.txt') {
    return 'legal-notice';
  }
  if (lowerPath.includes('/frameworks/') || lowerPath.startsWith('locales/')) {
    return 'electron-runtime';
  }
  if (lowerPath.includes('/macos/') || (!lowerPath.includes('/') && lowerPath.endsWith('.exe'))) {
    return 'application-binary';
  }
  if (lowerPath.endsWith('/app.asar') || lowerPath === 'resources/app.asar') {
    return 'application-code';
  }
  return 'application-resource';
}

function compareEntries(left: ArtifactContentEntry, right: ArtifactContentEntry): number {
  return (
    left.scope.localeCompare(right.scope) ||
    left.path.localeCompare(right.path) ||
    left.type.localeCompare(right.type)
  );
}

function assertEntry(entry: ArtifactContentEntry): void {
  normalizeArtifactPath(entry.path);
  if (entry.type === 'file') {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`artifact 文件大小无效：${entry.scope}:${entry.path}`);
    }
    if (!SHA256_PATTERN.test(entry.sha256)) {
      throw new Error(`artifact 文件 SHA-256 无效：${entry.scope}:${entry.path}`);
    }
    return;
  }
  if (!entry.target || entry.target.includes('\\') || entry.target.startsWith('/')) {
    throw new Error(`artifact 符号链接目标无效：${entry.scope}:${entry.path}`);
  }
}

function assertEnvelope(artifact: ArtifactEnvelopeDescriptor): void {
  if (artifact.fileName.includes('/') || artifact.fileName.includes('\\')) {
    throw new Error(`发行制品必须只记录文件名：${artifact.fileName}`);
  }
  if (!Number.isSafeInteger(artifact.size) || artifact.size < 0) {
    throw new Error(`发行制品大小无效：${artifact.fileName}`);
  }
  if (!SHA256_PATTERN.test(artifact.sha256) || !SHA512_PATTERN.test(artifact.sha512)) {
    throw new Error(`发行制品 hash 无效：${artifact.fileName}`);
  }
}

export function createArtifactContentBom(input: {
  readonly artifacts: readonly ArtifactEnvelopeDescriptor[];
  readonly entries: readonly ArtifactContentEntry[];
  readonly environment: ArtifactBuildEnvironment;
  readonly identity: ArtifactContentIdentity;
  readonly kind: ArtifactContentBom['kind'];
  readonly source: ArtifactSourceIdentity;
}): ArtifactContentBom {
  if (!input.identity.name || !input.identity.version) {
    throw new Error('artifact BOM 缺少名称或版本');
  }
  if (
    !input.environment.nodeVersion ||
    !input.environment.platform ||
    !input.environment.architecture
  ) {
    throw new Error('artifact BOM 缺少构建环境');
  }
  if (!/^[a-f0-9]{40}$/u.test(input.source.revision)) {
    throw new Error(`artifact BOM source revision 无效：${input.source.revision}`);
  }
  input.artifacts.forEach(assertEnvelope);
  input.entries.forEach(assertEntry);

  const entries = [...input.entries].sort(compareEntries);
  const entryKeys = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.scope}:${entry.path}`;
    if (entryKeys.has(key)) throw new Error(`artifact BOM 存在重复内容路径：${key}`);
    entryKeys.add(key);
  }
  const artifacts = [...input.artifacts].sort((left, right) =>
    left.fileName.localeCompare(right.fileName)
  );
  const scopeCounts: Record<ArtifactContentScope, number> = {
    'app-asar': 0,
    'app-filesystem': 0,
    'plugin-archive': 0,
  };
  for (const entry of entries) scopeCounts[entry.scope] += 1;

  return {
    schemaVersion: 1,
    kind: input.kind,
    identity: input.identity,
    source: input.source,
    environment: input.environment,
    artifacts,
    summary: {
      fileCount: entries.filter(entry => entry.type === 'file').length,
      symlinkCount: entries.filter(entry => entry.type === 'symlink').length,
      fileSize: entries.reduce(
        (total, entry) => total + (entry.type === 'file' ? entry.size : 0),
        0
      ),
      scopeCounts,
      treeSha256: sha256Hex(JSON.stringify(entries)),
    },
    entries,
  };
}
