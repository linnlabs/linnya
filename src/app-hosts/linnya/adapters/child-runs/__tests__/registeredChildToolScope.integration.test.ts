import { PromptKeys } from '@app/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { graph, runSupervisor, type childRuns } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentInvocationRequest } from '@linnlabs/linnkit/ports';
import { DatabaseService } from 'src/electron-main/services/database';
import type { ToolContext } from 'src/tools/types';
import { RunDescriptorSchema } from '../../../application/run-resumption';
import { captureRuntimeCompatibility } from '../../../application/run-resumption/functions/runtimeCompatibility';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import { SQLiteEventStore, LinnyaEventStoreAdapter } from '../../persistence/event-store';
import { SQLiteRunRegistryStore } from '../../persistence/run-registry';
import { SqliteRunDescriptorStore } from '../../persistence/run-descriptors';
import { SqliteRunAdmissionCommit } from '../../persistence/execution-commit/sqliteRunAdmissionCommit';
import { runnableDefinitionToAgentSpec } from '../../runtime/agentDefinitionToAgentSpec';
import { installRecoveryModelFixture } from '../../flow/__test-helpers__/createDurableFlowHarness';
import { ToolRegistry } from '../../tools/toolRegistry';
import { RegisteredChildRunInvoker } from '../registeredSubagentInvoker';
import { LinnyaRegisteredChildRunLifecycle } from '../childRunLifecycle';
import type { ResolvedRegisteredAgent } from '../registeredAgentResolver';
import * as agentDefinitions from '../../../agent-registry/agentDefinitionResolver';

beforeEach(() =>
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  })
);
afterEach(() => {
  vi.restoreAllMocks();
  clearPluginRuntimeStateForTests();
});

function resolved(
  promptKey: string,
  availableTools: readonly string[] | undefined
): ResolvedRegisteredAgent {
  return {
    agentDefinition: {
      id: promptKey,
      promptKey,
      defaultMode: 'agent',
      description: 'Execution scope fixture',
    },
    agentConfig: { id: promptKey, promptKey, availableTools },
  };
}

function parentContext(): ToolContext {
  return {
    conversationId: 'conversation-child-scope',
    runId: RunIdSchema.parse('parent-child-scope'),
    parentToolCallId: ToolCallIdSchema.parse('parent-tool-scope'),
    modelId: 'scripted-test-model',
    callerAgentId: 'parent-identity',
    registeredRootAllowedTools: ['root-only-tool'],
    authorizedHostToolCall: {
      toolName: 'root-only-tool',
      toolCallId: ToolCallIdSchema.parse('parent-tool-scope'),
    },
    registeredChildAllowedTools: Object.freeze(['parent_only']),
    conversationView: { getWorkingHistoryEvents: () => [], getPersistedHistoryEvents: () => [] },
  };
}

