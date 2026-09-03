import type { TelemetryScope } from '../../telemetry/telemetryPort';
import type { EngineState } from '../types';
import type { RunId } from '../../../contracts';

export interface RuntimeRunIdInput {
  state: EngineState;
  fallbackRunId: RunId;
}

export interface RuntimeTelemetryScopeInput {
  state: EngineState;
  runId: RunId;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readLocalValue(state: EngineState, key: string): unknown {
  return state.local?.[key];
}

export function resolveRuntimeRunId(input: RuntimeRunIdInput): RunId {
  return input.state.local?.runId ?? input.fallbackRunId;
}

export function buildRuntimeTelemetryScope(input: RuntimeTelemetryScopeInput): TelemetryScope {
  return {
    conversationId: readNonEmptyString(readLocalValue(input.state, 'conversationId')),
    runId: input.runId,
    parentRunId: readNonEmptyString(readLocalValue(input.state, 'parentRunId')),
    turnId: readNonEmptyString(readLocalValue(input.state, 'turnId')),
  };
}
