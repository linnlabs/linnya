import { createHash } from 'node:crypto';
import { generateTurnId, type RunId } from '@linnlabs/linnkit/contracts';
import { graph, type childRuns } from '@linnlabs/linnkit/runtime-kernel';
import type { RegisteredChildRunRequest } from './registeredSubagentInvoker';
import type { AgentDefinition } from '../../agent-registry/types';
import { freezeAgentRunInput } from '../../agent-registry/freezeAgentRunInput';
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
  seedHistory: readonly { id: string }[];
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
    const request = freezeAgentRunInput({
      query: params.userMessage,
      promptKey: params.promptKey,
      modelId,
      model_id: modelId,
      maxSteps: input.maxSteps ?? 8,
      enableTools: true,
      availableTools: input.agentConfig.availableTools
        ? [...input.agentConfig.availableTools]
        : undefined,
      fences: params.parentToolContext.childRunContextInjections
        ? [...params.parentToolContext.childRunContextInjections]
        : undefined,
    });
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
