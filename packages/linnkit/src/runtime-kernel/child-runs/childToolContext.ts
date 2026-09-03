import type { RunId, RuntimeEvent } from '../../contracts';
import { ENGINE_ERROR_CODES } from '../../shared/errorClassifier';
import {
  ensureToolContextRuntimeCapability,
  stripRuntimeReservedToolContextPatch,
} from '../tools/toolContextRuntime';
import {
  DEFAULT_MAX_CHILD_RUN_DEPTH,
  type ChildRunParentContext,
  type ChildRunToolContext,
} from './types';

export class ChildRunDepthExceededError extends Error {
  readonly name: 'ChildRunDepthExceededError' = 'ChildRunDepthExceededError';
  readonly errorCode: typeof ENGINE_ERROR_CODES.ENGINE_DELEGATE_DEPTH =
    ENGINE_ERROR_CODES.ENGINE_DELEGATE_DEPTH;

  constructor(
    readonly parentDepth: number,
    readonly maxDepth: number
  ) {
    super(`Child run depth limit exceeded: parent depth ${parentDepth}, max depth ${maxDepth}.`);
  }
}

export type ChildRunDepthDecision =
  | { allowed: true; nextDepth: number }
  | { allowed: false; parentDepth: number; maxDepth: number; error: string };

export function decideChildRunDepth(params: {
  parentToolContext: ChildRunParentContext;
  maxDepth?: number;
}): ChildRunDepthDecision {
  const parentDepth =
    typeof params.parentToolContext.childRunDepth === 'number' &&
    Number.isFinite(params.parentToolContext.childRunDepth)
      ? params.parentToolContext.childRunDepth
      : 0;
  const maxDepth = params.maxDepth ?? DEFAULT_MAX_CHILD_RUN_DEPTH;
  if (parentDepth >= maxDepth) {
    return {
      allowed: false,
      parentDepth,
      maxDepth,
      error: `Child run depth limit exceeded: parent depth ${parentDepth}, max depth ${maxDepth}.`,
    };
  }

  return {
    allowed: true,
    nextDepth: parentDepth + 1,
  };
}

export function createChildRunToolContext(params: {
  parentToolContext: ChildRunParentContext;
  conversationId: string;
  turnId: string;
  runId: RunId;
  parentRunId?: RunId;
  userQuery: string;
  modelId: string;
  seedHistory: ReadonlyArray<RuntimeEvent>;
  abortSignal?: AbortSignal;
  maxDepth?: number;
}): ChildRunToolContext {
  const inheritedContext = stripRuntimeReservedToolContextPatch(params.parentToolContext);
  const depthDecision = decideChildRunDepth({
    parentToolContext: params.parentToolContext,
    maxDepth: params.maxDepth,
  });
  if (!depthDecision.allowed) {
    throw new ChildRunDepthExceededError(depthDecision.parentDepth, depthDecision.maxDepth);
  }
  const childToolContext: ChildRunToolContext = {
    ...inheritedContext,
    userQuery: params.userQuery,
    modelId: params.modelId,
    childRunDepth: depthDecision.nextDepth,
    ...(params.parentToolContext.childRunContextInjections
      ? { childRunContextInjections: params.parentToolContext.childRunContextInjections }
      : {}),
    abortSignal: params.abortSignal ?? params.parentToolContext.abortSignal,
  };

  ensureToolContextRuntimeCapability({
    context: childToolContext,
    persistedHistory: params.seedHistory,
    workingHistory: params.seedHistory,
    executionMeta: {
      conversationId: params.conversationId,
      turnId: params.turnId,
      runId: params.runId,
      parentRunId: params.parentRunId,
    },
  });

  return childToolContext;
}
