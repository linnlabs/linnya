import {
  parseUserFacingMessage,
  type UserFacingMessage,
} from '@app/schemas';

/**
 * @file apps/renderer/shared/quota/quotaClient.ts
 *
 * @description
 * 渲染端通用配额 client（配合主进程 quota-ipc.ts）。
 *
 * 设计目标：
 * - 统一处理 window.electronAPI.invoke + 结构化校验
 * - 业务侧只关心 quotaId（例如 deep_research）
 */

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export interface QuotaInfo {
  success: true;
  quotaId: string;
  windowType: 'iso_week';
  windowKey: string;
  usedCount: number;
  limit: number;
  isExceeded: boolean;
  resetAt: number;
}

export interface QuotaConsumeInfo extends QuotaInfo {
  allowed: boolean;
}

export type QuotaResult =
  | QuotaInfo
  | QuotaConsumeInfo
  | { success: false; error?: string; userMessage?: UserFacingMessage };

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseQuotaResult(raw: unknown): QuotaResult | null {
  if (!isRecord(raw)) return null;
  const success = raw['success'];
  if (success === false) {
    const error = readString(raw['error']);
    const userMessage = parseUserFacingMessage(raw['userMessage']);
    return {
      success: false,
      ...(error ? { error } : {}),
      ...(userMessage ? { userMessage } : {}),
    };
  }
  if (success !== true) return null;

  const quotaId = readString(raw['quotaId']);
  const windowType = readString(raw['windowType']);
  const windowKey = readString(raw['windowKey']);
  const usedCount = readNumber(raw['usedCount']);
  const limit = readNumber(raw['limit']);
  const isExceeded = readBoolean(raw['isExceeded']);
  const resetAt = readNumber(raw['resetAt']);

  if (!quotaId || !windowType || !windowKey) return null;
  if (windowType !== 'iso_week') return null;
  if (usedCount === null || limit === null || isExceeded === null || resetAt === null) return null;

  const allowed = readBoolean(raw['allowed']);
  if (allowed !== null) {
    return {
      success: true,
      quotaId,
      windowType: 'iso_week',
      windowKey,
      usedCount,
      limit,
      isExceeded,
      resetAt,
      allowed,
    };
  }

  return {
    success: true,
    quotaId,
    windowType: 'iso_week',
    windowKey,
    usedCount,
    limit,
    isExceeded,
    resetAt,
  };
}

async function invokeQuota(channel: 'quota:get' | 'quota:consume', quotaId: string): Promise<QuotaResult | null> {
  if (!window.electronAPI || typeof window.electronAPI.invoke !== 'function') return null;
  const raw = await window.electronAPI.invoke(channel, { quotaId });
  return parseQuotaResult(raw);
}

export async function getQuotaOrNull(quotaId: string): Promise<QuotaResult | null> {
  return await invokeQuota('quota:get', quotaId);
}

export async function consumeQuotaOrNull(quotaId: string): Promise<QuotaResult | null> {
  return await invokeQuota('quota:consume', quotaId);
}
