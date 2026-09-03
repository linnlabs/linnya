/**
 * @file file-manager 模块的初始化和设置
 * 
 * @description
 * 在应用启动时调用此模块的初始化函数来注册所有文件类型的 handlers。
 * 
 * 使用方式:
 * 在 App.vue 或主入口文件中：
 * ```typescript
 * import { initFileManager } from '@/shared/modules/file-manager/setup';
 * initFileManager();
 * ```
 */

import { registerFileTypeHandler, unregisterFileTypeHandler } from './index';
import { listDocumentTypes } from '@/app/plugins/registry';
import { ensureBuiltinRendererPluginsRegistered } from '@/app/plugins/builtin';
import type { PluginId } from '@app/schemas';

/**
 * 初始化 file-manager 模块。
 *
 * 中文说明：插件文件 handler 由 `syncFileManagerHandlers` 按 enabled snapshot
 * 统一同步；init 只做不可被插件启停影响的基础登记。
 */
export function initFileManager() {
  console.log('[file-manager] Initializing file manager...');
  ensureBuiltinRendererPluginsRegistered();
  console.log('[file-manager] File manager initialized');
}

export async function syncFileManagerHandlers(
  enabledPluginIds: ReadonlySet<PluginId>,
): Promise<void> {
  for (const documentType of listDocumentTypes()) {
    const handler = documentType.fileHandler;
    if (!handler) continue;

    if (enabledPluginIds.has(documentType.pluginId)) {
      registerFileTypeHandler(handler);
      console.log(`[file-manager] ${documentType.label} handler registered`);
    } else {
      await unregisterFileTypeHandler(handler.type);
      console.log(`[file-manager] ${documentType.label} handler unregistered`);
    }
  }
}
