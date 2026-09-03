import type { Database } from 'better-sqlite3';
import { createPptCoordinator } from './createPptCoordinator';
import type { PptCoordinator } from './PptCoordinator';
import type { PluginConversationFilePathResolverPort } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import type { BrushArtworkGeneratorPort } from '../engine/brushArtwork';
import {
  activateSharedPresentationBuildExecution,
  deactivateSharedPresentationBuildExecution,
  getSharedPresentationBuildExecution,
} from '../features/presentationBuildExecution';

let sharedPptCoordinators = new WeakMap<Database, PptCoordinator>();
let isSharedPptCoordinatorRuntimeActive = false;
let sharedBrushArtworkGenerator: BrushArtworkGeneratorPort | undefined;

export function activateSharedPptCoordinatorRuntime(options?: {
  readonly brushArtworkGenerator?: BrushArtworkGeneratorPort;
}): void {
  activateSharedPresentationBuildExecution();
  sharedBrushArtworkGenerator = options?.brushArtworkGenerator;
  isSharedPptCoordinatorRuntimeActive = true;
}

export async function deactivateSharedPptCoordinatorRuntime(): Promise<void> {
  isSharedPptCoordinatorRuntimeActive = false;
  sharedBrushArtworkGenerator = undefined;
  sharedPptCoordinators = new WeakMap<Database, PptCoordinator>();
  await deactivateSharedPresentationBuildExecution();
}

/**
 * 中文说明：
 * Slides 的工具装饰器、document hook 与 IPC 都可能在同一个进程内触达
 * coordinator。这里以真实 SQLite DB 对象为唯一 key，保证同一 runtime 不会
 * 因入口不同产生多套 read-state / draft / 缓存状态。插件启停由
 * runtimeEffects 统一打开/关闭，避免在 IPC 注册期提前初始化全局单例。
 */
export function getSharedPptCoordinator(
  db: Database,
  options?: { readonly conversationFilePathResolver?: PluginConversationFilePathResolverPort },
): PptCoordinator {
  if (!isSharedPptCoordinatorRuntimeActive) {
    throw new Error('Slides coordinator runtime is not active.');
  }

  const cached = sharedPptCoordinators.get(db);
  if (cached) {
    if (options?.conversationFilePathResolver) {
      cached.bindConversationFilePathResolver(options.conversationFilePathResolver);
    }
    return cached;
  }
  const coordinator = createPptCoordinator(db, {
    ...(options?.conversationFilePathResolver
      ? { conversationFilePathResolver: options.conversationFilePathResolver }
      : {}),
    ...(sharedBrushArtworkGenerator
      ? { brushArtworkGenerator: sharedBrushArtworkGenerator }
      : {}),
    buildExecution: getSharedPresentationBuildExecution(),
  });
  sharedPptCoordinators.set(db, coordinator);
  return coordinator;
}
