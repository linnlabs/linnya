import fs from 'node:fs';
import path from 'node:path';
import type { PluginId, PluginManifest } from '@app/schemas';
import { pathManager } from '../../../shared/utils/pathManager';
import { readInstalledRuntimePathRoots } from '../../../shared/runtime-paths';
import { readInstalledDistributionIdentity } from '../../../shared/distribution-identity';
import { getRegisteredBackendPluginDirectory } from './registeredPluginDirectories';
import { assertPluginDataId, resolvePluginDataRoot } from '../../../features/plugins/infrastructure/cleanup/pluginDataRoot';
import { readPluginManifestForCleanup } from '../../../features/plugins/infrastructure/cleanup/pluginDataManifest';
import { readPluginArtifactIdentity } from '../../../features/plugins/install/functions/readPluginArtifactIdentity';
import type { TrustedPluginCatalogKeys } from '../../../features/plugins/catalog/definitions/pluginCatalog';
import { verifyCatalogInstallReceipt } from '../../../features/plugins/catalog/functions/verifyCatalogInstallReceipt';
import { resolveTrustedPluginCatalogKeys } from '../../../features/plugins/catalog/functions/resolvePluginCatalogSource';
import { createPluginCatalogStateStore } from '../../../features/plugins/catalog/infrastructure/pluginCatalogStateStore';
import legacyRootOwners from './definitions/legacyPluginDataRoots.json';

const LEGACY_ROOT_OWNERS = new Map<string, PluginId>(Object.entries(legacyRootOwners));

export interface PluginCleanupDescriptor {
  readonly manifest: PluginManifest;
  readonly dataRoot: string;
}

export function describePluginData(options: {
  readonly pluginId: PluginId;
  readonly workspaceRoot: string;
  readonly registeredDirectory?: string;
  readonly bundledRoot?: string | null;
  readonly activeRoot?: string;
  readonly developmentRoot?: string;
  readonly forCleanup?: boolean;
  readonly bundledSourceTrusted?: boolean;
  /** 安装包内远程分发插件的声明目录；与随包目录同样由 Desktop 冻结。 */
  readonly declarationRoot?: string | null;
  readonly declarationSourceTrusted?: boolean;
  /** 与插件安装、启动准入同一信任环；用于认定已登记目录是经验签 catalog 安装的版本。 */
  readonly trustedCatalogKeys?: TrustedPluginCatalogKeys;
}): PluginCleanupDescriptor | null {
  const { pluginId, workspaceRoot, registeredDirectory, bundledRoot, activeRoot, developmentRoot } = options;
  assertPluginDataId(pluginId);
  const source = readPluginManifestForCleanup({
    pluginId,
    registeredPluginDirectory: registeredDirectory,
    bundledPluginRoot: bundledRoot,
    declarationRoot: options.declarationRoot,
  });
  if (!source) return null;

  // 自报 builtin/ID 和任意 direct dir 不是来源授权。已安装版必须与 Host
  // 随包声明一致或有经验签 catalog 的安装回执；源码开发只认冻结 checkout 内的正式插件目录。
  let admitted = (source.kind === 'bundled' && options.bundledSourceTrusted === true)
    || (source.kind === 'declared' && options.declarationSourceTrusted === true);
  if ((options.forCleanup || source.manifest.dataStorage.legacyRoots.length > 0) && source.kind === 'registered') {
    const directory = path.resolve(source.directory);
    const officialDevelopmentDir = developmentRoot && path.resolve(developmentRoot, 'packages', 'plugins', pluginId);
    const developmentSource = officialDevelopmentDir === directory && developmentRoot !== undefined &&
      fs.realpathSync(directory) === path.resolve(fs.realpathSync(developmentRoot), 'packages', 'plugins', pluginId);
    const installedDirectory = activeRoot && directory === path.resolve(activeRoot, pluginId, source.manifest.version);
    const bundledInstallation = options.bundledSourceTrusted === true && installedDirectory && bundledRoot &&
      sameArtifact(directory, path.join(bundledRoot, pluginId));
    // 远程分发插件没有随包副本：已安装版目录有经验签 catalog 的回执即视为官方来源（含后续撤回检查）。
    const catalogInstallation = Boolean(installedDirectory && activeRoot && options.trustedCatalogKeys) && verifyCatalogInstallReceipt({
      pluginId,
      version: source.manifest.version,
      pluginDirectory: directory,
      trustedKeys: options.trustedCatalogKeys ?? {},
      laterRevocations: createPluginCatalogStateStore({ userPluginRoot: activeRoot ?? '' }).readRevocations(),
    }).admitted;
    admitted = developmentSource || Boolean(bundledInstallation) || catalogInstallation;
  }
  if (options.forCleanup && !admitted) throw new Error(`插件来源不可信，不能清理数据: ${pluginId}`);

  return {
    manifest: source.manifest,
    dataRoot: resolvePluginDataRoot({
      workspaceRoot,
      pluginId,
      dataStorage: source.manifest.dataStorage,
      legacyRootOwners: admitted ? LEGACY_ROOT_OWNERS : undefined,
    }),
  };
}

