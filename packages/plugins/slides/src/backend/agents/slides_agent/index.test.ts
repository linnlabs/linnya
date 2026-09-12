import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as contextManager from '@linnlabs/linnkit/context-manager';

import { GenericAgentTask } from 'src/app-hosts/linnya/agent-registry/GenericAgentTask';
import { createGraphLoopHarness } from 'src/app-hosts/linnya/testkit/agent-harness/graphLoopHarness';
import { withLinnyaFenceInjections } from 'src/app-hosts/linnya/context/agent/createLinnyaFenceInjections';
import { linnyaFenceRegistry } from 'src/app-hosts/linnya/context/agent/registerLinnyaFences';
import { LINNYA_CONTEXT_POLICY_FALLBACK } from 'src/app-hosts/linnya/context-policies/defaultContextPolicy';
import { createDefaultAgentProviderRegistry } from 'src/app-hosts/linnya/context-policies/defaultAgentProviderRegistry';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import { SlidesPromptKeys } from '@plugin/slides/shared';
import { slidesBackendPlugin } from '../../index';
import { SLIDES_AGENT_DEFINITION } from './index';

describe('slides agent element selection context', () => {
  beforeEach(() => {
    if (!backendPluginRegistry.has(slidesBackendPlugin.meta.id)) {
      backendPluginRegistry.register({
        meta: slidesBackendPlugin.meta,
        agentFences: slidesBackendPlugin.agentFences,
        agentDefinitions: slidesBackendPlugin.agentDefinitions,
      });
    }
    setPluginRuntimeStateForTests({ enabledPluginIds: ['platform', 'slides'] });
  });

  afterEach(() => {
    clearPluginRuntimeStateForTests();
  });

  it('把计划审批和操作流程交给必需的 slides-design Skill', () => {
    const slidesAgent = SLIDES_AGENT_DEFINITION;
    const systemPromptBuilder = slidesAgent.task?.systemPromptBuilder;
    if (!systemPromptBuilder) {
      throw new Error('slides_agent 缺少 systemPromptBuilder');
    }
    const systemPrompt = systemPromptBuilder({
      query: '创建一份季度复盘演示文稿',
      promptKey: SlidesPromptKeys.SLIDES_AGENT,
    });

    expect(slidesAgent.config?.skill?.requiredSkills).toEqual(['slides-design']);
    expect(slidesAgent.config?.maxSteps).toBe(800);
    expect(systemPrompt).toContain('Activate and follow the `slides-design` Skill before planning');
    expect(systemPrompt).not.toContain('For a new deck, use `ppt_plan`');
  });

  it.each([
    ['正文中的 <think>示例</think> 不应被删除。'],
    ['正文中的 <thi', 'nk>示例', '</think>', ' 不应被删除。'],
  ])('真实 Slides Graph 保留 canonical 正文，不按传输分片猜推理标签（%j）', async (...chunks) => {
    const harness = createGraphLoopHarness({
      tools: [],
      requestPatch: { promptKey: SlidesPromptKeys.SLIDES_AGENT },
      turns: [{ thoughtDeltas: ['独立推理通道测试内容'], contentChunks: chunks }],
    });
    try {
      await harness.run();
      const events = harness.getSinkRuntimeEvents();
      const answerChunks = events.filter(event => event.type === 'final_answer_chunk');
      expect(answerChunks.map(event => event.content)).toEqual(chunks);
      expect(answerChunks.map(event => event.seq)).toEqual(chunks.map((_, index) => index));
      const completeThoughts = events.filter(event => event.type === 'thought' && event.is_complete);
      expect(completeThoughts).toHaveLength(1);
      expect(completeThoughts[0]).toMatchObject({ content: '独立推理通道测试内容' });
      const answers = events.filter(event => event.type === 'final_answer');
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({ content: chunks.join('') });
      expect(new GenericAgentTask(SLIDES_AGENT_DEFINITION).processResponse(chunks.join(''))).toBe(chunks.join(''));
      harness.assertAllTurnsConsumed();
    } finally {
      harness.restore();
    }
  });

  it('injects element selection source slices into the actual slides_agent LLM messages', () => {
    const slidesAgent = SLIDES_AGENT_DEFINITION;
    const task = new GenericAgentTask(slidesAgent);
    const request = withLinnyaFenceInjections({
      query: '修改第 1 页选中的 1 个元素：这个能不能搞成矩形',
      promptKey: SlidesPromptKeys.SLIDES_AGENT,
      fences: [{
        kind: 'selected-slides-element',
        content: [
          'source_file_inode: deck-1',
          '<slides_element_source_context>',
          '<<<deck.js exact source',
          'coverImg.rounding = true;',
          '>>>',
          '</slides_element_source_context>',
        ].join('\n'),
      }],
    });

    const messages = task.buildMessages(request, []);
    const messageText = JSON.stringify(messages);

    expect(messageText).toContain('selected-slides-element');
    expect(messageText).toContain('<slides_element_source_context>');
    expect(messageText).toContain('source_file_inode: deck-1');
    expect(messageText).toContain('<<<deck.js exact source');
    expect(messageText).toContain('coverImg.rounding = true;');
  });

  it('keeps element selection source fences after the slides_agent context manager pass', async () => {
    const slidesAgent = SLIDES_AGENT_DEFINITION;
    const contextPolicy = contextManager.mergeContextPolicy({
      hostFallback: LINNYA_CONTEXT_POLICY_FALLBACK,
      agentSpec: slidesAgent.config.contextPolicy,
    });
    const orchestrator = new contextManager.agentOrchestration.AgentMessageOrchestrator({
      tokenBudget: {
        maxTokens: 12_000,
        reservedForResponse: 1_000,
      },
      processing: {
        debugMode: false,
      },
      taskResolver: () => new GenericAgentTask(slidesAgent),
      providerRegistry: createDefaultAgentProviderRegistry({
        providerOptions: contextManager.contextPolicyToProviderOptions(contextPolicy),
      }),
      fenceRegistry: linnyaFenceRegistry,
      resolveContextPolicy: () => contextPolicy,
      createProviderRegistry: ({ contextPolicy: requestContextPolicy, contextBuilderConfig }) =>
        createDefaultAgentProviderRegistry({
          customConfig: contextBuilderConfig,
          providerOptions: contextManager.contextPolicyToProviderOptions(requestContextPolicy),
        }),
    });

    const request = withLinnyaFenceInjections({
      query: '修改第 1 页选中的 1 个元素：这个能不能改成圆角矩形',
      promptKey: SlidesPromptKeys.SLIDES_AGENT,
      fences: [{
        kind: 'selected-slides-element',
        content: [
          'source_file_inode: deck-1',
          '<slides_element_source_context>',
          '<<<deck.js exact source',
          'image("coverImg", { borderRadius: 0 });',
          '>>>',
          '</slides_element_source_context>',
        ].join('\n'),
      }],
      user_quote: {
        items: [{
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'slides',
          kind: 'slides-source-selection',
          text: '1. image coverImg lines 12-15',
          source: {
            type: 'slides_source_selection',
            presentation_id: 'presentation-1',
          },
        }],
      },
    });

    const result = await orchestrator.processAgentConversation(
      request,
      [],
      new contextManager.agentTools.ToolManager({
        getTool: () => undefined,
        getAvailableToolNames: () => [],
        validateToolCall: () => ({ success: true }),
      }),
    );

    const messageText = JSON.stringify(result.messages);
    const currentUserMessage = result.messages.find((message) =>
      message.role === 'user' && message.type === 'user_input'
    );
    const llmMessages = contextManager.formatAgentLlmMessages(result.messages, {
      fenceRegistry: linnyaFenceRegistry,
    });
    const llmUserMessages = llmMessages.filter((message) => message.role === 'user');

    expect(currentUserMessage?.content).toContain('<selected_slides_element>');
    expect(currentUserMessage?.content).toContain('<user_quote');
    expect(currentUserMessage?.content).toContain('<user_request>');
    expect(llmUserMessages).toHaveLength(1);
    expect(llmUserMessages[0]?.content).toContain('<selected_slides_element>');
    expect(llmUserMessages[0]?.content).toContain('<user_request>');
    expect(messageText).toContain('<slides_element_source_context>');
    expect(messageText).toContain('source_file_inode: deck-1');
    expect(messageText).toContain('<<<deck.js exact source');
    expect(currentUserMessage?.content).toContain('image("coverImg", { borderRadius: 0 });');
  });
});
