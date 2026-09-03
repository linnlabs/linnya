const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeJson = value => JSON.stringify(value ?? {});

function containsLocalAbsolutePath(value) {
  if (typeof value === 'string') {
    return /^(?:file:)?(?:\/|[A-Za-z]:[\\/])/u.test(value);
  }
  if (Array.isArray(value)) return value.some(containsLocalAbsolutePath);
  return isRecord(value) && Object.values(value).some(containsLocalAbsolutePath);
}

function assertManifestSectionMatches(lockRoot, manifest, sectionName) {
  if (normalizeJson(lockRoot[sectionName]) !== normalizeJson(manifest[sectionName])) {
    throw new Error(`生产 lock 的 ${sectionName} 与生产 manifest 不一致`);
  }
}

/**
 * 生产 lock 与 pnpm workspace lock 是两个不同边界：前者只冻结最终 Desktop
 * 的扁平 npm 依赖树。这里只验证内容合同，不允许本机路径或 workspace 协议混入。
 */
export function assertProductionPackageLock(lockfile, manifest) {
  if (!isRecord(lockfile) || lockfile.lockfileVersion !== 3 || !isRecord(lockfile.packages)) {
    throw new Error('生产 package lock 必须是 lockfileVersion=3 的 npm lock');
  }
  if (!isRecord(manifest) || !isRecord(manifest.dependencies)) {
    throw new Error('生产 package lock 验证需要有效 manifest');
  }
  const lockRoot = lockfile.packages[''];
  if (!isRecord(lockRoot)) throw new Error('生产 package lock 缺少根 package');
  if (lockRoot.name !== manifest.name || lockRoot.version !== manifest.version) {
    throw new Error('生产 package lock 的根 name/version 与 manifest 不一致');
  }
  assertManifestSectionMatches(lockRoot, manifest, 'dependencies');
  assertManifestSectionMatches(lockRoot, manifest, 'devDependencies');

  const serialized = JSON.stringify(lockfile);
  if (serialized.includes('workspace:')) {
    throw new Error('生产 package lock 不能包含 workspace 协议');
  }
  if (containsLocalAbsolutePath(lockfile)) {
    throw new Error('生产 package lock 不能包含本机绝对路径');
  }
  return lockfile;
}
