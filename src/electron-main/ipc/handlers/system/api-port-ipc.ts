/**
 * @file src/electron-main/ipc/handlers/system/api-port-ipc.ts
 *
 * @description
 * API 端口相关 IPC 处理器。
 *
 * 根因说明（中文）：
 * - 之前渲染进程依赖主进程 `webContents.send('set-api-port', port)` 的“一次性广播”拿端口；
 * - 该机制对时序非常敏感：如果渲染端监听器尚未挂载或发生重载/导航切换，消息可能丢失；
 * - 结果就是渲染端只能等待超时并降级到默认端口，从而出现误导性的错误日志。
 *
 * 解决方案（中文）：
 * - 新增一个可请求的 IPC：`api:get-port`，渲染进程随时可 `invoke` 获取端口；
 * - 这属于“根因修复”：不再依赖广播时序，避免端口协商的不确定性。
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../../shared/logger.js';

const logger = new Logger('api-port-ipc');

/**
 * 只抽象我们真正需要的能力，避免引入大型类型依赖。
 */
export interface ApiPortProvider {
  getPort(): number | null;
  getToken(): string;
}

function assertApiPortProvider(value: unknown): asserts value is ApiPortProvider {
  if (!value || typeof value !== 'object') {
    throw new Error('ApiPortProvider 未提供（App Server identity 不存在）');
  }

  const candidate = value as { getPort?: unknown; getToken?: unknown };
  if (typeof candidate.getPort !== 'function') {
    throw new Error('ApiPortProvider.getPort 不可用');
  }
  if (typeof candidate.getToken !== 'function') {
    throw new Error('ApiPortProvider.getToken 不可用');
  }
}

export function registerApiPortHandlers(apiPortProvider: unknown): void {
  assertApiPortProvider(apiPortProvider);

  ipcMain.handle('api:get-port', async (): Promise<{ port: number; token: string }> => {
    const port = apiPortProvider.getPort();
    if (typeof port !== 'number' || !Number.isFinite(port) || port <= 0) {
      // 这是“程序错误”，不做兜底猜测，直接抛出，便于尽快暴露根因。
      const msg = `App Server identity 返回非法端口: ${String(port)}`;
      logger.error(msg);
      throw new Error(msg);
    }
    return { port, token: apiPortProvider.getToken() };
  });

  logger.info('API port IPC handlers registered');
}
