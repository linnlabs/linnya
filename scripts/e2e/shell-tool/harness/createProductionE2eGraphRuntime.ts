import { graph, type llm } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentRunnerRuntimePort } from '../../../../src/app-hosts/linnya/adapters/flow/flow.agent-runner.service';
import type { LinnyaAgentRuntimeScope } from '../../../../src/app-hosts/linnya/adapters/runtime-assembly/agentRuntimeScope';
import { createDefaultLlmNode } from '../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory';
import { defaultObservationPreviewPort, defaultToolRuntimePort } from '../../../../src/app-hosts/linnya/adapters/tools/defaultPorts';
import { createToolModelInputCapabilityValidator } from '../../../../src/app-hosts/linnya/adapters/tools/modelInputCapabilityValidator';
import { releaseTerminalRunRecovery } from '../../../../src/app-hosts/linnya/application/run-resumption';

/**
 * packaged Agent 场景必须接入同一个正式执行事务：工具执行意图先提交，返回值才能形成 receipt。
 * 通用非持久化 Graph 夹具不能与 bootstrapAgentRuntimeSingletons 的恢复协议混装。
 */
export function createProductionE2eGraphRuntime(input: {
  readonly runtime: LinnyaAgentRuntimeScope;
  readonly llmCaller: llm.LlmCaller;
  readonly modelCatalog: llm.ModelCatalogLike;
  readonly maxSteps: number;
}): {
  readonly executor: graph.GraphExecutor;
  readonly recovery: NonNullable<AgentRunnerRuntimePort['recovery']>;
} {
  const { executionCheckpoints, recoveryCheckpointer, runDescriptors } = input.runtime;
  if (!executionCheckpoints || !recoveryCheckpointer || !runDescriptors) {
    throw new Error('Production E2E requires the bootstrapped durable Agent runtime');
  }
  const executor = new graph.GraphExecutor(recoveryCheckpointer, {
    maxSteps: input.maxSteps,
    executionCheckpointPort: executionCheckpoints,
  });
  executor.registerNode(new graph.UserNode());
  executor.registerNode(createDefaultLlmNode({
    llmCaller: input.llmCaller,
    modelCatalog: input.modelCatalog,
  }));
  executor.registerNode(new graph.ToolNode({
    toolRuntime: defaultToolRuntimePort,
    observationPreview: defaultObservationPreviewPort,
    modelInputCapabilityValidator: createToolModelInputCapabilityValidator(),
  }));
  executor.registerNode(new graph.WaitUserNode());
  return {
    executor,
    recovery: {
      bindings: executionCheckpoints,
      checkpointer: recoveryCheckpointer,
      descriptors: runDescriptors,
      releaseTerminalRun: runId => releaseTerminalRunRecovery({
        runId,
        supervisor: input.runtime.supervisor,
        clearCheckpoint: id => executor.clearCheckpoint(id),
        descriptors: runDescriptors,
      }),
    },
  };
}
