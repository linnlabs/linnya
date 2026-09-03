import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, '../..');

const defaultPluginDownloadRootUrl = 'https://download.linnyai.com/plugins';

const publicOfficialPluginReleaseTargets = [
  {
    id: 'mindmap',
    packageDir: 'packages/plugins/mindmap',
    defaultR2Prefix: 'plugins/mindmap',
    defaultDownloadBaseUrl: `${defaultPluginDownloadRootUrl}/mindmap`,
    productionDistDirectories: ['dist/backend', 'dist/renderer'],
  },
  {
    id: 'slides',
    packageDir: 'packages/plugins/slides',
    defaultR2Prefix: 'plugins/slides',
    defaultDownloadBaseUrl: `${defaultPluginDownloadRootUrl}/slides`,
    productionDistDirectories: [
      'dist/backend',
      'dist/brush-worker',
      'dist/cli',
      'dist/raster-worker',
      'dist/renderer',
    ],
    artifactVerification: {
      allowedBackendBareSpecifiers: ['@linnya/slides-mathjax-runtime'],
      requiredFiles: [
        { path: 'dist/raster-worker/worker.html', label: 'raster worker HTML' },
        { path: 'dist/backend/raster-worker-preload.cjs', label: 'raster worker preload' },
        { path: 'dist/brush-worker/worker.html', label: 'Brush worker HTML' },
        { path: 'dist/backend/brush-worker-preload.cjs', label: 'Brush worker preload' },
        {
          path: 'dist/backend/presentation-build-worker.cjs',
          label: 'Slides presentation build worker',
        },
        { path: 'dist/cli/yogaRuntimeLoader.cjs', label: 'CLI Yoga runtime loader' },
        { path: 'dist/cli/harfbuzzRuntimeLoader.cjs', label: 'CLI HarfBuzz runtime loader' },
        {
          path: 'dist/backend/node_modules/@linnya/slides-mathjax-runtime/index.cjs',
          label: 'shared Slides MathJax runtime',
        },
        {
          path: 'dist/backend/node_modules/@linnya/slides-mathjax-runtime/runtime-manifest.json',
          label: 'shared Slides MathJax runtime manifest',
        },
        {
          path: 'dist/cli/node_modules/@linnya/slides-mathjax-runtime/index.cjs',
          label: 'CLI Slides MathJax runtime bridge',
        },
        {
          path: 'dist/backend/node_modules/typescript/package.json',
          label: 'backend TypeScript runtime package',
        },
        {
          path: 'dist/backend/node_modules/typescript/runtime-manifest.json',
          label: 'backend TypeScript runtime manifest',
        },
        {
          path: 'dist/backend/node_modules/typescript/lib/typescript.js',
          label: 'backend TypeScript compiler',
        },
        {
          path: 'dist/backend/node_modules/typescript/lib/lib.es2020.d.ts',
          label: 'backend TypeScript stdlib root',
        },
        {
          path: 'dist/backend/node_modules/typescript/LICENSE.txt',
          label: 'backend TypeScript license',
        },
        {
          path: 'dist/backend/node_modules/typescript/ThirdPartyNoticeText.txt',
          label: 'backend TypeScript third-party notices',
        },
      ],
      requiredPrefixes: [
        { path: 'dist/brush-worker/assets/', label: 'Brush worker assets' },
        { path: 'dist/raster-worker/assets/', label: 'raster worker assets' },
      ],
      browserRuntimeDirectories: ['dist/brush-worker', 'dist/raster-worker'],
      typescriptRuntime: {
        root: 'dist/backend/node_modules/typescript',
      },
    },
  },
];

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);

const readJsonFile = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const normalizeWorkspaceRelativePath = (root, absolutePath) =>
  path.relative(root, absolutePath).split(path.sep).join('/');

