/**
 * @file src/electron-main/ipc/handlers/system/quota-ipc.ts
 *
 * @description
 * 通用配额 IPC：
 * - quota:get     查询配额状态
 * - quota:consume 消耗一次配额
 *
 * 中文说明：
 * - 这是“内聚”的关键：以后新增配额不再新增新的 channel；
 * - 旧的 deep-research:* 会在 deep-research-ipc.ts 里转发到这里（兼容期）。
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../../shared/logger.js';
import { quotaManager, registerBuiltinQuotaPolicies } from '../../../services/quota/quotaRegistry.js';
import { QuotaIdRequiredError } from '../../../../features/system/quota/definitions/quotaErrors';
import { createQuotaOperationFailure } from './quota-operation-failure';

const logger = new Logger('quota-ipc');

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readQuotaId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const quotaId = payload['quotaId'];
  return typeof quotaId === 'string' && quotaId.trim().length > 0 ? quotaId.trim() : null;
}

/**
 * 注册配额相关 IPC handlers
 */
export function registerQuotaHandlers(): void {
  // 仅注册一次内置策略（可重复调用但不会重复注册 channel）
  registerBuiltinQuotaPolicies();

  ipcMain.handle('quota:get', async (_event, payload: unknown) => {
    try {
      const quotaId = readQuotaId(payload);
      if (!quotaId) {
        return createQuotaOperationFailure(
          new QuotaIdRequiredError('quota:get'),
          'system.quota.getFailed',
        );
      }
      return quotaManager.getQuotaInfo(quotaId);
    } catch (err: unknown) {
      logger.error('quota:get failed', err);
      return createQuotaOperationFailure(err, 'system.quota.getFailed');
    }
  });

  ipcMain.handle('quota:consume', async (_event, payload: unknown) => {
    try {
      const quotaId = readQuotaId(payload);
      if (!quotaId) {
        return createQuotaOperationFailure(
          new QuotaIdRequiredError('quota:consume'),
          'system.quota.consumeFailed',
        );
      }
      return quotaManager.consume(quotaId);
    } catch (err: unknown) {
      logger.error('quota:consume failed', err);
      return createQuotaOperationFailure(err, 'system.quota.consumeFailed');
    }
  });

  logger.info('Quota IPC handlers registered');
}
