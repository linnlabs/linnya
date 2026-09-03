import { Logger } from '../../../shared/logger';
import { noopTelemetry } from '../../telemetry/noopTelemetry';
import type { TelemetryPort } from '../../telemetry/telemetryPort';
import { noopAudit } from '../../audit/noopAudit';
import { emitAuditEnvelope } from '../../audit/emitAudit';
import type { AuditPort } from '../../../ports';
import type {
  AgentSpecToolObservationGovernancePolicy,
  RoutedRuntimeEvent,
  RunId,
  RuntimeEvent,
  RuntimeResourceRef,
  ToolCallId,
} from '../../../contracts';
import { parseRuntimeEvents, runIdFromTurnId, toSerializableJsonValue } from '../../../contracts';
import type { ToolControlInfo } from '../../tools/ui-types';
import type {
  ObservationPreviewPort,
  ToolExecutionPort,
  ToolCatalogPort,
  ToolExecutionResult,
  ToolModelInputCapabilityValidatorPort,
} from '../../tools/ports';
import type { ToolModelInputResolverPort } from '../../tools/model-input';
import type { ToolModelInputDelivery } from '../../tools/model-input';
import type { ModelInputRequirement } from '../../llm/input-capabilities';
import { resolveToolModelInput } from '../../tools/model-input';
import type { GraphNode, EngineState, NodeResult, StandardToolCall } from '../types';
import { resolveFinalAnswerFromToolControl } from './toolNode.finalAnswerProjector';
import { ToolNodeEventBridge } from './toolNode.eventBridge';
import { applyObservationGovernance } from './toolNode.observationGovernance';
import {
  applyProtocolFuseState,
  createToolProtocolFuseError,
  checkProtocolFuse,
} from './toolNode.protocolFuse';
import { isRecord, parseJsonSafe } from './toolNode.helpers';
import type { UnknownRecord } from './toolNode.helpers';
import {
  buildErrorLocalState,
  buildRequireUserLocalState,
  buildSuccessLocalState,
  extractToolControlInfo,
  validateStructuredToolResultContract,
} from './toolNode.stateTransitions';
import {
  prepareToolExecution,
  prepareToolNodeContext,
  type PreparedToolNodeContext,
} from './toolNode.executionSetup';
import {
  executeToolWithIdempotency,
  type ToolIdempotencyInFlightRegistry,
} from './toolNode.idempotency';
import { parsePendingToolCalls } from '../functions/parsePendingToolCalls';
import {
  isToolExecutionAbort,
  settlePendingToolCallsAfterAbort,
  settleToolCallsAfterExecutionAbort,
} from './toolNode.cancellation';
import { recordToolProtocolError } from '../../../shared/llmAuditRecorder';

const logger = new Logger('ToolNode');

function isAbortSignal(value: unknown): value is AbortSignal {
  return value !== null && typeof value === 'object' && 'aborted' in value;
}

function readToolObservationPolicy(
  local: UnknownRecord
): AgentSpecToolObservationGovernancePolicy | undefined {
  const executorLocal = local.executorLocal;
  if (executorLocal && typeof executorLocal === 'object' && !Array.isArray(executorLocal)) {
    const value = (executorLocal as Record<string, unknown>).toolObservationPolicy;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const policy: AgentSpecToolObservationGovernancePolicy = {};
      if (typeof record.enabled === 'boolean') {
        policy.enabled = record.enabled;
      }
      if (typeof record.maxChars === 'number' && Number.isFinite(record.maxChars)) {
        policy.maxChars = record.maxChars;
      }
      if (typeof record.maxLines === 'number' && Number.isFinite(record.maxLines)) {
        policy.maxLines = record.maxLines;
      }
      return Object.keys(policy).length > 0 ? policy : undefined;
    }
  }
  return undefined;
}

function readHistoryEvents(local: UnknownRecord): RuntimeEvent[] {
  return parseRuntimeEvents(local.history ?? []);
}

