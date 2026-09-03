import type { runSupervisor, telemetry } from '../../../runtime-kernel';
import {
  addCost,
  failure,
  isNonNegativeCost,
  parentByChild,
  readEventRunId,
  runIds,
  telemetryRunId,
} from './helpers';
import type {
  RunInvariantContext,
  RunInvariantFailure,
  RunInvariantValidator,
  ValidateRunInvariantsOptions,
} from './types';

type RunCost = runSupervisor.RunCost;
type RunRecord = runSupervisor.RunRecord;
type RunStatus = runSupervisor.RunStatus;
type TelemetryEvent = telemetry.TelemetryEvent;

const FINAL_STATUSES: ReadonlySet<RunStatus> = new Set(['completed', 'cancelled', 'failed']);

function findRootRecord(context: RunInvariantContext): RunRecord | undefined {
  return context.runRecords.find(record => record.runId === context.rootRunId);
}

export const validateI1FinalStatus: RunInvariantValidator = context => {
  const root = findRootRecord(context);
  if (!root) {
    return [failure('I1_FINAL_STATUS', 'RunRecord 缺失', `rootRunId ${context.rootRunId} 不存在`)];
  }
  if (!FINAL_STATUSES.has(root.status)) {
    return [
      failure('I1_FINAL_STATUS', 'RunRecord 未进入终态', `run ${root.runId} status=${root.status}`),
    ];
  }
  return [];
};

export const validateI2ChildrenCostTotal: RunInvariantValidator = async context => {
  if (!context.getCost) {
    return [];
  }

  const childIds = context.runRecords
    .filter(record => record.parentRunId === context.rootRunId)
    .map(record => record.runId);
  if (childIds.length === 0) {
    return [];
  }

  const parentCost = await context.getCost(context.rootRunId);
  const expected = (await Promise.all(childIds.map(runId => context.getCost?.(runId))))
    .filter((cost): cost is RunCost => cost !== undefined)
    .reduce<RunCost>((acc, cost) => addCost(acc, cost), {
      tokensInput: 0,
      tokensOutput: 0,
      latencyMs: 0,
    });
  const actual = parentCost.childrenTotal;
  if (!actual) {
    return [
      failure(
        'I2_CHILDREN_COST_TOTAL',
        '父 run 缺 childrenTotal',
        '存在子 run 但 parent cost 没有 childrenTotal',
        { childIds }
      ),
    ];
  }
  if (
    actual.tokensInput !== expected.tokensInput ||
    actual.tokensOutput !== expected.tokensOutput ||
    (actual.latencyMs ?? 0) !== (expected.latencyMs ?? 0)
  ) {
    return [
      failure(
        'I2_CHILDREN_COST_TOTAL',
        'childrenTotal 不等于子 run cost 之和',
        '父子成本聚合不一致',
        {
          expected,
          actual,
          childIds,
        }
      ),
    ];
  }
  return [];
};

export const validateI3ToolCallOutputPair: RunInvariantValidator = context => {
  const events = context.events ?? [];
  const toolCalls = events.filter(event => event.type === 'tool_call_decision');
  const outputs = new Set(
    events.filter(event => event.type === 'tool_output').map(event => event.tool_call_id)
  );
  return toolCalls
    .filter(event => !outputs.has(event.tool_call_id))
    .map(event =>
      failure(
        'I3_TOOL_CALL_OUTPUT_PAIR',
        '孤儿 ToolCall',
        `tool_call_id=${event.tool_call_id} 没有对应 tool_output`,
        { toolCallId: event.tool_call_id, toolName: event.tool_name }
      )
    );
};

