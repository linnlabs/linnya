import type { AuditEnvelope, RuntimeEvent } from 'linnkit/contracts';
import {
  assertRunInvariants,
  createRunSupervisorHarness,
  validateRunInvariants,
  type RunInvariantReport,
} from 'linnkit/testkit';
import { events as runtimeEvents, type runSupervisor } from 'linnkit/runtime-kernel';
import { BaseTool, type ToolExecutionContext, type ToolParameterSchema } from 'src/tools/types';
import {
  createGraphLoopHarness,
  type GraphLoopHarness,
  type GraphLoopHarnessOptions,
  type GraphLoopHarnessRunResult,
} from 'src/app-hosts/linnya/testkit/agent-harness/graphLoopHarness';
import type { ScriptedLlmTurn } from 'linnkit/testkit';
import { RunIdSchema } from 'linnkit/contracts';

export type AgentScenarioFailureInjection =
  | { kind: 'llm_throw'; atCall: number; message: string }
  | { kind: 'tool_throw'; toolName: string; atCall: number; message: string }
  | { kind: 'cancel_mid_llm'; atCall: number; reason: string };

export interface AgentScenarioOptions {
  turns: ScriptedLlmTurn[];
  tools?: BaseTool[];
  query?: string;
  conversationId?: string;
  turnId?: string;
  runId?: string;
  maxSteps?: number;
  failureInjection?: AgentScenarioFailureInjection;
  requestPatch?: GraphLoopHarnessOptions['requestPatch'];
  toolContextPatch?: GraphLoopHarnessOptions['toolContextPatch'];
}

export interface AgentScenarioResult {
  handle: runSupervisor.RunHandle<runSupervisor.RunRequestSnapshot>;
  graphResult?: GraphLoopHarnessRunResult;
  events: RuntimeEvent[];
  auditEnvelopes: AuditEnvelope[];
  lifecycle: runSupervisor.RunRecord[];
  cost: Awaited<ReturnType<runSupervisor.RunHandle<runSupervisor.RunRequestSnapshot>['cost']>>;
  runRecord: runSupervisor.RunRecord;
  invariantsReport: RunInvariantReport;
  graphHarness: GraphLoopHarness;
  restore(): void;
}

function cloneTurns(turns: readonly ScriptedLlmTurn[]): ScriptedLlmTurn[] {
  return turns.map(turn => ({ ...turn }));
}

function withLlmFailureInjection(
  turns: ScriptedLlmTurn[],
  injection: AgentScenarioFailureInjection | undefined,
  handle: runSupervisor.RunHandle<runSupervisor.RunRequestSnapshot>
): ScriptedLlmTurn[] {
  if (!injection || (injection.kind !== 'llm_throw' && injection.kind !== 'cancel_mid_llm')) {
    return turns;
  }

  const index = injection.atCall - 1;
  const target = turns[index];
  if (!target) {
    throw new Error(`failureInjection.atCall=${injection.atCall} 超出 scripted LLM turns 范围`);
  }

  if (injection.kind === 'cancel_mid_llm') {
    turns[index] = {
      ...target,
      assertCall(call) {
        target.assertCall?.(call);
        void handle.cancel({ reason: injection.reason });
      },
    };
  } else {
    turns[index] = {
      ...target,
      failure: { kind: 'provider', code: 'scripted_provider_failure', retryable: false },
    };
  }
  return turns;
}

class ThrowingToolWrapper extends BaseTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameterSchema;
  private callCount = 0;

  constructor(
    private readonly inner: BaseTool,
    private readonly atCall: number,
    private readonly message: string
  ) {
    super();
    this.name = inner.name;
    this.description = inner.description;
    this.parameters = inner.parameters;
  }

  async run(args: Record<string, unknown>, context: ToolExecutionContext): Promise<string> {
    this.callCount += 1;
    if (this.callCount === this.atCall) {
      throw new Error(this.message);
    }
    return this.inner.run(args, context);
  }
}

