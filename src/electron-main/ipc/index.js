/**
 * @file src/main/ipc/index.js
 * @description 统一注册所有IPC处理器模块。
 */
import { registerAllHandlers } from './handlers/index.ts'; // +++ 修复：明确指向TS文件 +++
import { registerWindowHandlers } from './window-handlers.js';
import { registerExportHandlers } from './export-handlers.js';

/**
 * 注册应用中所有的 IPC 监听器。
 * 这是所有 IPC 模块的统一入口点。
 * @param {{ getPort: Function, getToken: Function }} apiPortProvider - App Server ready 身份
 */
export function registerIpcHandlers(apiPortProvider) {
  registerAllHandlers(apiPortProvider);
  // registerUpdateHandlers(); // --- 已被 registerAllHandlers 自动包含，无需手动调用 ---
  registerWindowHandlers();
  registerExportHandlers();
}
