import { Logger } from '../../../../shared/logger';
import { decideRunModelLockPatch } from '../../functions/runModelLock';
import type { TickAroundMiddleware, TickMiddlewarePatch } from '../types';

const logger = new Logger('GraphAgentExecutor');

export const runModelLockMiddleware: TickAroundMiddleware = async (ctx, stage, next): Promise<TickMiddlewarePatch | void> => {
  await next();

  const decision = decideRunModelLockPatch({
    stageId: stage.id,
    appliedFallbackModelId: ctx.cloudQuotaFallbackAppliedModelId,
    currentRunLockedModelId: ctx.executorLocalPatch?.runLockedModelId ?? ctx.executorLocal?.runLockedModelId,
  });
  if (!decision.executorLocalPatch) {
    return;
  }

  if (decision.shouldLog) {
    logger.warn(`检测到云端额度降级，已锁定本 run 后续模型: ${ctx.modelId} -> ${decision.executorLocalPatch.runLockedModelId}`);
  }

  return {
    executorLocalPatch: decision.executorLocalPatch,
  };
};
