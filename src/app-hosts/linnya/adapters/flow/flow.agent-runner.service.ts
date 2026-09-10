/**
 * @file src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts
 * @description Agent模式运行服务（Agent Runner Service）
 *
 * 功能 (What):
 * 完整地执行一次 "Agent 模式" 的对话流程，包括：
 * - 使用 GraphExecutor 驱动状态图执行
 * - 通过 RuntimeEvent publisher 统一发布与持久化运行事实
 * - 处理摘要回调
 */

import { Logger } from 'src/shared/logger';
import {
  generateRuntimeEventId,
  generateToolCallId,
  type ContextUsageSnapshot,
} from '@linnlabs/linnkit/contracts';
import type { RoutedRuntimeEvent } from '@linnlabs/linnkit/contracts';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { KnowledgeBaseService } from 'src/features/knowledge-base/application/knowledgeBaseService';
import { FlowExecutionResult } from 'src/app-hosts/linnya/adapters/flow/flow.schemas';
import { DatabaseService } from 'src/electron-main/services/database';
import {
  createSseSummarizationRealtimePort,
  createSummarizationCallbacks,
} from 'src/app-hosts/linnya/adapters/flow/agent-runner/summarizationEventEmitter';
import { prepareRunBootstrap } from 'src/app-hosts/linnya/adapters/flow/agent-runner/runBootstrapper';
import { assembleExecutionPolicy } from 'src/app-hosts/linnya/adapters/flow/agent-runner/executionPolicyAssembler';
import {
  createRuntimeEventToolContextHostPorts,
  createToolContext,
} from 'src/app-hosts/linnya/adapters/context-injection/toolContextFactory';
import { SqliteSubrunTraceHistoryProjector } from 'src/app-hosts/linnya/adapters/persistence/subrun-trace-history/sqliteSubrunTraceHistoryProjector';
import {
  finalizeFailedRun,
  finalizeSuccessfulRun,
} from 'src/app-hosts/linnya/adapters/flow/agent-runner/runFinalizer';
import { RunLifecycleCoordinator } from 'src/app-hosts/linnya/adapters/flow/agent-runner/runLifecycleCoordinator';
import { resolveExecutionUserMessageId } from 'src/app-hosts/linnya/adapters/flow/agent-runner/functions/resolveExecutionUserMessageId';
import {
  createExecutionSettlement,
  publishRunFailureFact,
} from 'src/app-hosts/linnya/adapters/flow/execution-settlement';
import { runWithAgentAuditScope } from 'src/app-hosts/linnya/adapters/flow/agent-runner/runAuditScope';
import { recordRootRunTranscript } from 'src/app-hosts/linnya/adapters/flow/agent-runner/runAuditTranscript';
import type {
  FlowAgentRunExecution,
  FlowAgentRunRequest,
} from 'src/app-hosts/linnya/adapters/flow/flow.runner-handoff';
import type { WorkspaceMutationPublisher } from 'src/features/workspace/definitions/workspaceMutationPublisher';
import type { RegisteredChildRunInvokerPort } from 'src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker';
import type { LinnyaRunCostCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import type { CommandPermissionSettingsPort } from 'src/domains/commands/ports';
import type { ToolContext } from 'src/tools/types';
import { resolveCommandRunPermissionContext } from 'src/app-hosts/linnya/adapters/context-injection/commandRunPermissionContextBinding';
import {
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
} from '@app/schemas/commands';
import type { ShellToolRuntimePort } from 'src/app-hosts/linnya/adapters/commands/shell-runtime/definitions';
import type { PhysicalFileReaderPort } from 'src/app-hosts/linnya/application/file-read';
import type { ConversationWorkDirectoryAdmissionPort } from 'src/app-hosts/linnya/application/conversation-lifecycle';
import type {
  CommandAgentRunEndBarrier,
  CommandAgentRunLifecyclePort,
} from 'src/app-hosts/linnya/adapters/commands/process-owner';

const logger = new Logger('AgentRunnerService');
type GraphExecutor = graph.GraphExecutor;

export interface AgentRunnerRuntimePort {
  readonly costCollector: LinnyaRunCostCollector;
  readonly registeredChildRunInvoker: RegisteredChildRunInvokerPort;
  readonly commandPermissionSettings: CommandPermissionSettingsPort;
  readonly workspaceMutationPublisher: WorkspaceMutationPublisher;
  readonly physicalFileReader?: PhysicalFileReaderPort;
  readonly conversationWorkDirectoryAdmission?: ConversationWorkDirectoryAdmissionPort;
  readonly managedImageIngress?: ToolContext['managedImageIngress'];
  readonly toolResultAssetClaims?: ToolContext['toolResultAssetClaims'];
  readonly commandRuntime:
    | { readonly kind: 'disabled' }
    | {
        readonly kind: 'enabled';
        readonly shellToolRuntime: ShellToolRuntimePort;
        readonly agentRunLifecycle: CommandAgentRunLifecyclePort;
      };
}

/**
 * @class AgentRunnerService
 */
export class AgentRunnerService {
  /**
   * 构造函数
   *
   * @param {GraphExecutor} engine - 图执行引擎，用于驱动Agent模式的状态图执行
   * @param {KnowledgeBaseService} knowledgeBaseService - 知识库服务，为工具执行提供上下文
   * @param {DatabaseService} databaseService - 工作区数据库服务，供 Workspace 类工具使用
   */
  constructor(
    private readonly engine: GraphExecutor,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly databaseService: DatabaseService,
    private readonly runtime: AgentRunnerRuntimePort,
  ) {}

  /**
   * 执行Agent模式的完整对话流程
   *
   * Agent模式会使用GraphExecutor来驱动状态图执行，支持工具调用、多轮对话和摘要功能。
   *
   * @param {FlowAgentRunRequest} runRequest - 单次 run 的显式 handoff contract
   * @returns {FlowAgentRunExecution} 同步返回 RunHandle，异步返回执行结果
   */
  run(runRequest: FlowAgentRunRequest): FlowAgentRunExecution {
    const result = this.execute(runRequest);
    return {
      handle: runRequest.runHandle,
      result,
      then: (onfulfilled, onrejected) => result.then(onfulfilled, onrejected),
    };
  }

  async discardCheckpoint(runId: string): Promise<void> {
    await this.engine.clearCheckpoint(runId);
  }

  private async execute(runRequest: FlowAgentRunRequest): Promise<FlowExecutionResult> {
    const {
      conversationId,
      turnId,
      request: enrichedReq,
      history,
      newEvents,
      options,
      hostPorts,
      runHandle,
      execution,
    } = runRequest;
    const signal = runHandle.signal;
    const { sequencer, realtimeSink, runtimeEventSink } = hostPorts;
    const executionStartedAtMs = Date.now();
    const userMessageId = resolveExecutionUserMessageId(history, newEvents);
    const lifecycleCoordinator = new RunLifecycleCoordinator({
      conversationId,
      turnId,
      options,
      ...(userMessageId ? { userMessageId } : {}),
    });
    const scopedRuntimeEventSink: graph.RuntimeEventSink = (event, source) =>
      runtimeEventSink(lifecycleCoordinator.enrichRuntimeEvent(event), source);
    const runtimeEventCommitPort = hostPorts.runtimeEventCommitPort;
    const scopedRuntimeEventCommitPort: graph.RuntimeEventCommitPort | undefined =
      runtimeEventCommitPort
        ? async (event, source) => {
            await runtimeEventCommitPort(
              lifecycleCoordinator.enrichRuntimeEvent(event),
              source,
            );
          }
        : undefined;
    const executionSettlement = createExecutionSettlement(
      {
        conversationId,
        turnId,
        executionId: sequencer.getExecutionId(),
        executionStartedAtMs,
        ...(userMessageId ? { userMessageId } : {}),
      },
      {
        publishRuntimeEvent: scopedRuntimeEventSink,
        drainPersistence: hostPorts.drainPersistence,
        runHandle,
        readRunIterationsUsed: async () => (await runHandle.meta()).iterationsUsed,
        clearCheckpoint: runId => this.engine.clearCheckpoint(runId),
        releaseRunResources: runId => this.runtime.costCollector.release(runId),
        now: () => Date.now(),
      }
    );

    logger.info(`Running Agent mode for conversation ${conversationId}`);
    const summarizationCallbacks = createSummarizationCallbacks({
      conversationId,
      turnId,
      runId: runHandle.runId,
      executionId: sequencer.getExecutionId(),
      realtimePort: createSseSummarizationRealtimePort(realtimeSink),
    });
    let commandAgentRunId: ReturnType<typeof CommandAgentRunIdSchema.parse> | undefined;
    let commandCleanupAttempted = false;
    let commandRunEndBarrier: CommandAgentRunEndBarrier | undefined;
    let settlementContextUsage: ContextUsageSnapshot | undefined;
    let executionStepCount = 0;
    let publishedRuntimeFailureFact: graph.RuntimeFailureFact | undefined;

    const endCommandAgentRun = async (): Promise<void> => {
      if (!commandAgentRunId || this.runtime.commandRuntime.kind !== 'enabled') return;
      commandCleanupAttempted = true;
      commandRunEndBarrier = await this.runtime.commandRuntime.agentRunLifecycle.endAgentRun({
        conversationId: CommandConversationIdSchema.parse(conversationId),
        agentRunId: commandAgentRunId,
      });
    };

    try {
      // resume 必须使用原 run 注册时冻结的请求，禁止从新请求或历史 metadata 猜 Agent 身份。
      const sessionRequest = execution.kind === 'resume' ? await runHandle.request() : enrichedReq;
      const bootstrap = await prepareRunBootstrap({
        databaseService: this.databaseService,
        conversationId,
        turnId,
        runId: runHandle.runId,
        request: sessionRequest,
      });
      const finalReq = bootstrap.finalReq;
      const toolContextPatch = bootstrap.toolContextPatch;
      const finalRunContext = bootstrap.finalRunContext;
      commandAgentRunId = CommandAgentRunIdSchema.parse(finalRunContext.runId);
      const commandRunPermission = resolveCommandRunPermissionContext({
        runOwner: runHandle,
        executionKind: execution.kind,
        rootAgentRunId: CommandAgentRunIdSchema.parse(
          finalRunContext.rootRunId ?? finalRunContext.runId,
        ),
        settingsPort: this.runtime.commandPermissionSettings,
      });
      /**
       * 统一 Audit Domain 的 run scope。
       *
       * LLM response/stream evidence 只在开发模式显式开启对应
       * `LINNYA_AUDIT_LEVEL` 时经过当前进程唯一的 AuditPort，并由 Audit Domain
       * 负责字段投影和容量限制。上下文身份仅用于审计 scope，不会进入供应商请求体或请求头；
       * 生产环境固定关闭这些高体积输入证据。
       */
      lifecycleCoordinator.configureRunContext(finalRunContext);

      const executeAgentRun = async (): Promise<{
        result: FlowExecutionResult;
        checkpointNodeId: string;
        waitUserEvent?: Extract<RoutedRuntimeEvent, { type: 'requires_user_interaction' }>;
      }> => {
        return await runWithAgentAuditScope(
          {
            conversationId,
            runId: finalRunContext.runId,
            traceId: finalRunContext.traceId,
          },
          async () => {
            const { executionStartNode, hostToolCall, executorLocal } = assembleExecutionPolicy({
              request: finalReq,
              options,
              newEvents,
            });
            // wire DTO 已在 Flow incoming-events feature 中一次性物化为 RuntimeEvent。
            const runtimeNewEvents = newEvents;
            const initialHistory = [...history, ...runtimeNewEvents];
            const hostToolBootstrap = hostToolCall
              ? graph.createHostToolCallBootstrap({
                  eventId: generateRuntimeEventId(),
                  conversationId,
                  turnId,
                  toolName: hostToolCall.tool_name,
                  toolCallId: generateToolCallId(),
                  args: hostToolCall.args,
                  history: initialHistory,
                  metadata: lifecycleCoordinator.getMappingContext().metadata,
                  completionMode: hostToolCall.completion_mode,
                })
              : undefined;
            const publishedHostToolDecision = hostToolBootstrap
              ? scopedRuntimeEventSink(hostToolBootstrap.decisionEvent, 'HostToolCallBootstrap')
              : undefined;
            const executionHistory = publishedHostToolDecision
              ? [...initialHistory, publishedHostToolDecision]
              : initialHistory;
            const toolContext = createToolContext({
              hostServices: {
                knowledgeBaseService: this.knowledgeBaseService,
                databaseService: this.databaseService,
                workspaceMutationPublisher: this.runtime.workspaceMutationPublisher,
                shellToolRuntime: this.runtime.commandRuntime.kind === 'enabled'
                  ? this.runtime.commandRuntime.shellToolRuntime
                  : undefined,
                physicalFileReader: this.runtime.physicalFileReader,
                conversationWorkDirectoryAdmission: this.runtime.conversationWorkDirectoryAdmission,
                managedImageIngress: this.runtime.managedImageIngress,
                toolResultAssetClaims: this.runtime.toolResultAssetClaims,
                commandRunPermission,
                signal,
              },
              hostPorts: createRuntimeEventToolContextHostPorts({
                runtimeEventSink: scopedRuntimeEventSink,
                conversationId,
                turnId,
                registeredChildRunInvoker: this.runtime.registeredChildRunInvoker,
                subrunTraceHistoryProjector: new SqliteSubrunTraceHistoryProjector(
                  this.databaseService.getDb(),
                ),
              }),
              request: finalReq,
              runContext: finalRunContext,
              toolContextPatch,
              history: executionHistory,
              conversationId,
              turnId,
            });

            try {
              const startNode = hostToolBootstrap?.nodeId ?? executionStartNode ?? 'user';
              const checkpointKey = runHandle.runId;
              await runHandle.markRunning({ currentNode: startNode });

              logger.info(`Starting execution from ${startNode} node`);
              const sessionLocal = {
                request: finalReq,
                history: executionHistory,
                executorLocal,
                newEvents,
                ...(hostToolBootstrap
                  ? {
                      pendingToolCalls: hostToolBootstrap.localPatch.pendingToolCalls,
                      ...(hostToolBootstrap.localPatch.toolBatchCompletionMode
                        ? {
                            toolBatchCompletionMode:
                              hostToolBootstrap.localPatch.toolBatchCompletionMode,
                          }
                        : {}),
                    }
                  : {}),
                toolContext,
                runtimeEventSink: scopedRuntimeEventSink,
                runtimeEventCommitPort: scopedRuntimeEventCommitPort,
                runtimeFailureFactSink: (failureFact: graph.RuntimeFailureFact) => {
                  publishedRuntimeFailureFact = failureFact;
                },
                summarizationCallbacks,
                conversationId,
                turnId,
                signal,
              };

              logger.info('开始执行 GraphExecutor.runUntilYield');
              const {
                events: graphEvents,
                stepCount,
                checkpoint,
              } = execution.kind === 'resume'
                ? await this.engine.resumeSession(checkpointKey, {
                    expectedRevision: execution.expectedCheckpointRevision,
                    expectedNodeId: 'wait_user',
                    nodeId: 'llm',
                    localPatch: sessionLocal,
                    maxSteps: finalReq.maxSteps,
                  })
                : await this.engine.startSession(
                    checkpointKey,
                    sessionLocal,
                    startNode,
                    { maxSteps: finalReq.maxSteps },
                  );
              logger.info(`GraphExecutor 完成：${stepCount} 步，最终节点：${checkpoint.nodeId}`);
              settlementContextUsage = graph.readCheckpointContextUsage(checkpoint.local);
              const waitUserEvents = graphEvents.filter(
                (
                  event
                ): event is Extract<RoutedRuntimeEvent, { type: 'requires_user_interaction' }> =>
                  event.type === 'requires_user_interaction'
              );

              const result = finalizeSuccessfulRun({
                conversationId,
                checkpointNodeId: checkpoint.nodeId,
                stepCount,
                events: hostPorts.getGeneratedEvents(),
              });
              recordRootRunTranscript({
                inputEvents: runtimeNewEvents,
                generatedEvents: result.events,
                availableTools: finalReq.availableTools,
              });
              return {
                result,
                checkpointNodeId: checkpoint.nodeId,
                waitUserEvent: waitUserEvents[waitUserEvents.length - 1],
              };
            } catch (error) {
              recordRootRunTranscript({
                inputEvents: runtimeNewEvents,
                generatedEvents: hostPorts.getGeneratedEvents(),
                availableTools: finalReq.availableTools,
              });
              throw error;
            }
          }
        );
      };

      const executionOutcome = await executeAgentRun();
      executionStepCount = executionOutcome.result.stepCount ?? 0;

      // wait_user 只是同一 run 的暂停点；真实终态必须在宣布成功前可靠收口进程。
      if (executionOutcome.checkpointNodeId !== 'wait_user') {
        await endCommandAgentRun();
      }

      await executionSettlement.settleSuccessfulExecution({
        checkpointNodeId: executionOutcome.checkpointNodeId,
        stepCount: executionStepCount,
        ...(executionOutcome.waitUserEvent
          ? { waitUserEvent: executionOutcome.waitUserEvent }
          : {}),
        ...(settlementContextUsage ? { contextUsage: settlementContextUsage } : {}),
      });

      return {
        ...executionOutcome.result,
        events: hostPorts.getGeneratedEvents(),
      };
    } catch (error) {
      if (!commandCleanupAttempted) {
        try {
          await endCommandAgentRun();
        } catch (cleanupError: unknown) {
          // 已有执行失败/取消时保留原主终因，清理失败作为第二条可观察事实。
          logger.error('Agent run 失败后的命令进程收口也失败', {
            conversationId,
            agentRunId: commandAgentRunId,
            cleanupError,
          });
        }
      }
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      const failureFact = isAbortError
        ? undefined
        : publishedRuntimeFailureFact ?? publishRunFailureFact(
            { conversationId, turnId, error },
            scopedRuntimeEventSink,
          );
      if (isAbortError) {
        logger.info(`Agent mode interrupted for conversation ${conversationId}`);
      } else {
        logger.error(`Agent mode failed for conversation ${conversationId}`, error);
      }

      try {
        const failedCheckpoint = await this.engine.peekCheckpoint(runHandle.runId);
        if (!settlementContextUsage) {
          settlementContextUsage = graph.readCheckpointContextUsage(failedCheckpoint?.local);
        }
        const checkpointLocal = failedCheckpoint?.local;
        const checkpointExecutorLocal = checkpointLocal?.executorLocal;
        if (
          checkpointExecutorLocal
          && typeof checkpointExecutorLocal === 'object'
          && 'stepCount' in checkpointExecutorLocal
          && typeof checkpointExecutorLocal.stepCount === 'number'
          && Number.isInteger(checkpointExecutorLocal.stepCount)
          && checkpointExecutorLocal.stepCount >= 0
        ) {
          executionStepCount = checkpointExecutorLocal.stepCount;
        }
      } catch (checkpointError: unknown) {
        // 可选展示事实和失败 execution 步数的读取失败不能阻止 failed/cancelled 终态收口。
        logger.error('Agent run 失败后无法接纳 checkpoint metrics', {
          conversationId,
          runId: runHandle.runId,
          checkpointError,
        });
      }

      if (isAbortError) {
        await executionSettlement.settleFailedExecution({
          kind: 'cancelled',
          stepCount: executionStepCount,
          abortReason: signal.reason,
          ...(settlementContextUsage ? { contextUsage: settlementContextUsage } : {}),
        });
      } else if (failureFact) {
        await executionSettlement.settleFailedExecution({
          kind: 'failed',
          stepCount: executionStepCount,
          failureFact,
          ...(settlementContextUsage ? { contextUsage: settlementContextUsage } : {}),
        });
      }

      return finalizeFailedRun({
        conversationId,
        events: hostPorts.getGeneratedEvents(),
        isAbortError,
      });
    } finally {
      // 此处已经离开 Graph、工具执行和执行结算流程，之后不会再产生该 run 的 tool call。
      commandRunEndBarrier?.release();
    }
  }
}