function sameArtifact(activeDirectory: string, bundledDirectory: string): boolean {
  const bundledManifest = path.join(bundledDirectory, 'plugin.json');
  if (!fs.existsSync(bundledManifest)) return false;
  // 清单摘要对应版本身份；真正交给删除用例的声明也必须与随包字节一致。
  return fs.readFileSync(path.join(activeDirectory, 'plugin.json')).equals(fs.readFileSync(bundledManifest)) &&
    readPluginArtifactIdentity(activeDirectory) === readPluginArtifactIdentity(bundledDirectory);
}

export function resolvePluginCleanupDescriptor(pluginId: PluginId): PluginCleanupDescriptor | null {
  return describeRuntimePluginData(pluginId, true);
}

export function resolveRegisteredPluginDataRoot(pluginId: PluginId): string {
  if (!getRegisteredBackendPluginDirectory(pluginId)) throw new Error(`插件未注册，不能解析数据根: ${pluginId}`);
  const descriptor = describeRuntimePluginData(pluginId, false);
  if (!descriptor) throw new Error(`插件缺少数据声明: ${pluginId}`);
  return descriptor.dataRoot;
}

function describeRuntimePluginData(pluginId: PluginId, forCleanup: boolean): PluginCleanupDescriptor | null {
  const identity = readInstalledDistributionIdentity();
  const runtimeRoots = readInstalledRuntimePathRoots();
  const resolvedBundledRoot = process.env.LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT;
  const bundledRoot = identity?.packaged ? resolvedBundledRoot : resolvedBundledRoot ?? process.env.LINNYA_BUNDLED_PLUGIN_ROOT;
  const developmentRoot = identity?.kind === 'source' ? runtimeRoots?.developmentRoot : undefined;
  // Packaged 的路径由 Desktop 冻结为 resources/plugins；源码模式只接受工作区配置的随包输出。
  const bundledSourceTrusted = Boolean(bundledRoot && (identity?.packaged || (
    developmentRoot && path.resolve(bundledRoot) === path.resolve(developmentRoot, 'extraResources', 'plugins')
  )));
  const declarationRoot = process.env.LINNYA_RESOLVED_PLUGIN_DECLARATION_ROOT;
  const declarationSourceTrusted = Boolean(declarationRoot && (identity?.packaged || (
    developmentRoot && path.resolve(declarationRoot) === path.resolve(developmentRoot, 'extraResources', 'plugin-declarations')
  )));
  return describePluginData({
    pluginId,
    workspaceRoot: pathManager.getWorkspaceRoot(),
    registeredDirectory: getRegisteredBackendPluginDirectory(pluginId),
    bundledRoot,
    activeRoot: process.env.LINNYA_PLUGIN_ROOT,
    developmentRoot,
    forCleanup,
    bundledSourceTrusted,
    declarationRoot,
    declarationSourceTrusted,
    ...(identity ? { trustedCatalogKeys: resolveTrustedPluginCatalogKeys({ identity, env: process.env }) } : {}),
  });
}