export const validateI4LlmModelSelectAudit: RunInvariantValidator = context => {
  const telemetry = context.telemetryEvents ?? [];
  const audit = context.auditEnvelopes ?? [];
  const failures: RunInvariantFailure[] = [];
  for (const event of telemetry.filter(
    (candidate): candidate is Extract<TelemetryEvent, { kind: 'llm_call' }> =>
      candidate.kind === 'llm_call'
  )) {
    const runId = telemetryRunId(event);
    const matched = audit.some(envelope => {
      return envelope.action === 'model.select' && envelope.runId === runId;
    });
    if (!matched) {
      failures.push(
        failure(
          'I4_LLM_MODEL_SELECT_AUDIT',
          'LLM 调用缺 model.select 审计',
          `runId=${runId ?? '<missing>'} 的 llm_call 没有对应 model.select envelope`
        )
      );
    }
  }
  return failures;
};

export const validateI5CancelAudit: RunInvariantValidator = context => {
  const cancelledRuns = context.runRecords.filter(record => record.status === 'cancelled');
  return cancelledRuns
    .filter(
      record =>
        !(context.auditEnvelopes ?? []).some(envelope => {
          return envelope.runId === record.runId && envelope.action === 'run.cancel';
        })
    )
    .map(record =>
      failure(
        'I5_CANCEL_AUDIT',
        '取消缺 run.cancel 审计',
        `cancelled run ${record.runId} 没有 run.cancel envelope`
      )
    );
};

export const validateI6EventRunIdentity: RunInvariantValidator = context => {
  const known = runIds(context.runRecords);
  const failures: RunInvariantFailure[] = [];
  for (const event of context.events ?? []) {
    const eventRunId = readEventRunId(event);
    if (!eventRunId) {
      failures.push(
        failure(
          'I6_EVENT_RUN_IDENTITY',
          'RuntimeEvent 缺少正式 run 身份',
          `event ${event.id} 缺少顶层 run_id`,
          { eventId: event.id, eventType: event.type }
        )
      );
      continue;
    }
    if (!known.has(eventRunId)) {
      failures.push(
        failure(
          'I6_EVENT_RUN_IDENTITY',
          'RuntimeEvent 指向未知 run',
          `event ${event.id} run_id=${eventRunId} 不在 RunRecord 中`,
          { eventId: event.id, eventType: event.type, eventRunId }
        )
      );
    }
  }
  return failures;
};

export const validateI7PersistedEventOrder: RunInvariantValidator = context => {
  const events = context.persistedEvents ?? [];
  const failures: RunInvariantFailure[] = [];
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (current.eventStoreId <= previous.eventStoreId) {
      failures.push(
        failure(
          'I7_PERSISTED_EVENT_ORDER',
          'EventStore 事件 ID 非单调递增',
          `eventStoreId ${current.eventStoreId} should be > ${previous.eventStoreId}`,
          { previous: previous.eventStoreId, current: current.eventStoreId }
        )
      );
    }
  }
  return failures;
};

export const validateI8NoActionEvent: RunInvariantValidator = context => {
  return (context.events ?? [])
    .filter(event => {
      const eventType: string = event.type;
      return eventType === 'action';
    })
    .map(event =>
      failure(
        'I8_NO_ACTION_EVENT',
        '发现 RuntimeEvent.type=action',
        `event ${event.id} 使用了不存在的 action 协议类型`,
        { eventId: event.id }
      )
    );
};

export const validateI9CancelSignalStatus: RunInvariantValidator = context => {
  const root = findRootRecord(context);
  if (!root || !context.signal) {
    return [];
  }
  if (context.signal.aborted !== (root.status === 'cancelled')) {
    return [
      failure(
        'I9_CANCEL_SIGNAL_STATUS',
        'AbortSignal 与 RunRecord.cancelled 不一致',
        `signal.aborted=${context.signal.aborted}, status=${root.status}`
      ),
    ];
  }
  return [];
};

