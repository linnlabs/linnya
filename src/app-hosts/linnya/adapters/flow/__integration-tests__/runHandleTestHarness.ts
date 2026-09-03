import { graph, runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentSpec } from '@linnlabs/linnkit/contracts';
import type { FlowRunnerHostPorts } from 'src/app-hosts/linnya/adapters/flow/flow.runner-handoff';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';

export async function createRunHandleForFlowTest(params: {
  conversationId: string;
  turnId: string;
  request: AgentInvokeRequest;
  hostPorts: FlowRunnerHostPorts;
}): Promise<runSupervisor.RunHandle<AgentInvokeRequest>> {
  const supervisor = new runSupervisor.DefaultRunSupervisor<AgentInvokeRequest>({
    registryStore: new runSupervisor.MemoryRunRegistryStore(),
  });
  const agentSpec: AgentSpec = {
    id: params.request.promptKey,
    version: '0.0.0',
    role: 'agent',
    capabilities: ['agent'],
    tools: Array.isArray(params.request.availableTools)
      ? params.request.availableTools.map(toolId => ({ toolId }))
      : [],
    contextPolicy: { profileId: 'agent' },
  };

  return supervisor.registerRun({
    runId: RunIdSchema.parse(params.turnId),
    conversationId: params.conversationId,
    agentSpec,
    request: params.request,
    eventBus: params.hostPorts.eventBus,
    eventStore: new graph.MemoryEventStore(),
    costCollector: {
      snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }),
    },
    metadata: {
      executionId: params.hostPorts.sequencer.getExecutionId(),
      turnId: params.turnId,
      traceId: params.request.review_run_id ?? params.turnId,
      originalSource: 'flow-test',
    },
  });
}
