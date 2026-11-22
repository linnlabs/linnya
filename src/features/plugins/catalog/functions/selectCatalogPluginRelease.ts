import {
  satisfiesSemverRange,
  type PluginRuntimeArchitecture,
  type PluginRuntimeEntry,
  type PluginRuntimePlatform,
  type PluginRuntimeTarget,
  type SignedPluginCatalogEntry,
} from '@app/schemas';

import { compareDottedVersions } from '@app/schemas';
import { evaluateRemotePluginCompatibility } from '../../install/functions/evaluateRemotePluginCompatibility';
import type { VerifiedPluginCatalog } from '../definitions/pluginCatalog';

export interface ResolvedPluginRuntime {
  readonly id: string;
  readonly version: string;
  readonly target: PluginRuntimeTarget;
}

export type CatalogPluginReleaseSelection =
  | { readonly status: 'selected'; readonly entry: SignedPluginCatalogEntry; readonly runtimes: readonly ResolvedPluginRuntime[] }
  | { readonly status: 'not-listed' }
  | { readonly status: 'incompatible'; readonly latestVersion: string; readonly detail: string }
  | { readonly status: 'runtime-unavailable'; readonly latestVersion: string; readonly runtimeId: string };

function byVersionDescending<T extends { readonly version: string }>(left: T, right: T): number {
  return (compareDottedVersions(right.version, left.version) ?? 0);
}

function resolveRuntime(
  runtimes: readonly PluginRuntimeEntry[],
  requirement: { readonly id: string; readonly range: string },
  platform: PluginRuntimePlatform,
  architecture: PluginRuntimeArchitecture,
): ResolvedPluginRuntime | null {
  for (const runtime of [...runtimes].filter(item => item.id === requirement.id).sort(byVersionDescending)) {
    if (!satisfiesSemverRange(runtime.version, requirement.range)) continue;
    const target = runtime.targets.find(item => item.platform === platform && item.architecture === architecture);
    if (target) return { id: runtime.id, version: runtime.version, target };
  }
  return null;
}

/**
 * 从已验签 catalog 选出当前 Host 可安装的最高版本，并解析其原生运行时到本平台 artifact。
 * 版本按高到低逐个尝试：不兼容或运行时不可得的版本跳过；全部不可用时返回最高版本的原因。
 */
export function selectCatalogPluginRelease(input: {
  readonly catalog: VerifiedPluginCatalog;
  readonly pluginId: string;
  readonly appVersion: string;
  readonly rendererUiVersion: string;
  readonly platform: PluginRuntimePlatform;
  readonly architecture: PluginRuntimeArchitecture;
}): CatalogPluginReleaseSelection {
  const candidates = input.catalog.plugins.filter(entry => entry.id === input.pluginId).sort(byVersionDescending);
  if (candidates.length === 0) return { status: 'not-listed' };
  let firstFailure: CatalogPluginReleaseSelection | null = null;
  for (const entry of candidates) {
    const compatibility = evaluateRemotePluginCompatibility({
      appVersion: input.appVersion,
      rendererUiVersion: input.rendererUiVersion,
      requirement: { ...(entry.minApp ? { minApp: entry.minApp } : {}), ...(entry.rendererUi ? { rendererUi: entry.rendererUi } : {}) },
    });
    if (!compatibility.compatible) {
      firstFailure ??= { status: 'incompatible', latestVersion: entry.version, detail: compatibility.detail };
      continue;
    }
    const runtimes: ResolvedPluginRuntime[] = [];
    let missing: string | null = null;
    for (const requirement of entry.requiresRuntimes) {
      const resolved = resolveRuntime(input.catalog.runtimes, requirement, input.platform, input.architecture);
      if (!resolved) {
        missing = requirement.id;
        break;
      }
      runtimes.push(resolved);
    }
    if (missing) {
      firstFailure ??= { status: 'runtime-unavailable', latestVersion: entry.version, runtimeId: missing };
      continue;
    }
    return { status: 'selected', entry, runtimes };
  }
  return firstFailure ?? { status: 'not-listed' };
}
