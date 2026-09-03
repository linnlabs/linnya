import type { ArtifactContentBom, ArtifactContentEntry } from '../definitions/artifactContentBom';
import type {
  ArtifactPackageComponent,
  ArtifactPackageMap,
  ArtifactPackageMapLimitation,
} from '../definitions/artifactPackageMap';

interface JsonRecord {
  readonly [key: string]: unknown;
}

export interface ArtifactPackageManifestEvidence {
  readonly manifest: unknown;
  readonly packageJsonPath: string;
  readonly sha256: string;
}

interface ArtifactPackageManifest {
  readonly declaredLicense?: string;
  readonly identity: string;
  readonly name: string;
  readonly packageJsonSha256: string;
  readonly root: string;
  readonly version: string;
}

interface LockPackageIdentity {
  readonly identity: string;
  readonly installKind: 'registry' | 'workspace';
  readonly integrity?: string;
  readonly license?: string;
  readonly location: string;
  readonly name: string;
  readonly resolved?: string;
  readonly version: string;
}

const ASAR_UNPACKED_MARKER = 'resources/app.asar.unpacked/';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(record: JsonRecord, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} 缺少非空字符串 ${key}`);
  }
  return value;
}

function packageIdentity(name: string, version: string): string {
  return `${name}@${version}`;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}

function readPackageNameFromLockLocation(location: string): string | undefined {
  const segments = location.split('/');
  const nodeModulesIndex = segments.lastIndexOf('node_modules');
  if (nodeModulesIndex === -1) return undefined;
  const tail = segments.slice(nodeModulesIndex + 1);
  if (tail.length === 1 && tail[0]) return tail[0];
  if (tail.length === 2 && tail[0]?.startsWith('@') && tail[1]) return tail.join('/');
  return undefined;
}

/**
 * package 内部也可能存在 dist 子目录自己的 package.json。只有路径尾部与 manifest name
 * 精确对应时，才把它当成一个真正的 node_modules package 根。
 */
export function resolveCanonicalArtifactPackageRoot(
  packageJsonPath: string,
  packageName: string
): string | undefined {
  const suffix = '/package.json';
  if (!packageJsonPath.endsWith(suffix)) return undefined;
  const root = packageJsonPath.slice(0, -suffix.length);
  const segments = root.split('/');
  const nodeModulesIndex = segments.lastIndexOf('node_modules');
  if (nodeModulesIndex === -1) return undefined;
  const actualTail = segments.slice(nodeModulesIndex + 1);
  const expectedTail = packageName.startsWith('@') ? packageName.split('/') : [packageName];
  return actualTail.length === expectedTail.length &&
    actualTail.every((segment, index) => segment === expectedTail[index])
    ? root
    : undefined;
}

function readArtifactPackageManifests(
  evidence: readonly ArtifactPackageManifestEvidence[]
): readonly ArtifactPackageManifest[] {
  const roots = new Set<string>();
  const manifests: ArtifactPackageManifest[] = [];
  for (const item of evidence) {
    if (!isRecord(item.manifest)) continue;
    const name = item.manifest.name;
    const version = item.manifest.version;
    if (typeof name !== 'string' || !name || typeof version !== 'string' || !version) continue;
    const root = resolveCanonicalArtifactPackageRoot(item.packageJsonPath, name);
    if (!root) continue;
    if (!SHA256_PATTERN.test(item.sha256)) {
      throw new Error(`artifact package manifest SHA-256 无效：${item.packageJsonPath}`);
    }
    if (roots.has(root)) throw new Error(`artifact package root 重复：${root}`);
    roots.add(root);
    const declaredLicense = item.manifest.license;
    if (declaredLicense !== undefined && typeof declaredLicense !== 'string') {
      throw new Error(`artifact package license 不是字符串：${root}`);
    }
    manifests.push({
      root,
      name,
      version,
      identity: packageIdentity(name, version),
      packageJsonSha256: item.sha256,
      ...(declaredLicense ? { declaredLicense } : {}),
    });
  }
  return manifests.sort((left, right) => left.root.localeCompare(right.root));
}

function readLockPackageIdentities(lockfile: unknown): readonly LockPackageIdentity[] {
  if (!isRecord(lockfile) || lockfile.lockfileVersion !== 3 || !isRecord(lockfile.packages)) {
    throw new Error('artifact package map 需要 npm lockfileVersion=3');
  }
  const result: LockPackageIdentity[] = [];
  for (const [location, rawRecord] of Object.entries(lockfile.packages)) {
    // 根 manifest 与 workspace target record 只是 lock 元数据；真正的安装 occurrence
    // 必须位于 node_modules。workspace link 会在这里显式追到 target record。
    if (!location.includes('node_modules') || !isRecord(rawRecord)) continue;
    let record = rawRecord;
    let installKind: LockPackageIdentity['installKind'] = 'registry';
    if (rawRecord.link === true) {
      const target = readRequiredString(rawRecord, 'resolved', `lock ${location}`);
      const targetRecord = lockfile.packages[target];
      if (!isRecord(targetRecord))
        throw new Error(`lock link 目标不存在：${location} -> ${target}`);
      record = targetRecord;
      installKind = 'workspace';
    }
    const name =
      typeof record.name === 'string' && record.name
        ? record.name
        : readPackageNameFromLockLocation(location);
    const version = record.version;
    if (!name || typeof version !== 'string' || !version) continue;
    const integrity = record.integrity;
    const resolved = record.resolved;
    const license = record.license;
    if (integrity !== undefined && typeof integrity !== 'string') {
      throw new Error(`lock integrity 不是字符串：${location}`);
    }
    if (resolved !== undefined && typeof resolved !== 'string') {
      throw new Error(`lock resolved 不是字符串：${location}`);
    }
    if (license !== undefined && typeof license !== 'string') {
      throw new Error(`lock license 不是字符串：${location}`);
    }
    result.push({
      identity: packageIdentity(name, version),
      installKind,
      location,
      name,
      version,
      ...(integrity ? { integrity } : {}),
      ...(resolved ? { resolved } : {}),
      ...(license ? { license } : {}),
    });
  }
  return result;
}

function resolvePackageRoot(
  logicalPath: string,
  manifestsByLongestRoot: readonly ArtifactPackageManifest[]
): ArtifactPackageManifest | undefined {
  return manifestsByLongestRoot.find(
    manifest => logicalPath === manifest.root || logicalPath.startsWith(`${manifest.root}/`)
  );
}

function resolveUnpackedLogicalPath(artifactPath: string): string | undefined {
  const markerIndex = artifactPath.toLowerCase().indexOf(ASAR_UNPACKED_MARKER);
  if (markerIndex !== 0 && artifactPath[markerIndex - 1] !== '/') return undefined;
  return artifactPath.slice(markerIndex + ASAR_UNPACKED_MARKER.length);
}

function countPackageEntries(input: {
  readonly entries: readonly ArtifactContentEntry[];
  readonly manifests: readonly ArtifactPackageManifest[];
}): Readonly<{
  asarCounts: ReadonlyMap<string, number>;
  unpackedCounts: ReadonlyMap<string, Readonly<{ count: number; path: string }>>;
}> {
  const byLongestRoot = [...input.manifests].sort(
    (left, right) => right.root.length - left.root.length || left.root.localeCompare(right.root)
  );
  const asarCounts = new Map<string, number>();
  const unpackedMutable = new Map<string, { count: number; path: string }>();
  for (const entry of input.entries) {
    let logicalPath: string | undefined;
    let physicalPrefix: string | undefined;
    if (entry.scope === 'app-asar' && entry.path.startsWith('node_modules/')) {
      logicalPath = entry.path;
    } else if (entry.scope === 'app-filesystem') {
      logicalPath = resolveUnpackedLogicalPath(entry.path);
      if (logicalPath?.startsWith('node_modules/')) {
        physicalPrefix = entry.path.slice(0, entry.path.length - logicalPath.length);
      } else {
        logicalPath = undefined;
      }
    }
    if (!logicalPath) continue;
    const manifest = resolvePackageRoot(logicalPath, byLongestRoot);
    if (!manifest) {
      throw new Error(`artifact package 内容没有 canonical package manifest：${entry.path}`);
    }
    if (entry.scope === 'app-asar') {
      asarCounts.set(manifest.root, (asarCounts.get(manifest.root) ?? 0) + 1);
      continue;
    }
    const unpackedPath = `${physicalPrefix ?? ''}${manifest.root}`;
    const existing = unpackedMutable.get(manifest.root);
    if (existing && existing.path !== unpackedPath) {
      throw new Error(`artifact package 对应多个 asar.unpacked 根：${manifest.root}`);
    }
    unpackedMutable.set(manifest.root, {
      count: (existing?.count ?? 0) + 1,
      path: unpackedPath,
    });
  }
  for (const manifest of input.manifests) {
    if (!asarCounts.has(manifest.root)) {
      throw new Error(`artifact canonical package 没有内容条目：${manifest.root}`);
    }
  }
  return { asarCounts, unpackedCounts: unpackedMutable };
}

function isCompiledBundleEntry(entry: ArtifactContentEntry): boolean {
  if (entry.scope === 'app-asar' && !entry.path.startsWith('node_modules/')) {
    return entry.category === 'application-code';
  }
  const normalized = entry.path.toLowerCase();
  return (
    entry.scope === 'app-filesystem' &&
    normalized.includes('/resources/plugins/') &&
    normalized.includes('/dist/')
  );
}

function createLimitations(
  entries: readonly ArtifactContentEntry[],
  componentCount: number
): readonly ArtifactPackageMapLimitation[] {
  const bundleEntries = entries.filter(isCompiledBundleEntry);
  const runtimeEntries = entries.filter(
    entry => entry.category === 'bundled-runtime' || entry.category === 'electron-runtime'
  );
  const sample = (candidates: readonly ArtifactContentEntry[]) =>
    candidates.slice(0, 12).map(entry => `${entry.scope}:${entry.path}`);
  return [
    {
      code: 'compiled-bundle-inputs-not-attributed',
      entryCount: bundleEntries.length,
      pathSamples: sample(bundleEntries),
    },
    {
      code: 'non-npm-runtime-components-not-attributed',
      entryCount: runtimeEntries.length,
      pathSamples: sample(runtimeEntries),
    },
    {
      code: 'license-evidence-not-attached',
      entryCount: componentCount,
      pathSamples: [],
    },
  ];
}

export function createArtifactPackageMap(input: {
  readonly contentBom: ArtifactContentBom;
  readonly contentBomSha256: string;
  readonly packageManifests: readonly ArtifactPackageManifestEvidence[];
  readonly productionPackageLock: unknown;
  readonly productionPackageLockSha256: string;
}): ArtifactPackageMap {
  if (
    input.contentBom.kind !== 'linnya-desktop-artifact-content' ||
    input.contentBom.environment.productionPackageLockSha256 !== input.productionPackageLockSha256
  ) {
    throw new Error('Desktop content BOM 与 production package lock hash 不一致');
  }
  if (
    !SHA256_PATTERN.test(input.contentBomSha256) ||
    !SHA256_PATTERN.test(input.productionPackageLockSha256)
  ) {
    throw new Error('artifact package map 输入 hash 无效');
  }
  const manifests = readArtifactPackageManifests(input.packageManifests);
  if (manifests.length === 0) throw new Error('Desktop artifact 没有 canonical npm package');
  const lockPackages = readLockPackageIdentities(input.productionPackageLock);
  const lockByIdentity = new Map<string, LockPackageIdentity[]>();
  for (const lockPackage of lockPackages) {
    const records = lockByIdentity.get(lockPackage.identity) ?? [];
    records.push(lockPackage);
    lockByIdentity.set(lockPackage.identity, records);
  }
  const { asarCounts, unpackedCounts } = countPackageEntries({
    entries: input.contentBom.entries,
    manifests,
  });
  const manifestsByIdentity = new Map<string, ArtifactPackageManifest[]>();
  for (const manifest of manifests) {
    const records = manifestsByIdentity.get(manifest.identity) ?? [];
    records.push(manifest);
    manifestsByIdentity.set(manifest.identity, records);
  }
  const components: ArtifactPackageComponent[] = [];
  for (const [identity, artifactManifests] of manifestsByIdentity) {
    const lockRecords = lockByIdentity.get(identity);
    if (!lockRecords || lockRecords.length === 0) {
      throw new Error(`artifact package identity 不在 production lock：${identity}`);
    }
    const installKinds = sortedUnique(lockRecords.map(record => record.installKind));
    if (installKinds.length !== 1) {
      throw new Error(`artifact package 同时来自 registry/workspace：${identity}`);
    }
    const declaredLicenses = sortedUnique(
      artifactManifests.flatMap(manifest =>
        manifest.declaredLicense ? [manifest.declaredLicense] : []
      )
    );
    if (declaredLicenses.length > 1) {
      throw new Error(`artifact package manifest license 不一致：${identity}`);
    }
    const lockLicenses = sortedUnique(
      lockRecords.flatMap(record => (record.license ? [record.license] : []))
    );
    if (
      declaredLicenses.length === 1 &&
      lockLicenses.length === 1 &&
      declaredLicenses[0] !== lockLicenses[0]
    ) {
      throw new Error(`artifact package manifest/lock license 不一致：${identity}`);
    }
    const installKind = installKinds[0];
    if (installKind !== 'registry' && installKind !== 'workspace') {
      throw new Error(`artifact package install kind 无效：${identity}`);
    }
    const integrities = sortedUnique(
      lockRecords.flatMap(record => (record.integrity ? [record.integrity] : []))
    );
    const resolved = sortedUnique(
      lockRecords.flatMap(record => (record.resolved ? [record.resolved] : []))
    );
    if (installKind === 'registry' && (integrities.length !== 1 || resolved.length !== 1)) {
      throw new Error(`registry artifact package 缺少唯一 resolved/integrity：${identity}`);
    }
    const first = artifactManifests[0];
    if (!first) throw new Error(`artifact package identity 没有 manifest：${identity}`);
    components.push({
      id: `${installKind}:${identity}`,
      installKind,
      name: first.name,
      version: first.version,
      ...(declaredLicenses[0] ? { artifactDeclaredLicense: declaredLicenses[0] } : {}),
      integrities,
      resolved,
      lockLocations: sortedUnique(lockRecords.map(record => record.location)),
      locations: artifactManifests
        .map(manifest => {
          const unpacked = unpackedCounts.get(manifest.root);
          return {
            asarPath: manifest.root,
            asarEntryCount: asarCounts.get(manifest.root) ?? 0,
            packageJsonSha256: manifest.packageJsonSha256,
            unpackedEntryCount: unpacked?.count ?? 0,
            ...(unpacked ? { unpackedPath: unpacked.path } : {}),
          };
        })
        .sort((left, right) => left.asarPath.localeCompare(right.asarPath)),
    });
  }
  components.sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.version.localeCompare(right.version) ||
      left.id.localeCompare(right.id)
  );
  return {
    schemaVersion: 1,
    kind: 'linnya-desktop-artifact-package-map',
    identity: input.contentBom.identity,
    source: input.contentBom.source,
    environment: input.contentBom.environment,
    contentBomSha256: input.contentBomSha256,
    contentTreeSha256: input.contentBom.summary.treeSha256,
    productionPackageLockSha256: input.productionPackageLockSha256,
    summary: {
      packageComponentCount: components.length,
      packageLocationCount: manifests.length,
      asarPackageEntryCount: [...asarCounts.values()].reduce((total, count) => total + count, 0),
      unpackedPackageEntryCount: [...unpackedCounts.values()].reduce(
        (total, item) => total + item.count,
        0
      ),
    },
    components,
    limitations: createLimitations(input.contentBom.entries, components.length),
  };
}
