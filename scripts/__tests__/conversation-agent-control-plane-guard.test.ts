import { describe, expect, it } from 'vitest';

import {
  analyzeConversationAgentControlPlane,
  runConversationAgentControlPlaneGuard,
} from '../guards/conversation-agent-control-plane-guard';

const CONVERSATION_FILE = 'apps/renderer/domains/conversation/functions/example.ts';
const PLUGIN_FILE = 'packages/plugins/example/src/renderer/index.ts';

describe('Conversation Agent control-plane guard', () => {
  // 该断言需要遍历并解析生产源码，完整测试并行时不应受 5 秒单元测试默认值限制。
  it('当前生产代码不存在 Agent 控制面旁路', () => {
    expect(runConversationAgentControlPlaneGuard()).toEqual([]);
  }, 30_000);

  it.each([
    ['property read', 'const key = conversation.metadata.promptKey;'],
    ['optional chain', 'const key = conversation.metadata?.promptKey;'],
    ['bracket read', "const key = conversation['metadata']['promptKey'];"],
    [
      'assertion wrapper',
      'const key = (conversation.metadata as { promptKey?: string }).promptKey;',
    ],
    ['write', "conversation.metadata.promptKey = 'slides_agent';"],
  ])('识别 metadata.promptKey %s', (_name, source) => {
    expect(analyzeConversationAgentControlPlane(CONVERSATION_FILE, source)).toEqual([
      expect.objectContaining({ ruleId: 'AGENT-CONTROL-01-metadata-prompt-key' }),
    ]);
  });

  it('识别 metadata 解构与 merge patch 中的 promptKey', () => {
    const source = [
      'const { promptKey } = conversation.metadata;',
      "mergeConversationMetadata(id, { promptKey: 'slides_agent' });",
      "const entity = { metadata: { promptKey: 'slides_agent' } };",
    ].join('\n');
    expect(
      analyzeConversationAgentControlPlane(CONVERSATION_FILE, source).map(item => item.line)
    ).toEqual([1, 2, 3]);
  });

  it('识别 conversationAgentChoices 内部 promptKey，不误报 subrun worker', () => {
    const source = [
      'const plugin = {',
      '  conversationAgentChoices: [{ id: "ppt", promptKey: "slides_agent" }],',
      '  subrunWorkers: [{ id: "research", promptKey: "research_worker" }],',
      '};',
    ].join('\n');
    expect(analyzeConversationAgentControlPlane(PLUGIN_FILE, source)).toEqual([
      expect.objectContaining({
        ruleId: 'AGENT-CONTROL-02-contribution-prompt-key',
        line: 2,
      }),
    ]);
  });

  it('允许显式 selected Agent 控制面与一次性 promptKey', () => {
    const source = [
      'const selectedAgentId = conversation.selectedAgentId;',
      'const request = { options: { selected_agent_id: selectedAgentId } };',
      'const oneShot = { promptKey: PromptKeys.ANNOTATION };',
      'const worker = { subrunWorkers: [{ promptKey: "research_worker" }] };',
    ].join('\n');
    expect(analyzeConversationAgentControlPlane(CONVERSATION_FILE, source)).toEqual([]);
  });

  it('解析 Vue script 并报告真实行号', () => {
    const source = [
      '<template><div /></template>',
      '<script setup lang="ts">',
      'const key = conversation.metadata.promptKey;',
      '</script>',
    ].join('\n');
    expect(
      analyzeConversationAgentControlPlane(
        'apps/renderer/domains/conversation/ui/Example.vue',
        source
      )
    ).toEqual([expect.objectContaining({ line: 3 })]);
  });
});
