import { ENGINE_ERROR_CODES } from '../../../shared/errorClassifier';
import type { ToolCallId } from '../../../contracts';

export const TOOL_PROTOCOL_ERROR_FUSE_THRESHOLD = 4;

export interface ToolProtocolFuseError extends Error {
  readonly name: 'ToolProtocolFuseError';
  readonly errorCode: typeof ENGINE_ERROR_CODES.TOOL_PROTOCOL_FUSE;
}

export interface ToolProtocolErrorAudit {
  toolName: string;
  toolCallId?: ToolCallId;
  rawArguments?: string;
  parsedArguments: Record<string, unknown>;
  error: string;
}

type ProtocolExecLike = {
  errorKind?: 'protocol' | 'execution' | 'capability';
  error?: string;
};

export function applyProtocolFuseState(local: Record<string, unknown>, nextCount: number): void {
  if (nextCount > 0) {
    local._consecutiveToolProtocolErrors = nextCount;
    return;
  }

  delete local._consecutiveToolProtocolErrors;
}

export function checkProtocolFuse(params: {
  local: Record<string, unknown>;
  exec: ProtocolExecLike;
  toolName: string;
  toolCallId?: ToolCallId;
  rawArguments?: string;
  parsedArguments: Record<string, unknown>;
}): {
  isProtocolError: boolean;
  nextCount: number;
  shouldFuse: boolean;
  protocolErrorAudit?: ToolProtocolErrorAudit;
} {
  const isProtocolError = params.exec.errorKind === 'protocol';

  const protocolErrorAudit = isProtocolError
    ? {
        toolName: params.toolName,
        ...(params.toolCallId === undefined ? {} : { toolCallId: params.toolCallId }),
        ...(params.rawArguments === undefined ? {} : { rawArguments: params.rawArguments }),
        parsedArguments: params.parsedArguments,
        error: params.exec.error ?? 'unknown protocol error',
      }
    : undefined;

  const previousCount =
    typeof params.local._consecutiveToolProtocolErrors === 'number'
      ? (params.local._consecutiveToolProtocolErrors as number)
      : 0;
  const nextCount = isProtocolError ? previousCount + 1 : 0;

  return {
    isProtocolError,
    nextCount,
    shouldFuse: isProtocolError && nextCount >= TOOL_PROTOCOL_ERROR_FUSE_THRESHOLD,
    ...(protocolErrorAudit === undefined ? {} : { protocolErrorAudit }),
  };
}

export function createToolProtocolFuseError(
  nextCount: number,
  error: string | undefined
): ToolProtocolFuseError {
  const fuseError = new Error(
    `[ToolNode] Consecutive tool protocol errors reached fuse threshold (${nextCount}): ${error ?? 'unknown protocol error'}`
  ) as ToolProtocolFuseError;
  Object.defineProperty(fuseError, 'name', {
    value: 'ToolProtocolFuseError',
    enumerable: false,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(fuseError, 'errorCode', {
    value: ENGINE_ERROR_CODES.TOOL_PROTOCOL_FUSE,
    enumerable: true,
    writable: false,
  });
  return fuseError;
}
