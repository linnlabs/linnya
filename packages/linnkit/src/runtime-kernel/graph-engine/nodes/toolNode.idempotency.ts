import type { ToolExecutionResult } from '../../tools/ports';
import { findCachedToolOutputByIdempotencyKey } from '../../tools/idempotency/toolIdempotency';
import type { RuntimeEvent } from '../../../contracts';

export type ToolIdempotencyInFlightRegistry = Map<string, Promise<ToolExecutionResult>>;

function withIdempotencyMeta(
  result: ToolExecutionResult,
  idempotencyKey: string,
  cacheHit: boolean,
): ToolExecutionResult {
  if (!result.success) {
    return { ...result };
  }

  return {
    ...result,
    durationMs: cacheHit ? 0 : result.durationMs,
    idempotency: {
      key: idempotencyKey,
      cacheHit,
    },
  };
}

function cloneExecutionResult(result: ToolExecutionResult): ToolExecutionResult {
  return {
    ...result,
    idempotency: result.idempotency ? { ...result.idempotency } : undefined,
    cachedAttachments: result.cachedAttachments ? [...result.cachedAttachments] : undefined,
  };
}

export async function executeToolWithIdempotency(params: {
  idempotencyKey?: string;
  inFlight: ToolIdempotencyInFlightRegistry;
  history: ReadonlyArray<RuntimeEvent>;
  toolName: string;
  execute: () => Promise<ToolExecutionResult>;
}): Promise<ToolExecutionResult> {
  const idempotencyKey = params.idempotencyKey;
  if (!idempotencyKey) {
    return params.execute();
  }

  const cached = findCachedToolOutputByIdempotencyKey({
    history: params.history,
    toolName: params.toolName,
    idempotencyKey,
  });
  if (cached) {
    return {
      success: true,
      result: cached.result,
      durationMs: 0,
      cachedAttachments: cached.attachments,
      idempotency: {
        key: idempotencyKey,
        cacheHit: true,
      },
    };
  }

  const inFlight = params.inFlight.get(idempotencyKey);
  if (inFlight) {
    const result = await inFlight;
    return withIdempotencyMeta(result, idempotencyKey, result.success);
  }

  const execution = params.execute()
    .then((result) => withIdempotencyMeta(result, idempotencyKey, false));
  params.inFlight.set(idempotencyKey, execution);
  try {
    return cloneExecutionResult(await execution);
  } finally {
    if (params.inFlight.get(idempotencyKey) === execution) {
      params.inFlight.delete(idempotencyKey);
    }
  }
}
