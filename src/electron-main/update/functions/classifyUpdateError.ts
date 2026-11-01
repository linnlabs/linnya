import type { AppUpdateFailureKind } from '../../../shared/update/definitions/updateMessage';

export type ClassifiedUpdateError = AppUpdateFailureKind | 'cancelled';

const NETWORK_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT',
  'ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE',
]);

function readCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

/** 把 electron-updater、Squirrel.Mac 与 Node 网络错误归到用户能理解、能决定重试策略的类别。 */
export function classifyUpdateError(error: unknown): ClassifiedUpdateError {
  const code = readCode(error);
  const message = readMessage(error).toLowerCase();
  if ((error instanceof Error && error.name === 'CancellationError') || message === 'cancelled') return 'cancelled';
  if (code === 'ENOSPC' || message.includes('no space left')) return 'disk';
  if (
    code === 'ERR_CHECKSUM_MISMATCH'
    || message.includes('checksum mismatch')
    || message.includes('sha512')
    || message.includes('code signature')
    || message.includes('did not pass validation')
  ) {
    return 'integrity';
  }
  if (
    (code && NETWORK_CODES.has(code))
    || message.includes('net::err_')
    || message.includes('socket hang up')
    || message.includes('timeout')
    || message.includes('network')
  ) {
    return 'network';
  }
  return 'unknown';
}