export function createI10TelemetryRunRegisteredValidator(
  options: Pick<ValidateRunInvariantsOptions, 'allowUnregisteredChildTelemetry'> = {}
): RunInvariantValidator {
  return context => {
    const known = runIds(context.runRecords);
    return (context.telemetryEvents ?? [])
      .filter(event => {
        const runId = telemetryRunId(event);
        if (!runId || known.has(runId)) {
          return false;
        }
        return !(options.allowUnregisteredChildTelemetry === true && event.scope.parentRunId);
      })
      .map(event =>
        failure(
          'I10_TELEMETRY_RUN_REGISTERED',
          'Telemetry 指向未知 run',
          `telemetry ${event.kind} runId=${telemetryRunId(event) ?? '<missing>'} 不在 RunRecord 中`,
          { eventKind: event.kind, scope: event.scope }
        )
      );
  };
}

export const validateI11CostNonNegative: RunInvariantValidator = async context => {
  if (!context.getCost) {
    return [];
  }
  const failures: RunInvariantFailure[] = [];
  for (const record of context.runRecords) {
    const cost = await context.getCost(record.runId);
    if (!isNonNegativeCost(cost)) {
      failures.push(
        failure('I11_COST_NON_NEGATIVE', 'RunCost 出现负数', `run ${record.runId} cost 包含负数`, {
          runId: record.runId,
          cost,
        })
      );
    }
  }
  return failures;
};

export const validateI12AuditRunRegistered: RunInvariantValidator = context => {
  const known = runIds(context.runRecords);
  const parentMap = parentByChild(context.runRecords);
  return (context.auditEnvelopes ?? [])
    .filter(envelope => !known.has(envelope.runId))
    .map(envelope =>
      failure(
        'I12_AUDIT_RUN_REGISTERED',
        'AuditEnvelope 指向未知 run',
        `audit ${envelope.action} runId=${envelope.runId} 不在 RunRecord 中`,
        {
          action: envelope.action,
          runId: envelope.runId,
          parentRunId: parentMap.get(envelope.runId),
        }
      )
    );
};

export const validateI13WaitUserStatus: RunInvariantValidator = context => {
  const records = new Map<string, RunRecord>(
    context.runRecords.map(record => [record.runId, record])
  );
  const failures: RunInvariantFailure[] = [];
  for (const event of context.events ?? []) {
    if (event.type !== 'requires_user_interaction') {
      continue;
    }
    const runId = readEventRunId(event);
    const record = runId ? records.get(runId) : undefined;
    if (!runId || !record) {
      failures.push(
        failure(
          'I13_WAIT_USER_STATUS',
          'wait_user 事件缺 RunRecord',
          `requires_user_interaction event ${event.id} 没有可关联的 RunRecord`,
          { eventId: event.id, runId }
        )
      );
      continue;
    }
    if (record.status !== 'awaiting_user' && !FINAL_STATUSES.has(record.status)) {
      failures.push(
        failure(
          'I13_WAIT_USER_STATUS',
          'wait_user 未进入 awaiting_user',
          `event ${event.id} 指向 run ${runId}，但 status=${record.status}`,
          { eventId: event.id, runId, status: record.status }
        )
      );
    }
  }
  return failures;
};

export const validateI14DetachedTerminalOutcome: RunInvariantValidator = context => {
  const records = new Map(context.runRecords.map(record => [record.runId, record]));
  return (context.terminalOutcomes ?? [])
    .filter(outcome => {
      const record = records.get(outcome.runId);
      return !record || record.status !== outcome.status || !FINAL_STATUSES.has(record.status);
    })
    .map(outcome =>
      failure(
        'I14_DETACHED_TERMINAL_OUTCOME',
        'detached outcome 与 RunRecord 不一致',
        `outcome runId=${outcome.runId} status=${outcome.status} 没有匹配的终态 RunRecord`,
        { outcome }
      )
    );
};

export const validateI15DrainNoInFlight: RunInvariantValidator = context => {
  const inFlight = context.inFlightRunIds ?? [];
  if (inFlight.length === 0) {
    return [];
  }
  return [
    failure(
      'I15_DRAIN_NO_INFLIGHT',
      'drain 后仍有 in-flight run',
      `in-flight run 未清空：${inFlight.join(', ')}`,
      { inFlightRunIds: [...inFlight] }
    ),
  ];
};