function readLastSuccessfulLlmModelId(local: UnknownRecord): string | undefined {
  const executorLocal = local.executorLocal;
  if (!isRecord(executorLocal)) {
    return undefined;
  }
  const value = executorLocal.lastSuccessfulLlmModelId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function formatCapabilityError(error: unknown): string {
  if (isRecord(error)) {
    const codeValue = error.errorCode ?? error.code;
    const code = typeof codeValue === 'string' ? codeValue.trim() : '';
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    if (code) {
      return `${code}: ${message || 'tool model input is not supported'}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function bindModelInputAdmission(input: {
  readonly context: PreparedToolNodeContext['toolContext'];
  readonly requirement: ModelInputRequirement;
  readonly delivery: ToolModelInputDelivery;
  readonly admitted: boolean;
}): void {
  input.context.modelInputAdmission = Object.freeze({
    requirement: Object.freeze({
      ...input.requirement,
      placements: Object.freeze([...input.requirement.placements]),
    }),
    delivery: input.delivery,
    admitted: input.admitted,
  });
}

function isOptionalImageInputIncompatibility(reason: string): boolean {
  return reason === 'image_input_unsupported' || reason === 'placement_unsupported';
}

function shouldDeliverToolModelInput(input: {
  readonly context: PreparedToolNodeContext['toolContext'];
  readonly delivery: ToolModelInputDelivery;
}): boolean {
  return input.delivery === 'required' || input.context.modelInputAdmission?.admitted === true;
}

type ToolNodeSuccessContext = PreparedToolNodeContext & {
  calls: StandardToolCall[];
  toolName: string;
  toolCallId: ToolCallId;
  exec: ToolExecutionResult;
  parsed: UnknownRecord;
  observation: string;
  attachments?: readonly RuntimeResourceRef[];
  bridge: ToolNodeEventBridge;
};

type ToolNodeErrorContext = PreparedToolNodeContext & {
  calls: StandardToolCall[];
  call: StandardToolCall;
  toolName: string;
  toolCallId: ToolCallId;
  toolArgs: Record<string, unknown>;
  exec: ToolExecutionResult;
  bridge: ToolNodeEventBridge;
};

export interface ToolNodeDependencies {
  toolRuntime: Pick<ToolCatalogPort, 'getToolDefinition'> & Pick<ToolExecutionPort, 'executeTool'>;
  observationPreview: ObservationPreviewPort;
  /**
   * 可选：宿主提供的 TelemetryPort 实现。
   * 不传时使用 noopTelemetry（observability 默认关闭，业务零影响）。
   */
  telemetryPort?: TelemetryPort;
  auditPort?: AuditPort;
  modelInputCapabilityValidator?: ToolModelInputCapabilityValidatorPort;
  modelInputResolver?: ToolModelInputResolverPort;
}

export class ToolNode implements GraphNode {
  id = 'tool';
  private readonly toolRuntime: Pick<ToolCatalogPort, 'getToolDefinition'> &
    Pick<ToolExecutionPort, 'executeTool'>;
  private readonly observationPreview: ObservationPreviewPort;
  private readonly telemetryPort: TelemetryPort;
  private readonly auditPort: AuditPort;
  private readonly modelInputCapabilityValidator?: ToolModelInputCapabilityValidatorPort;
  private readonly modelInputResolver?: ToolModelInputResolverPort;
  private readonly idempotencyInFlight: ToolIdempotencyInFlightRegistry = new Map();

  constructor(dependencies: ToolNodeDependencies) {
    this.toolRuntime = dependencies.toolRuntime;
    this.observationPreview = dependencies.observationPreview;
    this.telemetryPort = dependencies.telemetryPort ?? noopTelemetry;
    this.auditPort = dependencies.auditPort ?? noopAudit;
    this.modelInputCapabilityValidator = dependencies.modelInputCapabilityValidator;
    this.modelInputResolver = dependencies.modelInputResolver;
  }

  /**
   * B2-engine Batch 2: 上报 tool_call 事件到宿主侧 TelemetryPort。
   * 在 handleSuccess / handleError 入口处调用。
   */
  private emitToolCallTelemetry(args: {
    toolName: string;
    durationMs: number;
    ok: boolean;
    errorCode?: string;
    conversationId: string;
    turnId: string;
    runId?: RunId;
    parentRunId?: RunId;
  }): void {
    this.telemetryPort.emit({
      kind: 'tool_call',
      toolName: args.toolName,
      durationMs: args.durationMs,
      ok: args.ok,
      errorCode: args.errorCode,
      scope: {
        conversationId: args.conversationId || undefined,
        turnId: args.turnId,
        ...(args.runId === undefined ? {} : { runId: args.runId }),
        ...(args.parentRunId === undefined ? {} : { parentRunId: args.parentRunId }),
      },
    });
  }

  private async emitToolDecisionAudit(args: {
    action: 'tool.allow' | 'tool.deny';
    toolName: string;
    toolCallId: ToolCallId;
    reason: string;
    conversationId: string;
    turnId: string;
    runId?: RunId;
    parentRunId?: RunId;
    errorKind?: string;
  }): Promise<void> {
    await emitAuditEnvelope(this.auditPort, {
      parentRunId: args.parentRunId,
      action: args.action,
      actor: { kind: 'system' },
      decision: {
        outcome: args.action === 'tool.allow' ? 'allowed' : 'denied',
        reason: args.reason,
        metadata: {
          errorKind: args.errorKind,
        },
      },
      evidence: [
        {
          kind: 'tool_call',
          ref: args.toolCallId,
          summary: `${args.action} ${args.toolName}`,
        },
      ],
      scope: {
        conversationId: args.conversationId || undefined,
        turnId: args.turnId,
        runId: args.runId ?? runIdFromTurnId(args.turnId),
        ...(args.parentRunId === undefined ? {} : { parentRunId: args.parentRunId }),
        toolName: args.toolName,
        toolCallId: args.toolCallId,
      },
    });
  }

  private async emitToolProtocolErrorAudit(args: {
    toolName: string;
    toolCallId?: ToolCallId;
    rawArguments?: string;
    parsedArguments: Record<string, unknown>;
    error: string;
    conversationId: string;
    turnId: string;
    runId?: RunId;
    parentRunId?: RunId;
  }): Promise<void> {
    recordToolProtocolError({
      toolName: args.toolName,
      ...(args.toolCallId === undefined ? {} : { toolCallId: args.toolCallId }),
      ...(args.rawArguments === undefined ? {} : { rawArguments: args.rawArguments }),
      parsedArguments: args.parsedArguments,
      error: args.error,
    });

    const metadata = {
      ...(args.rawArguments === undefined ? {} : { rawArguments: args.rawArguments }),
      parsedArguments: args.parsedArguments,
    };
    const evidence = {
      kind: 'tool_protocol_error',
      ...(args.toolCallId === undefined ? {} : { ref: args.toolCallId }),
      summary: args.error,
    };

    await emitAuditEnvelope(this.auditPort, {
      parentRunId: args.parentRunId,
      action: 'tool.protocol_error',
      actor: { kind: 'system' },
      decision: {
        outcome: 'recorded',
        reason: args.error,
        metadata,
      },
      evidence: [evidence],
      scope: {
        conversationId: args.conversationId || undefined,
        turnId: args.turnId,
        runId: args.runId ?? runIdFromTurnId(args.turnId),
        ...(args.parentRunId === undefined ? {} : { parentRunId: args.parentRunId }),
        toolName: args.toolName,
        ...(args.toolCallId === undefined ? {} : { toolCallId: args.toolCallId }),
      },
    });
  }

  async run(state: EngineState): Promise<NodeResult> {
    const events: RoutedRuntimeEvent[] = [];

    while (true) {
      const result = await this.runNextPendingToolCall(state);
      if (Array.isArray(result.events) && result.events.length > 0) {
        events.push(...result.events);
      }

      if (result.kind === 'route' && result.nextNodeId === 'tool') {
        continue;
      }

      return {
        ...result,
        events,
      };
    }
  }

  private async runNextPendingToolCall(state: EngineState): Promise<NodeResult> {
    const calls = parsePendingToolCalls(state.local?.pendingToolCalls ?? []);
    const signalRaw = state.local?.signal;
    if (isAbortSignal(signalRaw) && signalRaw.aborted) {
      settlePendingToolCallsAfterAbort({
        state,
        calls,
        toolCatalog: this.toolRuntime,
      });
      const abortError = new Error('The user aborted a request.');
      abortError.name = 'AbortError';
      throw abortError;
    }

    const prepared = prepareToolNodeContext(state);
    logger.info('[ToolNode] 开始执行工具节点', {
      conversationId: prepared.conversationId,
      turnId: prepared.turnId,
      pendingCallCount: calls.length,
    });

    if (calls.length === 0) {
      return { kind: 'yield', events: [] };
    }

    const call = calls[0];
    const execution = prepareToolExecution({
      prepared,
      call,
      toolCatalog: this.toolRuntime,
    });
    if (!execution) {
      logger.warn('no tool name found in call');
      return { kind: 'yield', events: [] };
    }

    // ToolContext 会在同一 run 内复用；每次调用都必须先清除上一工具的准入事实。
    delete prepared.toolContext.modelInputAdmission;

    if (typeof execution.protocolError === 'string') {
      return this.handleError({
        ...prepared,
        calls,
        call,
        toolName: execution.toolName,
        toolCallId: execution.toolCallId,
        toolArgs: execution.toolArgs,
        exec: {
          success: false,
          error: execution.protocolError,
          errorKind: 'protocol',
          durationMs: 0,
        },
        bridge: execution.bridge,
      });
    }

    if (typeof execution.modelInputRequirementError === 'string') {
      return this.handleError({
        ...prepared,
        calls,
        call,
        toolName: execution.toolName,
        toolCallId: execution.toolCallId,
        toolArgs: execution.toolArgs,
        exec: {
          success: false,
          error: execution.modelInputRequirementError,
          errorKind: 'capability',
          durationMs: 0,
        },
        bridge: execution.bridge,
      });
    }

    if (execution.modelInputRequirement?.requires_image_input === true) {
      const activeModelId = readLastSuccessfulLlmModelId(prepared.local);
      let capabilityError: string | undefined;
      let admitted = true;
      if (!activeModelId) {
        capabilityError =
          'llm.unsupported_capability: missing successful LLM model for tool input validation';
      } else if (!this.modelInputCapabilityValidator) {
        capabilityError =
          'llm.unsupported_capability: tool model input validator is not configured';
      } else {
        const validationInput = {
          activeModelId,
          requirement: execution.modelInputRequirement,
        };
        if (execution.modelInputDelivery === 'when_supported') {
          try {
            const compatibility = this.modelInputCapabilityValidator.evaluate(validationInput);
            if (!compatibility.compatible) {
              if (isOptionalImageInputIncompatibility(compatibility.reason)) {
                admitted = false;
                logger.debug('optional tool model input omitted for incompatible active model', {
                  toolName: execution.toolName,
                  activeModelId,
                  reason: compatibility.reason,
                  placements: execution.modelInputRequirement.placements,
                });
              } else {
                this.modelInputCapabilityValidator.assertCompatible(validationInput);
                capabilityError = 'llm.unsupported_capability: active model is not eligible';
              }
            }
          } catch (error) {
            capabilityError = formatCapabilityError(error);
          }
        } else {
          try {
            this.modelInputCapabilityValidator.assertCompatible(validationInput);
          } catch (error) {
            capabilityError = formatCapabilityError(error);
          }
        }
      }

      if (capabilityError) {
        return this.handleError({
          ...prepared,
          calls,
          call,
          toolName: execution.toolName,
          toolCallId: execution.toolCallId,
          toolArgs: execution.toolArgs,
          exec: {
            success: false,
            error: capabilityError,
            errorKind: 'capability',
            durationMs: 0,
          },
          bridge: execution.bridge,
        });
      }

      bindModelInputAdmission({
        context: prepared.toolContext,
        requirement: execution.modelInputRequirement,
        delivery: execution.modelInputDelivery,
        admitted,
      });
    }

    await this.emitToolDecisionAudit({
      action: 'tool.allow',
      toolName: execution.toolName,
      toolCallId: execution.toolCallId,
      reason: 'tool call passed protocol validation',
      conversationId: prepared.conversationId,
      turnId: prepared.turnId,
      runId: prepared.toolContext.runId,
      parentRunId: prepared.toolContext.parentRunId,
    });

    // tool_process(start) 是“实际开始执行”的事实，不是参数或能力准入的占位。
    // 所有拒绝分支都在上面结算为配对 tool_output(error)，因此这里是唯一启动边界。
    execution.bridge.emitToolProcess('start', 'loading', {
      args: execution.toolArgs,
      tool_calls: [call],
    });

    try {
      const exec = await executeToolWithIdempotency({
        idempotencyKey: execution.idempotencyKey,
        inFlight: this.idempotencyInFlight,
        history: readHistoryEvents(prepared.local),
        toolName: execution.toolName,
        execute: () =>
          this.toolRuntime.executeTool(
            execution.toolName,
            execution.toolArgs,
            prepared.toolContext
          ),
      });
      if (exec.success) {
        const parsed = typeof exec.result === 'string' ? parseJsonSafe(exec.result) : exec.result;
        const contract = validateStructuredToolResultContract(parsed);
        if (!contract.ok) {
          return this.handleError({
            ...prepared,
            calls,
            call,
            toolName: execution.toolName,
            toolCallId: execution.toolCallId,
            toolArgs: execution.toolArgs,
            exec: {
              success: false,
              error: `TOOL_RESULT_CONTRACT_VIOLATION: ${contract.reason}`,
              errorKind: 'execution',
              durationMs: exec.durationMs,
            },
            bridge: execution.bridge,
          });
        }
        const deliverModelInput = shouldDeliverToolModelInput({
          context: prepared.toolContext,
          delivery: execution.modelInputDelivery,
        });
        // 可选附件不是幂等业务结果的一部分。缓存可能来自视觉模型，当前模型不兼容时不得复用。
        let attachments: readonly RuntimeResourceRef[] | undefined = deliverModelInput
          ? exec.cachedAttachments
          : undefined;
        try {
          if (deliverModelInput && !attachments) {
            attachments = await resolveToolModelInput({
              activeModelId: readLastSuccessfulLlmModelId(prepared.local),
              toolName: execution.toolName,
              toolCallId: execution.toolCallId,
              selections: contract.modelInputAttachments,
              context: prepared.toolContext,
              resolver: this.modelInputResolver,
              capabilityValidator: this.modelInputCapabilityValidator,
            });
          }
        } catch (error) {
          return this.handleError({
            ...prepared,
            calls,
            call,
            toolName: execution.toolName,
            toolCallId: execution.toolCallId,
            toolArgs: execution.toolArgs,
            exec: {
              success: false,
              error: formatCapabilityError(error),
              errorKind: 'capability',
              durationMs: exec.durationMs,
              idempotency: exec.idempotency,
            },
            bridge: execution.bridge,
          });
        }
        return this.handleSuccess({
          ...prepared,
          calls,
          toolName: execution.toolName,
          toolCallId: execution.toolCallId,
          exec,
          parsed: contract.result,
          observation: contract.observation,
          attachments,
          bridge: execution.bridge,
        });
      }

      return this.handleError({
        ...prepared,
        calls,
        call,
        toolName: execution.toolName,
        toolCallId: execution.toolCallId,
        toolArgs: execution.toolArgs,
        exec,
        bridge: execution.bridge,
      });
    } catch (error) {
      if (isToolExecutionAbort(error)) {
        settleToolCallsAfterExecutionAbort({
          state,
          remainingCalls: calls.slice(1),
          currentBridge: execution.bridge,
          toolCatalog: this.toolRuntime,
        });
      }
      throw error;
    } finally {
      await this.modelInputResolver?.completeToolModelInput({
        toolName: execution.toolName,
        toolCallId: execution.toolCallId,
        context: prepared.toolContext,
      });
    }
  }

  private async handleSuccess(context: ToolNodeSuccessContext): Promise<NodeResult> {
    this.emitToolCallTelemetry({
      toolName: context.toolName,
      durationMs: context.exec.durationMs,
      ok: true,
      conversationId: context.conversationId,
      turnId: context.turnId,
      runId: context.toolContext.runId,
      parentRunId: context.toolContext.parentRunId,
    });

    applyProtocolFuseState(context.local, 0);

    const observationGovernance = await applyObservationGovernance({
      parsed: context.parsed,
      toolName: context.toolName,
      toolContext: context.toolContext,
      structuredObservation: context.observation,
      observationPreview: this.observationPreview,
      policy: readToolObservationPolicy(context.local),
    });

    const control = extractToolControlInfo(context.parsed);
    if (control?.requireUser) {
      return this.handleRequireUserSuccess({ ...context, control });
    }

    const presentationMedia =
      context.parsed.media === undefined
        ? undefined
        : toSerializableJsonValue(context.parsed.media);
    const toolOutputMetadata = {
      ...(context.exec.idempotency
        ? {
            idempotency: {
              key: context.exec.idempotency.key,
              cache_hit: context.exec.idempotency.cacheHit,
            },
          }
        : {}),
      ...(observationGovernance.observationTruncation
        ? { observationTruncation: observationGovernance.observationTruncation }
        : {}),
      ...(presentationMedia !== undefined ? { presentation: { media: presentationMedia } } : {}),
    };
    context.bridge.emitToolOutput(
      {
        status: 'success',
        observation: observationGovernance.observation,
        data: context.parsed.data,
      },
      {
        attachments: context.attachments,
        metadata: Object.keys(toolOutputMetadata).length > 0 ? toolOutputMetadata : undefined,
        ephemeral: context.exec.idempotency?.cacheHit === true,
        durationMs: context.exec.durationMs,
      }
    );
    const finalAnswerProjection = resolveFinalAnswerFromToolControl(control?.finalAnswer);
    if (typeof finalAnswerProjection === 'string') {
      context.bridge.emitFinalAnswer({
        answer: finalAnswerProjection,
        sourceToolName: context.toolName,
      });
    }

    const remainingCalls = context.calls.slice(1);
    context.state.local = buildSuccessLocalState({
      local: context.local,
      remainingCalls,
      conversationId: context.conversationId,
      turnId: context.turnId,
      runtimeEvents: context.bridge.getRuntimeEvents(),
    });

    if (control?.terminateRun) {
      logger.info('[ToolNode] 收到 control.terminateRun，执行完工具后直接 yield 结束本轮 run', {
        toolName: context.toolName,
        toolCallId: context.toolCallId,
        conversationId: context.conversationId,
        turnId: context.turnId,
      });
      return { kind: 'yield', events: context.bridge.getRuntimeEvents() };
    }

    return {
      kind: 'route',
      nextNodeId: remainingCalls.length > 0 ? 'tool' : 'llm',
      events: context.bridge.getRuntimeEvents(),
    };
  }

  private handleRequireUserSuccess(
    context: ToolNodeSuccessContext & { control: ToolControlInfo }
  ): NodeResult {
    context.state.local = buildRequireUserLocalState({
      local: context.local,
      parsed: context.parsed,
      toolCallId: context.toolCallId,
      toolName: context.toolName,
      remainingCalls: context.calls.slice(1),
      conversationId: context.conversationId,
      turnId: context.turnId,
      runtimeEvents: context.bridge.getRuntimeEvents(),
    });

    return { kind: 'route', nextNodeId: 'wait_user', events: context.bridge.getRuntimeEvents() };
  }

  private async handleError(context: ToolNodeErrorContext): Promise<NodeResult> {
    if (context.exec.errorKind === 'protocol' || context.exec.errorKind === 'capability') {
      await this.emitToolDecisionAudit({
        action: 'tool.deny',
        toolName: context.toolName,
        toolCallId: context.toolCallId,
        reason: context.exec.error ?? 'tool protocol validation failed',
        conversationId: context.conversationId,
        turnId: context.turnId,
        runId: context.toolContext.runId,
        parentRunId: context.toolContext.parentRunId,
        errorKind: context.exec.errorKind,
      });
    }
    this.emitToolCallTelemetry({
      toolName: context.toolName,
      durationMs: context.exec.durationMs,
      ok: false,
      errorCode: context.exec.errorCode ?? context.exec.errorKind,
      conversationId: context.conversationId,
      turnId: context.turnId,
      runId: context.toolContext.runId,
      parentRunId: context.toolContext.parentRunId,
    });

    const error = context.exec.error || 'tool_error';
    context.bridge.emitToolOutput(
      {
        status: 'error',
        observation: error,
        error,
        ...(context.exec.errorCode === undefined
          ? {}
          : { error_code: context.exec.errorCode }),
      },
      { durationMs: context.exec.durationMs }
    );

    const fuse = checkProtocolFuse({
      local: context.local,
      exec: context.exec,
      toolName: context.toolName,
      toolCallId: context.toolCallId,
      rawArguments: context.call.function?.arguments,
      parsedArguments: context.toolArgs,
    });
    if (fuse.protocolErrorAudit) {
      await this.emitToolProtocolErrorAudit({
        ...fuse.protocolErrorAudit,
        conversationId: context.conversationId,
        turnId: context.turnId,
        runId: context.toolContext.runId,
        parentRunId: context.toolContext.parentRunId,
      });
    }
    const remainingCalls = context.calls.slice(1);

    context.state.local = buildErrorLocalState({
      local: context.local,
      remainingCalls,
      conversationId: context.conversationId,
      turnId: context.turnId,
      runtimeEvents: context.bridge.getRuntimeEvents(),
      nextProtocolErrorCount: fuse.nextCount,
    });

    if (fuse.shouldFuse && remainingCalls.length === 0) {
      throw createToolProtocolFuseError(fuse.nextCount, context.exec.error);
    }

    return {
      kind: 'route',
      // 同一个 assistant.tool_calls batch 必须为每个 call 产出 tool_output。
      // 出错时也继续消费剩余 call，ToolNode.run 会在本节点内 drain 完 batch 再回 LLM。
      nextNodeId: remainingCalls.length > 0 ? 'tool' : 'llm',
      events: context.bridge.getRuntimeEvents(),
    };
  }
}
