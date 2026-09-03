import type { AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import { RegisteredChildRunInvoker, type RegisteredChildRunInvokerPort } from 'src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker';
import { createDefaultLlmNode } from 'src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory';
import { createLinnyaChildRunInvoker, toChildRunAgentConfig } from 'src/app-hosts/linnya/adapters/child-runs/childRunInvokerFactory';
import { LinnyaRegisteredChildRunLifecycle } from 'src/app-hosts/linnya/adapters/child-runs/childRunLifecycle';
import { BaseTool } from 'src/tools/types';
import * as testkit from '@linnlabs/linnkit/testkit';
import type { ScriptedInferenceHarness, ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import { createToolRuntimeHarness, type ToolRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import { audit, graph, runSupervisor, telemetry } from '@linnlabs/linnkit/runtime-kernel';
import { createScriptedChatModelCatalog } from './modelCatalogHarness';

export interface ChildRunHarnessOptions {
  turns: ScriptedLlmTurn[];
  tools: BaseTool[];
  agentDefinitions: AgentDefinition[];
}

export interface ChildRunHarness {
  invoker: RegisteredChildRunInvokerPort;
  getLlmCalls(): ReturnType<ScriptedInferenceHarness['getCalls']>;
  getToolExecutions(): ReturnType<ToolRuntimeHarness['getExecutions']>;
  assertAllTurnsConsumed(): void;
  restore(): void;
}

export function createChildRunHarness(options: ChildRunHarnessOptions): ChildRunHarness {
  const modelCatalog = createScriptedChatModelCatalog();
  const aiHarness = testkit.createScriptedInferenceHarness(options.turns, { modelCatalog });
  const toolHarness = createToolRuntimeHarness(options.tools);
  const agentDefinitionsByPromptKey = new Map<string, AgentDefinition>(
    options.agentDefinitions.map((definition) => [definition.promptKey, definition]),
  );
  const eventStore = new graph.MemoryEventStore();
  const childRunLifecycle = new LinnyaRegisteredChildRunLifecycle({
    supervisor: new runSupervisor.DefaultRunSupervisor({
      registryStore: new runSupervisor.MemoryRunRegistryStore(),
    }),
    eventStore,
    nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
    costCollector: {
      snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }),
    },
  });

  const invoker = new RegisteredChildRunInvoker({
    agentResolver: {
      resolveByPromptKey: (promptKey) => {
        const agentDefinition = agentDefinitionsByPromptKey.get(promptKey);
        if (!agentDefinition) {
          throw new Error(`No test AgentDefinition registered for promptKey: ${String(promptKey)}`);
        }
        return {
          agentDefinition,
          agentConfig: toChildRunAgentConfig(agentDefinition),
        };
      },
    },
    childRunInvoker: createLinnyaChildRunInvoker({
      telemetryPort: telemetry.noopTelemetry,
      auditPort: audit.noopAudit,
      createLlmNode: () => createDefaultLlmNode({
        llmCaller: aiHarness.getLlmCaller(),
        toolRuntime: toolHarness.toolRuntime,
        modelCatalog,
      }),
      toolRuntime: toolHarness.toolRuntime,
    }),
    lifecycle: childRunLifecycle,
  });

  return {
    invoker,
    getLlmCalls() {
      return aiHarness.getCalls();
    },
    getToolExecutions() {
      return toolHarness.getExecutions();
    },
    assertAllTurnsConsumed() {
      aiHarness.assertAllTurnsConsumed();
    },
    restore() {
      toolHarness.restore();
    },
  };
}
