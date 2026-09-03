import type { AuditEnvelope, RuntimeEvent } from '../../../contracts';
import type { graph, runSupervisor, telemetry } from '../../../runtime-kernel';

type PersistedEvent = graph.PersistedEvent;
type RunCost = runSupervisor.RunCost;
type RunRecord = runSupervisor.RunRecord;
type RunOutcome = runSupervisor.RunOutcome;
type TelemetryEvent = telemetry.TelemetryEvent;

export type RunInvariantId =
  | 'I1_FINAL_STATUS'
  | 'I2_CHILDREN_COST_TOTAL'
  | 'I3_TOOL_CALL_OUTPUT_PAIR'
  | 'I4_LLM_MODEL_SELECT_AUDIT'
  | 'I5_CANCEL_AUDIT'
  | 'I6_EVENT_RUN_IDENTITY'
  | 'I7_PERSISTED_EVENT_ORDER'
  | 'I8_NO_ACTION_EVENT'
  | 'I9_CANCEL_SIGNAL_STATUS'
  | 'I10_TELEMETRY_RUN_REGISTERED'
  | 'I11_COST_NON_NEGATIVE'
  | 'I12_AUDIT_RUN_REGISTERED'
  | 'I13_WAIT_USER_STATUS'
  | 'I14_DETACHED_TERMINAL_OUTCOME'
  | 'I15_DRAIN_NO_INFLIGHT';

export interface RunInvariantFailure {
  id: RunInvariantId;
  title: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RunInvariantReport {
  ok: boolean;
  failures: RunInvariantFailure[];
}

export interface RunInvariantContext {
  rootRunId: string;
  runRecords: readonly RunRecord[];
  events?: readonly RuntimeEvent[];
  persistedEvents?: readonly PersistedEvent[];
  telemetryEvents?: readonly TelemetryEvent[];
  auditEnvelopes?: readonly AuditEnvelope[];
  terminalOutcomes?: readonly RunOutcome[];
  inFlightRunIds?: readonly string[];
  signal?: AbortSignal;
  getCost?: (runId: string) => RunCost | Promise<RunCost>;
}

export type RunInvariantValidator = (
  context: RunInvariantContext,
) => RunInvariantFailure[] | Promise<RunInvariantFailure[]>;

export interface ValidateRunInvariantsOptions {
  enabled?: readonly RunInvariantId[];
  disabled?: readonly RunInvariantId[];
  /**
   * 中文备注：
   * N-3.B.0 只给同步 child-run 透传 runId，并未正式注册 child RunRecord。
   * 默认严格校验会暴露这个缺口；过渡测试可显式允许 parentRunId 场景下的未注册 child telemetry。
   */
  allowUnregisteredChildTelemetry?: boolean;
}
