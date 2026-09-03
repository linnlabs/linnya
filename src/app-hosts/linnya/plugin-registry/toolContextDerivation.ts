import { copyToolContextRuntimeCapability } from 'linnkit/runtime-kernel';
import type { ToolContext } from '../../../tools/types';
import {
  getBackendPluginRegistryRevision,
  getRegisteredToolContextBindingMigrators,
} from './builtin';
import { getRuntimeEnabledPluginIds } from './pluginRuntimeState';
import type { BackendPluginToolContextBindingMigrator } from './types';
import {
  copyCitationSequence,
  copyCitationRefAllocator,
  copyCitationSourceResolver,
} from '../../../domains/citation';

export type ToolContextDerivationPatch = Partial<ToolContext>;

interface MigratorCacheEntry {
  readonly key: string;
  readonly migrators: readonly BackendPluginToolContextBindingMigrator[];
}

let migratorCache: MigratorCacheEntry | null = null;

function buildMigratorCacheKey(
  registryRevision: number,
  enabledPluginIds: ReadonlySet<string>
): string {
  return `${registryRevision}:${Array.from(enabledPluginIds).sort().join(',')}`;
}

function getCachedToolContextBindingMigrators(
  enabledPluginIds: ReadonlySet<string>
): readonly BackendPluginToolContextBindingMigrator[] {
  const key = buildMigratorCacheKey(getBackendPluginRegistryRevision(), enabledPluginIds);
  if (migratorCache?.key === key) {
    return migratorCache.migrators;
  }

  const migrators = getRegisteredToolContextBindingMigrators(enabledPluginIds);
  migratorCache = { key, migrators };
  return migrators;
}

export function clearToolContextBindingMigratorCacheForTests(): void {
  migratorCache = null;
}

export function derivePluginAwareToolContext(
  source: ToolContext,
  patch: ToolContextDerivationPatch
): ToolContext {
  const target: ToolContext = {
    ...source,
    ...patch,
  };

  copyToolContextRuntimeCapability(source, target);
  copyCitationSequence(source, target);
  copyCitationRefAllocator(source, target);
  copyCitationSourceResolver(source, target);

  // 中文说明：插件可以使用 WeakMap 保存 coordinator/provider 等私有绑定。
  // 这些绑定不能靠对象展开复制，必须由独立的 binding migrator 声明如何迁移。
  // migrator 列表按“registry 版本 + 当前启用插件集合”缓存；每次派生仍必须逐个
  // 调用 migrator，因为平台无法窥探插件私有 WeakMap 里是否存在待迁移绑定。
  for (const migrator of getCachedToolContextBindingMigrators(getRuntimeEnabledPluginIds())) {
    migrator.migrate(source, target);
  }

  return target;
}