function withToolFailureInjection(
  tools: readonly BaseTool[],
  injection: AgentScenarioFailureInjection | undefined
): BaseTool[] {
  if (!injection || injection.kind !== 'tool_throw') {
    return [...tools];
  }
  return tools.map(tool => {
    if (tool.name !== injection.toolName) {
      return tool;
    }
    return new ThrowingToolWrapper(tool, injection.atCall, injection.message);
  });
}

function buildTerminalError(error: unknown): {
  errorCode: string;
  message: string;
  recoverable: boolean;
} {
  if (error instanceof Error && error.name === 'AbortError') {
    return { errorCode: 'RUN_CANCELLED', message: error.message, recoverable: false };
  }
  return {
    errorCode: 'RUN_FAILED',
    message: error instanceof Error ? error.message : String(error),
    recoverable: false,
  };
}

/**
 * Linnya host 级 agent scenario runner。
 *
 * 中文备注：
 * - 这里复用真实 graphLoopHarness、ToolNode、LlmNode、context builder；
 * - 不接 SQLite，只用 linnkit package-neutral run harness 承载 supervisor/audit/telemetry；
 * - 目标是测试协议不变量，不是给模型答案打分。
 */
export async function runAgentScenario(
  options: AgentScenarioOptions
): Promise<AgentScenarioResult> {
  const conversationId = options.conversationId ?? 'conv_scenario';
  const turnId = options.turnId ?? 'turn_scenario';
  const runId = options.runId ?? turnId;
  const runHarness = createRunSupervisorHarness<runSupervisor.RunRequestSnapshot>();
  const handle = await runHarness.registerRun({
    runId,
    conversationId,
    request: {
      query: options.query ?? '请执行测试场景',
      promptKey: 'default',
    },
  });

  const turns = withLlmFailureInjection(cloneTurns(options.turns), options.failureInjection, handle);
  const tools = withToolFailureInjection(options.tools ?? [], options.failureInjection);
  const graphHarness = createGraphLoopHarness({
    turns,
    tools,
    query: options.query,
    conversationId,
    turnId,
    maxSteps: options.maxSteps,
    requestPatch: options.requestPatch,
    toolContextPatch: {
      runId,
      abortSignal: handle.signal,
      ...(options.toolContextPatch ?? {}),
    },
    auditPort: runHarness.audit.port,
    telemetryPort: runHarness.telemetry.port,
  });

  let graphResult: GraphLoopHarnessRunResult | undefined;
  await handle.markRunning({ currentNode: 'user' });
  try {
    graphResult = await graphHarness.run();
    await handle.markCompleted({ iterationsUsed: graphResult.stepCount });
  } catch (error) {
    const failure = buildTerminalError(error);
    if (failure.errorCode === 'RUN_CANCELLED') {
      await handle.cancel({ reason: failure.message });
    } else {
      await handle.markFailed(failure);
    }
  }

  const events = graphHarness.getSinkRuntimeEvents();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (runtimeEvents.shouldPersistRuntimeEvent(event)) {
      await runHarness.persist(event, `${String(index + 1).padStart(13, '0')}-0000`);
    }
  }

  const lifecycle = await runHarness.getRegisteredRuns();
  const runRecord = lifecycle.find(record => record.runId === runId);
  if (!runRecord) {
    throw new Error(`runAgentScenario 内部错误：找不到 RunRecord ${runId}`);
  }

  const invariantsReport = await validateRunInvariants({
    rootRunId: runId,
    runRecords: lifecycle,
    events,
    persistedEvents: await runHarness.eventStore.range(conversationId),
    telemetryEvents: runHarness.telemetry.getEvents(),
    auditEnvelopes: runHarness.audit.getEnvelopes(),
    signal: handle.signal,
    getCost: id => runHarness.telemetry.costCollector.snapshot(RunIdSchema.parse(id)),
  });

  assertRunInvariants(invariantsReport);

  return {
    handle,
    graphResult,
    events,
    auditEnvelopes: runHarness.audit.getEnvelopes(),
    lifecycle,
    cost: await handle.cost(),
    runRecord,
    invariantsReport,
    graphHarness,
    restore(): void {
      graphHarness.restore();
      runHarness.restore();
    },
  };
}
