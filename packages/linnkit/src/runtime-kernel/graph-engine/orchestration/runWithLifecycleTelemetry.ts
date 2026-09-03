import type {
  RunLifecycleTerminalReason,
  TelemetryPort,
  TelemetryScope,
} from '../../telemetry/telemetryPort';
import { buildRuntimeTelemetryScope, resolveRuntimeRunId } from '../functions/graphTelemetryScope';
import type { EngineState } from '../types';
import {
  CONTEXT_COMPACTION_FAILED_ERROR_CODE,
  CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE,
  RunIdSchema,
  type RunId,
} from '../../../contracts';
import { PRIMARY_PROMPT_CAPACITY_ERROR_CODE } from '../definitions/primaryPromptCapacityError';

type RunLifecycleTerminalPhase = 'completed' | 'failed' | 'cancelled';

export interface RunLifecycleTaskOutput<TResult> {
  result: TResult;
  finalState: EngineState;
  terminalReason: Extract<
    RunLifecycleTerminalReason,
    'completed' | 'awaiting_user' | 'step_budget_forced_completion' | 'step_budget_exhausted'
  >;
}

export interface RunWithLifecycleTelemetryInput<TResult> {
  checkpointKey: string;
  maxSteps: number;
  telemetryPort: TelemetryPort;
  loadInitialState: () => Promise<EngineState>;
  run: (
    initialState: EngineState,
    reportStepsUsed: (stepsUsed: number) => void,
  ) => Promise<RunLifecycleTaskOutput<TResult>>;
}

function isAbortError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  return Reflect.get(error, 'name') === 'AbortError';
}

function readErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const errorCode = Reflect.get(error, 'errorCode');
  if (typeof errorCode === 'string') return errorCode;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function resolveFailureTerminalReason(error: unknown): RunLifecycleTerminalReason {
  if (isAbortError(error)) return 'cancelled';
  const code = readErrorCode(error);
  if (
    code === PRIMARY_PROMPT_CAPACITY_ERROR_CODE
    || code === CONTEXT_COMPACTION_FAILED_ERROR_CODE
    || code === CONTEXT_COMPACTION_INSUFFICIENT_ERROR_CODE
  ) {
    return 'capacity_failed';
  }
  return 'failed';
}

function emitRunLifecycleSpawned(
  telemetryPort: TelemetryPort,
  runId: RunId,
  scope: TelemetryScope
): void {
  telemetryPort.emit({
    kind: 'run_lifecycle',
    runId,
    phase: 'spawned',
    scope,
  });
}

function emitRunLifecycleTerminal(
  telemetryPort: TelemetryPort,
  runId: RunId,
  phase: RunLifecycleTerminalPhase,
  scope: TelemetryScope,
  progress: {
    stepsUsed: number;
    maxSteps: number;
    terminalReason: RunLifecycleTerminalReason;
  },
): void {
  telemetryPort.emit({
    kind: 'run_lifecycle',
    runId,
    phase,
    ...progress,
    scope,
  });
}

export async function runWithLifecycleTelemetry<TResult>(
  input: RunWithLifecycleTelemetryInput<TResult>
): Promise<TResult> {
  let runId = RunIdSchema.parse(input.checkpointKey);
  let stepsUsed = 0;
  let initialState: EngineState;
  try {
    initialState = await input.loadInitialState();
    runId = resolveRuntimeRunId({ state: initialState, fallbackRunId: runId });
  } catch (error) {
    // 初始状态都没加载出来时，没有可信的 conversation/turn scope；空 scope 是刻意保留的故障事实。
    emitRunLifecycleSpawned(input.telemetryPort, runId, {});
    emitRunLifecycleTerminal(input.telemetryPort, runId, 'failed', {}, {
      stepsUsed,
      maxSteps: input.maxSteps,
      terminalReason: resolveFailureTerminalReason(error),
    });
    throw error;
  }

  let lifecyclePhase: RunLifecycleTerminalPhase = 'completed';
  let terminalReason: RunLifecycleTerminalReason = 'completed';
  let lifecycleScope = buildRuntimeTelemetryScope({ state: initialState, runId });
  emitRunLifecycleSpawned(input.telemetryPort, runId, lifecycleScope);

  try {
    const output = await input.run(initialState, (reportedStepsUsed) => {
      stepsUsed = reportedStepsUsed;
    });
    lifecycleScope = buildRuntimeTelemetryScope({ state: output.finalState, runId });
    terminalReason = output.terminalReason;
    return output.result;
  } catch (error) {
    lifecyclePhase = isAbortError(error) ? 'cancelled' : 'failed';
    terminalReason = resolveFailureTerminalReason(error);
    throw error;
  } finally {
    emitRunLifecycleTerminal(input.telemetryPort, runId, lifecyclePhase, lifecycleScope, {
      stepsUsed,
      maxSteps: input.maxSteps,
      terminalReason,
    });
  }
}
