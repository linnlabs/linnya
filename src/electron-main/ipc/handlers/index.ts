/**
 * @file src/electron-main/ipc/handlers/index.ts
 *
 * @brief IPC 处理器统一入口
 *
 * @description
 * 此模块是所有 IPC 处理器的集中注册入口。
 * 将原来分散在 file-handlers.js 中的处理器按领域拆分后，
 * 通过此文件统一注册到 ipcMain。
 *
 * 核心职责:
 * - 集中注册所有领域的 IPC 处理器
 * - 提供单一的初始化入口
 * - 便于管理和维护
 *
 * 设计原则:
 * - 单一入口: 外部只需调用 registerAllHandlers()
 * - 按域划分: 每个领域的处理器独立注册
 * - 易于扩展: 新增领域处理器时只需在此注册
 *
 * 使用示例:
 * ```ts
 * import { registerAllHandlers } from './ipc/handlers/index.js';
 * registerAllHandlers();
 * ```
 */

import { registerMediaHandlers } from './system/media-ipc.js';
import { registerShellHandlers } from './system/shell-ipc.js';
import { registerUpdateHandlers } from './system/update-ipc.js';
import { registerApiPortHandlers } from './system/api-port-ipc.js';
import { registerQuotaHandlers } from './system/quota-ipc.js';
import { registerProcessMemoryHandlers } from './system/process-memory-ipc.js';
import type { ApiPortProvider } from './system/api-port-ipc.js';

/**
 * 注册所有 IPC 处理器
 *
 * @remarks
 * 这里只注册 Electron Main 自己拥有的桌面 IPC：API 端口、媒体、Shell、更新、
 * 配额与进程诊断。需要 Backend 服务的业务请求由 App Server RPC registry 处理，
 * 不得重新挂回 Main 的事件循环。
 *
 * 每个领域的处理器都是独立的模块，便于维护和测试。
 */
export function registerAllHandlers(apiPortProvider: ApiPortProvider): void {
  // 0. API 端口查询（根因修复：避免广播时序导致的端口丢失与超时）
  registerApiPortHandlers(apiPortProvider);

  // 1. 媒体相关处理器
  registerMediaHandlers();

  // 2. Shell 相关处理器
  registerShellHandlers();

  // 3. 更新相关处理器
  registerUpdateHandlers();

  // 4. 通用配额
  registerQuotaHandlers();

  // 5. Electron 进程级内存诊断
  registerProcessMemoryHandlers();
}