const readDeclaredProductionDistDirectories = ({ pluginId, manifest, release }) => {
  const declaredDirectories = release.productionDistDirectories;
  if (declaredDirectories !== undefined) {
    if (
      !Array.isArray(declaredDirectories)
      || declaredDirectories.some(directory => typeof directory !== 'string' || directory.trim().length === 0)
    ) {
      throw new Error(`${pluginId} linnya.release.productionDistDirectories 必须是非空字符串数组`);
    }
    return declaredDirectories;
  }

  if (!isRecord(manifest.entry)) {
    throw new Error(`${pluginId} plugin.json 缺少 entry，无法推导生产目录`);
  }
  return Array.from(new Set(Object.values(manifest.entry).map(entryPath => {
    if (typeof entryPath !== 'string' || entryPath.trim().length === 0) {
      throw new Error(`${pluginId} plugin.json entry 必须全部为非空字符串`);
    }
    return path.posix.dirname(entryPath.replace(/^\.\//u, ''));
  })));
};

/**
 * 当前私有 monorepo 可以组合额外官方插件，但公共 Core 不保存其 ID 或源码路径。
 * 插件 owner 通过 package.json#linnya.release.includeInOfficialRelease 自主加入；
 * 公共 clean clone 删除该 package 后，默认发行集合会自然收缩。
 */
export function discoverWorkspaceOfficialPluginReleaseTargets(root = repoRoot) {
  const pluginsRoot = path.join(root, 'packages/plugins');
  if (!fs.existsSync(pluginsRoot)) return [];

  return fs.readdirSync(pluginsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(entry => {
      const packageDir = path.join(pluginsRoot, entry.name);
      const packageJsonPath = path.join(packageDir, 'package.json');
      const manifestPath = path.join(packageDir, 'plugin.json');
      if (!fs.existsSync(packageJsonPath) || !fs.existsSync(manifestPath)) return [];

      const packageJson = readJsonFile(packageJsonPath);
      const release = isRecord(packageJson.linnya) && isRecord(packageJson.linnya.release)
        ? packageJson.linnya.release
        : null;
      if (release?.includeInOfficialRelease !== true) return [];

      const manifest = readJsonFile(manifestPath);
      if (!isRecord(manifest) || typeof manifest.id !== 'string' || manifest.id.trim().length === 0) {
        throw new Error(`${normalizeWorkspaceRelativePath(root, manifestPath)} 缺少有效插件 id`);
      }
      const pluginId = manifest.id;
      return [{
        id: pluginId,
        packageDir: normalizeWorkspaceRelativePath(root, packageDir),
        defaultR2Prefix: `plugins/${pluginId}`,
        defaultDownloadBaseUrl: `${defaultPluginDownloadRootUrl}/${pluginId}`,
        productionDistDirectories: readDeclaredProductionDistDirectories({
          pluginId,
          manifest,
          release,
        }),
      }];
    });
}

const workspaceOfficialPluginReleaseTargets = discoverWorkspaceOfficialPluginReleaseTargets();
const duplicateReleaseTargetIds = workspaceOfficialPluginReleaseTargets
  .map(target => target.id)
  .filter(pluginId => publicOfficialPluginReleaseTargets.some(target => target.id === pluginId));
if (duplicateReleaseTargetIds.length > 0) {
  throw new Error(`插件发行目标重复登记: ${duplicateReleaseTargetIds.join(', ')}`);
}

export const officialPluginReleaseTargets = [
  ...publicOfficialPluginReleaseTargets,
  ...workspaceOfficialPluginReleaseTargets,
];

const splitPluginIdList = raw =>
  raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

export const buildPluginEnvSuffix = pluginId =>
  pluginId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const listOfficialPluginReleaseTargetIds = () =>
  officialPluginReleaseTargets.map(target => target.id);

export const findOfficialPluginReleaseTarget = pluginId =>
  officialPluginReleaseTargets.find(target => target.id === pluginId) ?? null;

const normalizePluginArtifactPath = (rawPath, label) => {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error(`${label} must be a non-empty path`);
  }
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`${label} must stay inside the plugin package: ${rawPath}`);
  }
  return normalized;
};

/**
 * 发布目录是生产边界，不等同于本地 dist 的当前内容。官方插件显式登记；
 * 非官方插件只允许 entry 所在的窄目录，避免开发和 smoke 产物被顺带发布。
 */
