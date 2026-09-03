import {
  createI10TelemetryRunRegisteredValidator,
  validateI1FinalStatus,
  validateI2ChildrenCostTotal,
  validateI3ToolCallOutputPair,
  validateI4LlmModelSelectAudit,
  validateI5CancelAudit,
  validateI6EventRunIdentity,
  validateI7PersistedEventOrder,
  validateI8NoActionEvent,
  validateI9CancelSignalStatus,
  validateI11CostNonNegative,
  validateI12AuditRunRegistered,
  validateI13WaitUserStatus,
  validateI14DetachedTerminalOutcome,
  validateI15DrainNoInFlight,
} from './validators';
import type {
  RunInvariantContext,
  RunInvariantFailure,
  RunInvariantId,
  RunInvariantReport,
  RunInvariantValidator,
  ValidateRunInvariantsOptions,
} from './types';

export type {
  RunInvariantContext,
  RunInvariantFailure,
  RunInvariantId,
  RunInvariantReport,
  RunInvariantValidator,
  ValidateRunInvariantsOptions,
} from './types';

export {
  createI10TelemetryRunRegisteredValidator,
  validateI1FinalStatus,
  validateI2ChildrenCostTotal,
  validateI3ToolCallOutputPair,
  validateI4LlmModelSelectAudit,
  validateI5CancelAudit,
  validateI6EventRunIdentity,
  validateI7PersistedEventOrder,
  validateI8NoActionEvent,
  validateI9CancelSignalStatus,
  validateI11CostNonNegative,
  validateI12AuditRunRegistered,
  validateI13WaitUserStatus,
  validateI14DetachedTerminalOutcome,
  validateI15DrainNoInFlight,
} from './validators';

const VALIDATORS = {
  I1_FINAL_STATUS: validateI1FinalStatus,
  I2_CHILDREN_COST_TOTAL: validateI2ChildrenCostTotal,
  I3_TOOL_CALL_OUTPUT_PAIR: validateI3ToolCallOutputPair,
  I4_LLM_MODEL_SELECT_AUDIT: validateI4LlmModelSelectAudit,
  I5_CANCEL_AUDIT: validateI5CancelAudit,
  I6_EVENT_RUN_IDENTITY: validateI6EventRunIdentity,
  I7_PERSISTED_EVENT_ORDER: validateI7PersistedEventOrder,
  I8_NO_ACTION_EVENT: validateI8NoActionEvent,
  I9_CANCEL_SIGNAL_STATUS: validateI9CancelSignalStatus,
  I10_TELEMETRY_RUN_REGISTERED: createI10TelemetryRunRegisteredValidator(),
  I11_COST_NON_NEGATIVE: validateI11CostNonNegative,
  I12_AUDIT_RUN_REGISTERED: validateI12AuditRunRegistered,
  I13_WAIT_USER_STATUS: validateI13WaitUserStatus,
  I14_DETACHED_TERMINAL_OUTCOME: validateI14DetachedTerminalOutcome,
  I15_DRAIN_NO_INFLIGHT: validateI15DrainNoInFlight,
} satisfies Record<RunInvariantId, RunInvariantValidator>;

export const STRICT_RUN_INVARIANT_IDS = Object.keys(VALIDATORS) as RunInvariantId[];

export async function validateRunInvariants(
  context: RunInvariantContext,
  options: ValidateRunInvariantsOptions = {},
): Promise<RunInvariantReport> {
  const enabled = new Set(options.enabled ?? STRICT_RUN_INVARIANT_IDS);
  for (const disabledId of options.disabled ?? []) {
    enabled.delete(disabledId);
  }

  const failures: RunInvariantFailure[] = [];
  for (const id of STRICT_RUN_INVARIANT_IDS) {
    if (!enabled.has(id)) {
      continue;
    }
    const validator = id === 'I10_TELEMETRY_RUN_REGISTERED'
      ? createI10TelemetryRunRegisteredValidator(options)
      : VALIDATORS[id];
    failures.push(...await validator(context));
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

export function assertRunInvariants(report: RunInvariantReport): void {
  if (report.ok) {
    return;
  }

  const message = report.failures
    .map((item) => `${item.id} ${item.title}: ${item.message}`)
    .join('\n');
  throw new Error(`Run invariant check failed:\n${message}`);
}
