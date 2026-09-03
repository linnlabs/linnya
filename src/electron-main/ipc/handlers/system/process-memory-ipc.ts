/** Electron 进程内存诊断 IPC；采集与投影规则归 system/process-memory feature。 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ElectronProcessMemoryResponse } from '@app/schemas';
import { collectElectronProcessMemorySnapshot } from '../../../../features/system/process-memory/orchestration/collectElectronProcessMemorySnapshot.js';
import { Logger } from '../../../../shared/logger.js';

const logger = new Logger('process-memory-ipc');

export function registerProcessMemoryHandlers(): void {
  ipcMain.handle(
    'system:get-process-memory-metrics',
    async (event: IpcMainInvokeEvent): Promise<ElectronProcessMemoryResponse> => {
      try {
        return collectElectronProcessMemorySnapshot(event.sender.getOSProcessId());
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('system:get-process-memory-metrics failed', error);
        return { success: false, error: message };
      }
    },
  );

  logger.info('Process memory IPC handlers registered');
}