export function resolvePluginProductionDistDirectories(pluginId, entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${pluginId} plugin manifest entry must be an object`);
  }
  const entryPaths = Object.entries(entry).map(([entryName, rawPath]) =>
    normalizePluginArtifactPath(rawPath, `${pluginId} entry.${entryName}`)
  );
  const target = findOfficialPluginReleaseTarget(pluginId);
  const configuredDirectories = target?.productionDistDirectories;
  const directories =
    configuredDirectories ?? entryPaths.map(entryPath => path.posix.dirname(entryPath));
  const normalizedDirectories = Array.from(
    new Set(
      directories.map(directory =>
        normalizePluginArtifactPath(directory, `${pluginId} production dist directory`)
      )
    )
  );

  for (const directory of normalizedDirectories) {
    if (!directory.startsWith('dist/') || directory === 'dist') {
      throw new Error(`${pluginId} production directory must be nested under dist/: ${directory}`);
    }
  }
  for (const entryPath of entryPaths) {
    if (!normalizedDirectories.some(directory => entryPath.startsWith(`${directory}/`))) {
      throw new Error(
        `${pluginId} runtime entry is outside the production dist allowlist: ${entryPath}`
      );
    }
  }
  return normalizedDirectories.sort((left, right) => left.localeCompare(right));
}

export function readPluginIdsFromCliOrEnv({
  args = process.argv.slice(2),
  env = process.env,
  defaultIds = [],
} = {}) {
  const explicitIds = [];

  for (const arg of args) {
    if (arg.startsWith('--plugin=')) {
      explicitIds.push(...splitPluginIdList(arg.slice('--plugin='.length)));
      continue;
    }
    if (!arg.startsWith('-')) {
      explicitIds.push(...splitPluginIdList(arg));
    }
  }

  const ids = explicitIds.length > 0 ? explicitIds : splitPluginIdList(env.LINNYA_PLUGIN_IDS ?? '');

  const resolvedIds = ids.length > 0 ? ids : defaultIds;
  return Array.from(new Set(resolvedIds));
}

export function readSinglePluginIdFromCli({
  scriptName,
  args = process.argv.slice(2),
  env = process.env,
} = {}) {
  const ids = readPluginIdsFromCliOrEnv({ args, env });
  if (ids.length !== 1) {
    throw new Error(`Usage: node ${scriptName} <pluginId>`);
  }
  return ids[0];
}

export function resolvePluginPackageDir(pluginId, env = process.env) {
  const envSuffix = buildPluginEnvSuffix(pluginId);
  const target = findOfficialPluginReleaseTarget(pluginId);
  const rawPackageDir =
    env[`LINNYA_PLUGIN_${envSuffix}_PACKAGE_DIR`] ??
    env.LINNYA_PLUGIN_PACKAGE_DIR ??
    target?.packageDir ??
    `packages/plugins/${pluginId}`;

  return path.resolve(repoRoot, rawPackageDir);
}

export function resolvePluginR2Prefix(pluginId, env = process.env) {
  const envSuffix = buildPluginEnvSuffix(pluginId);
  const target = findOfficialPluginReleaseTarget(pluginId);
  return (
    env[`LINNYA_PLUGIN_${envSuffix}_R2_PREFIX`] ??
    env.LINNYA_PLUGIN_R2_PREFIX ??
    target?.defaultR2Prefix ??
    `plugins/${pluginId}`
  );
}

export function resolvePluginDownloadBaseUrl(pluginId, env = process.env) {
  const envSuffix = buildPluginEnvSuffix(pluginId);
  const target = findOfficialPluginReleaseTarget(pluginId);
  const rootUrl = env.LINNYA_PLUGIN_DOWNLOAD_ROOT_URL ?? defaultPluginDownloadRootUrl;
  return (
    env[`LINNYA_PLUGIN_${envSuffix}_DOWNLOAD_BASE_URL`] ??
    env.LINNYA_PLUGIN_DOWNLOAD_BASE_URL ??
    target?.defaultDownloadBaseUrl ??
    `${rootUrl.replace(/\/+$/u, '')}/${encodeURIComponent(pluginId)}`
  );
}