describe('registered child tool scope ownership', () => {
  it('并行兄弟不互改名单，嵌套 worker 使用自己的能力，undefined 清除父限制', async () => {
    const parent = parentContext();
    const observed = new Map<string, ToolContext>();
    const supervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
      registryStore: new runSupervisor.MemoryRunRegistryStore(),
    });
    const invoker = new RegisteredChildRunInvoker({
      agentResolver: {
        resolveByPromptKey: key =>
          resolved(
            key,
            key === PromptKeys.RESEARCH_AUTHOR_V1
              ? ['read_file', 'web_search']
              : key === PromptKeys.RESEARCH_ARGUMENT_REVIEW_V1
                ? []
                : key === PromptKeys.DEEP_WEB_SEARCH
                  ? ['search_web', 'assemble_web_sources']
                  : undefined
          ),
      },
      lifecycle: new LinnyaRegisteredChildRunLifecycle({
        supervisor,
        eventStore: new graph.MemoryEventStore(),
        nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
        costCollector: { snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }) },
      }),
      childRunInvoker: {
        async invoke(config) {
          observed.set(config.agentConfig.promptKey, config.parentToolContext);
          if (config.agentConfig.promptKey === PromptKeys.RESEARCH_AUTHOR_V1) {
            await invoker.invoke({
              promptKey: PromptKeys.DEEP_WEB_SEARCH,
              userMessage: 'Nested web worker',
              parentToolContext: { ...config.parentToolContext, runId: config.runId },
              tracePolicy: { subrunId: 'nested-web-child' },
            });
            await invoker.invoke({
              promptKey: PromptKeys.DEFAULT,
              userMessage: 'Unrestricted child',
              parentToolContext: { ...config.parentToolContext, runId: config.runId },
              tracePolicy: { subrunId: 'unrestricted-child' },
            });
          }
          return {
            subrunId: config.agentConfig.promptKey,
            success: true,
            finalAnswer: 'Done',
            events: [],
            stepCount: 1,
          };
        },
      },
    });
    await Promise.all([
      invoker.invoke({
        promptKey: PromptKeys.RESEARCH_AUTHOR_V1,
        userMessage: 'Author',
        parentToolContext: parent,
        tracePolicy: { subrunId: 'author-child' },
      }),
      invoker.invoke({
        promptKey: PromptKeys.RESEARCH_ARGUMENT_REVIEW_V1,
        userMessage: 'Reviewer',
        parentToolContext: parent,
        tracePolicy: { subrunId: 'reviewer-child' },
      }),
    ]);
    expect(parent.registeredChildAllowedTools).toEqual(['parent_only']);
    expect(observed.get(PromptKeys.RESEARCH_AUTHOR_V1)?.registeredChildAllowedTools).toEqual([
      'read_file',
      'web_search',
    ]);
    expect(
      observed.get(PromptKeys.RESEARCH_ARGUMENT_REVIEW_V1)?.registeredChildAllowedTools
    ).toEqual([]);
    expect(observed.get(PromptKeys.DEEP_WEB_SEARCH)?.registeredChildAllowedTools).toEqual([
      'search_web',
      'assemble_web_sources',
    ]);
    expect(observed.get(PromptKeys.DEFAULT)?.registeredChildAllowedTools).toBeUndefined();
    expect(
      Object.isFrozen(observed.get(PromptKeys.RESEARCH_AUTHOR_V1)?.registeredChildAllowedTools)
    ).toBe(true);
    expect(observed.get(PromptKeys.RESEARCH_AUTHOR_V1)).not.toBe(parent);
    for (const [promptKey, context] of observed) {
      expect(context.callerAgentId).toBe(promptKey);
      expect(context.registeredRootAllowedTools).toBeUndefined();
      expect(context.authorizedHostToolCall).toBeUndefined();
    }
    expect(parent.callerAgentId).toBe('parent-identity');
  });

  it('SQLite 中断恢复取原 child request 的名单，不因当前 resolver 扩权而授予写入', async () => {
    installRecoveryModelFixture();
    const registeredDefinition = agentDefinitions.findRegisteredAgentDefinitionByPromptKey(
      PromptKeys.DEFAULT
    );
    if (!registeredDefinition) throw new Error('Default fixture Agent is unavailable');
    const registeredDefinitionSpy = vi.spyOn(
      agentDefinitions,
      'findRegisteredAgentDefinitionByPromptKey'
    );
    registeredDefinitionSpy.mockReturnValue({
      ...registeredDefinition,
    });
    const database = new DatabaseService(':memory:');
    database.initialize();
    try {
      const db = database.getDb();
      const parent = parentContext();
      const eventStore = new SQLiteEventStore(db);
      await eventStore.ensureConversation('conversation-child-scope', [], undefined, 'agent');
      await eventStore.beginRunSession('conversation-child-scope', 'parent-child-scope', {
        kind: 'agent',
      });
      const descriptors = new SqliteRunDescriptorStore(db);
      await descriptors.insert(
        RunDescriptorSchema.parse({
          schemaVersion: 1,
          runId: parent.runId,
          conversationId: parent.conversationId,
          turnId: 'turn-parent-scope',
          createdAt: 1,
          agentSpec: runnableDefinitionToAgentSpec(
            resolved(PromptKeys.DEFAULT, undefined).agentDefinition
          ),
          request: {
            query: 'Parent',
            promptKey: PromptKeys.DEFAULT,
            model_id: parent.modelId,
            frozenSystemPrompt: 'Frozen parent',
          },
          historyEventIds: [],
          incomingEventIds: [],
          runContext: { runId: parent.runId, traceId: 'trace-child-scope', tags: {} },
          toolContextPatch: {},
          executorLocal: {},
          commandPermission: {
            status: 'unavailable',
            code: 'permission_settings_unavailable',
            reason: 'run_snapshot_missing',
          },
          compatibility: captureRuntimeCompatibility(PromptKeys.DEFAULT, 'scripted-test-model'),
        })
      );
      const supervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
        registryStore: new SQLiteRunRegistryStore(db),
      });
      let allowedTools = ['read_file'];
      const calls: childRuns.ChildRunInvokeConfig[] = [];
      const lifecycle = new LinnyaRegisteredChildRunLifecycle({
        supervisor,
        eventStore: new LinnyaEventStoreAdapter(db, eventStore),
        nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
        costCollector: { snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }) },
        runAdmissionCommit: new SqliteRunAdmissionCommit(db),
      });
      const invoker = new RegisteredChildRunInvoker({
        agentResolver: {
          resolveByPromptKey: key => {
            const definition = resolved(key, allowedTools);
            if (calls.length > 0) {
              definition.agentDefinition.id = 'changed-current-identity';
            }
            return definition;
          },
        },
        lifecycle,
        recovery: {
          supervisor,
          runDescriptors: descriptors,
          recoveryCheckpointer: new graph.MemoryCheckpointer(),
        },
        childRunInvoker: {
          async invoke(config) {
            calls.push(config);
            if (calls.length === 1)
              throw new Error('Synthetic interruption before first checkpoint');
            expect(
              await new ToolRegistry().executeTool(
                'write_file',
                { locator: 'workspace:/forged.md', content: 'Forbidden' },
                config.parentToolContext
              )
            ).toMatchObject({ success: false, errorCode: 'REGISTERED_CHILD_TOOL_NOT_ALLOWED' });
            return {
              subrunId: 'frozen-tools-child',
              success: true,
              finalAnswer: 'Recovered',
              events: [],
              stepCount: 1,
            };
          },
        },
      });
      const request = {
        promptKey: PromptKeys.DEFAULT,
        userMessage: 'Frozen child',
        parentToolContext: parent,
        tracePolicy: { subrunId: 'frozen-tools-child' },
      };
      await expect(invoker.invoke(request)).rejects.toMatchObject({ code: 'RUN_RECOVERY_BLOCKED' });
      allowedTools = ['read_file', 'write_file'];
      registeredDefinitionSpy.mockReturnValue({
        ...registeredDefinition,
        id: 'changed-registered-identity',
        config: { ...registeredDefinition.config, availableTools: [] },
      });
      // 真正 registry 能力漂移先由恢复兼容性门禁阻止；恢复原版本后仍只用 descriptor。
      await expect(invoker.invoke(request)).rejects.toThrow('Original run capabilities changed');
      expect(calls).toHaveLength(1);
      registeredDefinitionSpy.mockReturnValue({
        ...registeredDefinition,
      });
      await expect(invoker.invoke(request)).resolves.toMatchObject({ success: true });
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        const context: ToolContext = call.parentToolContext;
        expect(context.registeredChildAllowedTools).toEqual(['read_file']);
        expect(context.callerAgentId).toBe(PromptKeys.DEFAULT);
        expect(call.initialInput?.request).toMatchObject({
          callerAgentId: PromptKeys.DEFAULT,
        });
        expect(call.initialInput?.request.availableTools).toEqual(['read_file']);
      }
    } finally {
      database.close();
    }
  });
});
