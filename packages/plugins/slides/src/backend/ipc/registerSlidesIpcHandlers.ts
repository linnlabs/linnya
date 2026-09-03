import type { Database } from 'better-sqlite3';
import type { BackendPluginIpcHandlerRegistrar } from '@plugin/backend/pluginContribution';
import { getSharedPptCoordinator } from '@plugin/slides/backend-coordinator';

import { registerSlidesIpcHandlersForCoordinatorProvider } from './slidesIpcHandlers';

interface SlidesTsServiceManager {
  getServices(): {
    databaseService: {
      getDb(): Database;
    } | null;
  };
}

function isSlidesTsServiceManager(value: unknown): value is SlidesTsServiceManager {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'getServices') === 'function';
}

function readSlidesTsServiceManager(value: unknown): SlidesTsServiceManager {
  if (!isSlidesTsServiceManager(value)) {
    throw new Error('Slides IPC registrar requires TSServiceManager-like host object.');
  }
  return value;
}

/**
 * 阶段 5BE：Slides IPC registrar 已归包。
 *
 * 5BA 后 coordinator 由包内共享工厂创建，不再经 legacy bridge。registrar
 * 只捕获当前 workspace DB，真实 coordinator 读取延迟到 handler 执行期；
 * 生命周期由 slides runtimeEffects 控制，避免注册 IPC 时提前初始化全局对象。
 */
export function registerSlidesIpcHandlers(
  tsServiceManager: unknown,
  registerBackendPluginIpcHandler: BackendPluginIpcHandlerRegistrar,
): void {
  const databaseService = readSlidesTsServiceManager(tsServiceManager).getServices().databaseService;
  if (!databaseService) {
    throw new Error('DatabaseService not available');
  }

  const db = databaseService.getDb();
  registerSlidesIpcHandlersForCoordinatorProvider(
    () => getSharedPptCoordinator(db),
    registerBackendPluginIpcHandler,
  );
}
