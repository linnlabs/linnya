import { createHash } from 'node:crypto';
import { generateTurnId, type RunId, type RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { graph, type childRuns } from '@linnlabs/linnkit/runtime-kernel';
import type { RegisteredChildRunRequest } from './registeredSubagentInvoker';
import type { AgentDefinition } from '../../agent-registry/types';
import { freezeAgentRunInput } from '../../agent-registry/freezeAgentRunInput';
import type { AgentInvokeRequest } from '../../context/agent/contracts';
import { createDefaultModelResolver } from '../runtime-assembly/graphRuntimeFactory';
import { runnableDefinitionToAgentSpec } from '../runtime/agentDefinitionToAgentSpec';
import { RunDescriptorSchema, type RunDescriptor } from '../../application/run-resumption';
import {
  captureRuntimeCompatibility,
  requireRuntimeCompatibility,
} from '../../application/run-resumption/functions/runtimeCompatibility';
import type { LinnyaAgentRuntimeScope } from '../runtime-assembly/agentRuntimeScope';

export type DurableChildRuntime = Pick<
  LinnyaAgentRuntimeScope,
  'runDescriptors' | 'recoveryCheckpointer' | 'supervisor' | 'toolResults'
>;

/** 新任务缺少业务输入不是旧任务恢复损坏，应交回父 Agent 修正，不进入反复恢复。 */
export class ChildRequestAdmissionRejectedError extends Error {
  readonly code = 'CHILD_REQUEST_ADMISSION_REJECTED';
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(`Child request rejected: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.cause = cause;
    this.name = 'ChildRequestAdmissionRejectedError';
  }
}

export function stableChildSubrunId(parentRunId: string, parentToolCallId: string): string {
  return `subrun-${createHash('sha256')
    .update(JSON.stringify([parentRunId, parentToolCallId]))
    .digest('hex')}`;
}

/** 原 child 输入与恢复位置分别归 Descriptor / Checkpointer，不从父级新默认配置重造。 */
export async function prepareDurableChildInvocation(input: {
  runtime: DurableChildRuntime;
  params: RegisteredChildRunRequest;
  parent: RunDescriptor;
  agentDefinition: AgentDefinition;
  agentConfig: childRuns.ChildRunAgentConfig;
  runId: RunId;
  subrunId: string;
  parentToolCallId: string;
  modelId?: string;
  maxSteps?: number;
  seedHistory: readonly RuntimeEvent[];
}) {
  const { runtime, params, parent } = input;
  const descriptors = runtime.runDescriptors;
  const checkpointer = runtime.recoveryCheckpointer;
  if (!descriptors || !checkpointer) throw new Error('Child recovery is not assembled');
  let descriptor = await descriptors.load(input.runId);
  const record = (
    await runtime.supervisor.findByConversation(parent.conversationId, { includeChildren: true })
  ).find(run => run.runId === input.runId);
  if (descriptor) {
    if (
      descriptor.child?.parentRunId !== parent.runId ||
      descriptor.child.parentToolCallId !== input.parentToolCallId ||
      descriptor.child.subrunId !== input.subrunId ||
      descriptor.request.query !== params.userMessage ||
      descriptor.request.promptKey !== params.promptKey
    ) {
      throw new graph.RunRecoveryBlockedError(
        'Child invocation identity does not match the original call'
      );
    }
    requireRuntimeCompatibility(descriptor);
  } else {
    if (record) throw new graph.RunRecoveryBlockedError('Original child inputs are unavailable');
    const modelId =
      input.modelId ??
      input.agentConfig.modelPolicy?.modelId ??
      createDefaultModelResolver().resolveModelId();
    const candidate: AgentInvokeRequest = {
      query: params.userMessage,
      promptKey: params.promptKey,
      modelId,
      model_id: modelId,
      // 模型策略已解析为实际 child modelId；只有沿用父模型才继承其冻结偏好，
      // 固定异模型保留自身默认。此处只在新接纳执行，恢复不重算旧 child 的 effort。
      reasoning_effort:
        modelId === parent.request.model_id ? parent.request.reasoning_effort : undefined,
      maxSteps: input.maxSteps ?? 8,
      enableTools: true,
      availableTools: input.agentConfig.availableTools
        ? [...input.agentConfig.availableTools]
        : undefined,
      // 项目身份来自父级已接纳的输入，不让模型参数或临时 ToolContext 代填；
      // 不复制父业务 scope，子任务需要由目标角色接纳自己的问题与范围。
      project_metadata: parent.request.project_metadata,
      fences: params.parentToolContext.childRunContextInjections
        ? [...params.parentToolContext.childRunContextInjections]
        : undefined,
    };
    // 子运行和根运行都须先执行目标角色的首次接纳，再冻结真实系统提示。
    // 已存在 descriptor 的恢复分支不重走此处，避免新默认值覆盖旧范围。
    let admitted = candidate;
    try {
      if (input.agentDefinition.requestAdmission) {
        admitted = input.agentDefinition.requestAdmission(candidate, { history: input.seedHistory });
      }
    } catch (cause) {
      throw new ChildRequestAdmissionRejectedError(cause);
    }
    const request = freezeAgentRunInput(admitted);
    descriptor = RunDescriptorSchema.parse({
      schemaVersion: 1,
      runId: input.runId,
      conversationId: parent.conversationId,
      turnId: generateTurnId(),
      createdAt: Date.now(),
      child: {
        parentRunId: parent.runId,
        parentToolCallId: input.parentToolCallId,
        subrunId: input.subrunId,
      },
      agentSpec: runnableDefinitionToAgentSpec(input.agentDefinition),
      request,
      historyEventIds: input.seedHistory.map(event => event.id),
      incomingEventIds: [],
      runContext: {
        runId: input.runId,
        parentId: parent.runId,
        rootRunId: parent.runContext.rootRunId ?? parent.runId,
        traceId: parent.runContext.traceId,
        tags: { promptKey: params.promptKey },
      },
      toolContextPatch: {},
      executorLocal: {},
      commandPermission: parent.commandPermission,
      compatibility: captureRuntimeCompatibility(params.promptKey, modelId),
    });
  }
  const checkpoint = await checkpointer.load(input.runId);
  if (!checkpoint && record && (await descriptors.hasCommittedCheckpoint(input.runId))) {
    throw new graph.RunRecoveryBlockedError('Committed child checkpoint is missing');
  }
  if (record && record.status !== 'paused' && record.status !== 'completed') {
    throw new graph.RunRecoveryBlockedError(`Original child is ${record.status}`);
  }
  if (record?.status === 'completed' && checkpoint?.executionStatus !== 'yielded') {
    throw new graph.RunRecoveryBlockedError('Completed child result checkpoint is unavailable');
  }
  const history = record ? await descriptors.loadInputs(descriptor) : undefined;
  return { descriptor, record, checkpoint, checkpointer, seedHistory: history?.history };
}
