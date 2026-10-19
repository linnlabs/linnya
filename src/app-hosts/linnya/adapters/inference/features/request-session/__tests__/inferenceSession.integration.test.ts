import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PromptKeys } from '@app/schemas';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import type { AgentInvocationRequest } from '@linnlabs/linnkit/ports';
import { graph, runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { createLinnyaAuditRuntime, getCurrentLlmAuditContext } from 'src/domains/audit';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { RegisteredChildRunInvoker } from '../../../../child-runs/registeredSubagentInvoker';
import { LinnyaRegisteredChildRunLifecycle } from '../../../../child-runs/childRunLifecycle';
import { runWithAgentAuditScope } from '../../../../flow/agent-runner/runAuditScope';
import { getCurrentInferenceSessionId } from '..';

async function* observeStreamSession(): AsyncGenerator<string | undefined> {
  await Promise.resolve();
  yield getCurrentInferenceSessionId();
  await Promise.resolve();
  yield getCurrentInferenceSessionId();
}

describe('Host inference Conversation session', () => {
  beforeEach(() => {
    createLinnyaAuditRuntime({ level: 'off', sink: { emit() {} } });
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform'],
      enabledPluginIds: ['platform'],
    });
  });
  afterEach(() => clearPluginRuntimeStateForTests());

  it('审计关闭时，同一 Conversation 的多轮 run 在完整流消费期间仍共享稳定身份', async () => {
    const observed: (string | undefined)[] = [];
    for (const runId of ['run-first-turn', 'run-second-turn']) {
      await runWithAgentAuditScope(
        { conversationId: 'conversation-stable', runId, traceId: runId },
        async () => {
          expect(getCurrentLlmAuditContext()).toBeUndefined();
          for await (const sessionId of observeStreamSession()) observed.push(sessionId);
        }
      );
    }

    expect(observed).toEqual(Array<string>(4).fill('conversation-stable'));
    expect(getCurrentInferenceSessionId()).toBeUndefined();
  });

  it('并发 root 和 child 各取正式 Conversation，嵌套 child 返回后恢复外层身份', async () => {
    const observed = new Map<string, (string | undefined)[]>();

    const runConversation = async (conversationId: string): Promise<void> => {
      const supervisor = new runSupervisor.DefaultRunSupervisor<AgentInvocationRequest>({
        registryStore: new runSupervisor.MemoryRunRegistryStore(),
      });
      const parentRunId = RunIdSchema.parse(`${conversationId}-root`);
      const invoker = new RegisteredChildRunInvoker({
        agentResolver: {
          resolveByPromptKey: promptKey => ({
            agentDefinition: {
              id: 'session-test-agent',
              promptKey,
              defaultMode: 'agent',
              description: 'Inference session integration fixture',
            },
            agentConfig: { id: 'session-test-agent', promptKey },
          }),
        },
        lifecycle: new LinnyaRegisteredChildRunLifecycle({
          supervisor,
          eventStore: new graph.MemoryEventStore(),
          nextEventStoreId: graph.createMonotonicEventStoreIdFactory(),
          costCollector: { snapshot: () => ({ tokensInput: 0, tokensOutput: 0, latencyMs: 0 }) },
        }),
        childRunInvoker: {
          async invoke(config) {
            const sessions: (string | undefined)[] = [];
            for await (const sessionId of observeStreamSession()) sessions.push(sessionId);
            if (config.userMessage === 'child') {
              await invoker.invoke({
                promptKey: PromptKeys.DEFAULT,
                userMessage: 'nested',
                parentToolContext: { ...config.parentToolContext, runId: config.runId },
                tracePolicy: { subrunId: `${conversationId}-nested-run` },
                executionPolicy: { conversationId: `${conversationId}-nested` },
              });
              sessions.push(getCurrentInferenceSessionId());
            }
            observed.set(`${conversationId}-${config.userMessage}`, sessions);
            return {
              subrunId: config.userMessage,
              success: true,
              finalAnswer: 'Done',
              events: [],
              stepCount: 1,
            };
          },
        },
      });

      await runWithAgentAuditScope(
        { conversationId, runId: parentRunId, traceId: parentRunId },
        async () => {
          await invoker.invoke({
            promptKey: PromptKeys.DEFAULT,
            userMessage: 'child',
            parentToolContext: {
              conversationId,
              runId: parentRunId,
              conversationView: {
                getWorkingHistoryEvents: () => [],
                getPersistedHistoryEvents: () => [],
              },
            },
            tracePolicy: { subrunId: `${conversationId}-child-run` },
          });
          expect(getCurrentInferenceSessionId()).toBe(conversationId);
        }
      );
    };

    await Promise.all([runConversation('conversation-a'), runConversation('conversation-b')]);
    for (const conversationId of ['conversation-a', 'conversation-b']) {
      expect(observed.get(`${conversationId}-child`)).toEqual([
        conversationId,
        conversationId,
        conversationId,
      ]);
      expect(observed.get(`${conversationId}-nested`)).toEqual([
        `${conversationId}-nested`,
        `${conversationId}-nested`,
      ]);
    }
    expect(getCurrentInferenceSessionId()).toBeUndefined();
  });

  it('执行失败后会话身份不进入后续独立调用', async () => {
    const failure = new Error('Provider request failed');
    await expect(runWithAgentAuditScope(
      { conversationId: 'conversation-failed', runId: 'run-failed', traceId: 'trace-failed' },
      async () => {
        for await (const sessionId of observeStreamSession()) {
          expect(sessionId).toBe('conversation-failed');
          throw failure;
        }
      }
    )).rejects.toBe(failure);
    expect(getCurrentInferenceSessionId()).toBeUndefined();
  });
});
