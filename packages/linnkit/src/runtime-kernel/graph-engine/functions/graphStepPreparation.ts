import { ENGINE_STATE_SCHEMA_VERSION, type EngineState, type ExecutorLocalState } from '../types';
import { decideLlmInvocationState } from './llmInvocationState';

export type FinalStepPolicy = NonNullable<ExecutorLocalState['finalStepPolicy']>;

export interface GraphStepPreparationInput {
  state: EngineState;
  maxSteps: number;
  stepCount: number;
}

export interface GraphStepPreparationResult {
  state: EngineState;
  executorLocal: Record<string, unknown>;
}

function readExecutorLocal(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function resolveFinalStepPolicy(value: unknown): FinalStepPolicy {
  return value === 'force_tools' || value === 'final_answer' ? value : 'final_answer';
}

function resolveStepPhase(input: {
  nodeId: string;
  finalStepPolicy: FinalStepPolicy;
  remainingSteps: number;
  currentPhase: unknown;
}): unknown {
  if (input.nodeId !== 'llm') {
    return input.currentPhase ?? 'running';
  }

  if (input.finalStepPolicy === 'force_tools') {
    if (input.remainingSteps === 0) {
      return 'force_final_answer';
    }
    if (input.remainingSteps <= 2) {
      return 'force_tools';
    }
  }

  if (input.finalStepPolicy === 'final_answer' && input.remainingSteps < 2) {
    return 'force_final_answer';
  }

  return input.currentPhase ?? 'running';
}

export function prepareGraphStep(input: GraphStepPreparationInput): GraphStepPreparationResult {
  const rawLocal = input.state.local && typeof input.state.local === 'object' ? input.state.local : {};
  const localForStep: Record<string, unknown> = { ...(rawLocal as Record<string, unknown>) };

  const executorLocalForStep = readExecutorLocal(localForStep.executorLocal);
  executorLocalForStep.maxSteps = input.maxSteps;
  executorLocalForStep.stepCount = input.stepCount;
  executorLocalForStep.remainingSteps = input.maxSteps - input.stepCount;

  const finalStepPolicy = resolveFinalStepPolicy(executorLocalForStep.finalStepPolicy);
  executorLocalForStep.phase = resolveStepPhase({
    nodeId: input.state.nodeId,
    finalStepPolicy,
    remainingSteps: input.maxSteps - input.stepCount,
    currentPhase: executorLocalForStep.phase,
  });
  localForStep.executorLocal = executorLocalForStep;

  let nextState: EngineState = {
    ...input.state,
    schemaVersion: input.state.schemaVersion ?? ENGINE_STATE_SCHEMA_VERSION,
    local: localForStep,
  };

  const invocationState = decideLlmInvocationState({
    nodeId: nextState.nodeId,
    previousInvocationCount: executorLocalForStep.llmInvocationCount,
  });
  if (invocationState) {
    executorLocalForStep.llmInvocationKind = invocationState.llmInvocationKind;
    executorLocalForStep.llmInvocationCount = invocationState.llmInvocationCount;
    localForStep.executorLocal = executorLocalForStep;
    nextState = { ...nextState, local: localForStep };
  }

  return {
    state: nextState,
    executorLocal: executorLocalForStep,
  };
}
