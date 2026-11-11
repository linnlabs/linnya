import { isObjectLike } from '@linnya/foundation';
import type { KbGraphProgress } from '../definitions/kbGraphProgress';

export function coerceKbGraphProgress(payload: unknown): KbGraphProgress | null {
  if (!isObjectLike(payload)) return null;
  const kbId = typeof payload.kbId === 'string' ? payload.kbId : '';
  const percent = typeof payload.percent === 'number' ? payload.percent : null;
  const totalUnits = typeof payload.totalUnits === 'number' ? payload.totalUnits : null;
  const doneUnits = typeof payload.doneUnits === 'number' ? payload.doneUnits : null;
  const rawUpdatedAtSeconds = payload.updatedAtSeconds;
  const updatedAtSeconds = rawUpdatedAtSeconds === null || typeof rawUpdatedAtSeconds === 'number'
    ? rawUpdatedAtSeconds : null;

  if (kbId.trim().length === 0) return null;
  if (percent === null || totalUnits === null || doneUnits === null) return null;

  return {
    kbId,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    totalUnits: Math.max(0, Math.trunc(totalUnits)),
    doneUnits: Math.max(0, Math.trunc(doneUnits)),
    updatedAtSeconds,
  };
}

