import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationSelectedAgentIdSchema } from '@app/schemas';
import { mergeContextPolicy } from '@linnlabs/linnkit/context-manager';
import { llm } from '@linnlabs/linnkit/runtime-kernel';
import { installRecoveryModelFixture } from 'src/app-hosts/linnya/adapters/flow/__test-helpers__/createDurableFlowHarness';
import { RESEARCH_LEADER_PROMPT_V1 } from 'src/app-hosts/linnya/agent-registry/agents/research_v1/leaderPrompt';
import { LINNYA_CONTEXT_POLICY_FALLBACK } from 'src/app-hosts/linnya/context-policies/defaultContextPolicy';
import { ensureBuiltinBackendPluginsRegistered } from 'src/app-hosts/linnya/plugin-registry/builtin';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import type { ConversationListItem } from '../../../persistence/event-store/event-store.interface';
import { createConversationContextUsageReader } from './createConversationContextUsageReader';

const MODEL_ID = 'scripted-test-model';
const CONVERSATION_ID = 'conversation-context-usage';

function metadata(
  selectedAgentId: string | null,
  projectId: string | null = 'project-1',
): ConversationListItem {
  return {
    conversation_id: CONVERSATION_ID,
    title: 'Context usage',
    created_at: 1,
    last_event_at: 1,
    total_events: 0,
    user_message_count: 0,
    project_id: projectId,
    is_pinned: false,
    selected_agent_id: selectedAgentId === null
      ? null
      : ConversationSelectedAgentIdSchema.parse(selectedAgentId),
  };
}

function readUsage(conversation: ConversationListItem) {
  return createConversationContextUsageReader({
    readMetadata: async () => conversation,
    readHistory: async () => [],
    toolRuntime: { getToolSchemas: () => [] },
  })(CONVERSATION_ID, MODEL_ID);
}

describe('conversation context usage reader', () => {
  let restoreModel: () => void;

  beforeEach(() => {
    ensureBuiltinBackendPluginsRegistered();
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform'] });
    restoreModel = installRecoveryModelFixture();
  });

  afterEach(() => {
    restoreModel();
    clearPluginRuntimeStateForTests();
  });

  it('estimates the default Agent without a selected agent identity', async () => {
    const usage = await readUsage(metadata(null));

    expect(usage?.budget_model_id).toBe(MODEL_ID);
    expect(usage?.components.system_prompt_tokens).toBeGreaterThan(0);
  });

  it('estimates a research conversation before the first message has admitted a research scope', async () => {
    const tokenizer = llm.createDefaultTokenizerPort(
      mergeContextPolicy({ hostFallback: LINNYA_CONTEXT_POLICY_FALLBACK }).tokenEstimation,
    );

    const usage = await readUsage(metadata('research_v1'));

    // 估算的是下一次运行的真实系统提示：至少包含主研究职责，而不是空提示或错误占位。
    expect(usage?.components.system_prompt_tokens).toBeGreaterThanOrEqual(
      tokenizer.estimateText(RESEARCH_LEADER_PROMPT_V1, MODEL_ID),
    );
  });

  it('reports no estimate when research cannot admit the next run, without raising a server error', async () => {
    // 没有项目时发送会被研究接纳拒绝；此时没有可估算的下一次请求。
    await expect(readUsage(metadata('research_v1', null))).resolves.toBeNull();
  });

  it('reports no estimate when the selected Agent is unavailable, without raising a server error', async () => {
    // 注册表只列出已启用插件的 Agent：插件停用后它的 Agent 与已删除的 Agent 走同一条路径。
    // beforeEach 只启用 platform，插件 Agent 在这里都不可用。
    await expect(readUsage(metadata('slides_agent'))).resolves.toBeNull();
    await expect(readUsage(metadata('agent-that-was-removed'))).resolves.toBeNull();
  });
});
