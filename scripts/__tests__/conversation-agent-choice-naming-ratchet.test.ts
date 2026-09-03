import { describe, expect, it } from 'vitest';

import {
  analyzeConversationAgentChoiceNaming,
  compareConversationAgentChoiceNaming,
  parseConversationAgentChoiceNamingBaseline,
  runConversationAgentChoiceNamingRatchet,
  summarizeConversationAgentChoiceNaming,
} from '../guards/conversation-agent-choice-naming-ratchet';

describe('Conversation agent-choice workflow naming ratchet', () => {
  // 该断言需要遍历并解析生产源码，完整测试并行时不应受 5 秒单元测试默认值限制。
  it('当前旧命名表面与 baseline 精确一致', () => {
    expect(runConversationAgentChoiceNamingRatchet()).toEqual({ expanded: [], reduced: [] });
  }, 30_000);

  it('识别旧类型、函数、contract key、文件名和 agent invocation workflowId', () => {
    const source = [
      'export interface ConversationWorkflowDescriptor {}',
      'const conversationWorkflows = [];',
      'function applyConversationWorkflowSelection(workflowId: string) {}',
    ].join('\n');
    const occurrences = analyzeConversationAgentChoiceNaming(
      'apps/renderer/domains/conversation/definitions/conversationWorkflow.ts',
      source
    );

    expect(occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'AGENT-CHOICE-NAMING-01-path' }),
        expect.objectContaining({ name: 'ConversationWorkflowDescriptor' }),
        expect.objectContaining({ name: 'conversationWorkflows' }),
        expect.objectContaining({ name: 'applyConversationWorkflowSelection' }),
        expect.objectContaining({ ruleId: 'AGENT-CHOICE-NAMING-03-workflow-id' }),
      ])
    );
  });

  it('同一旧文件新增 workflowId 会形成数量扩张，而不是被文件白名单放过', () => {
    const file = 'apps/renderer/domains/conversation/definitions/conversationWorkflow.ts';
    const before = summarizeConversationAgentChoiceNaming(
      analyzeConversationAgentChoiceNaming(file, 'const conversationWorkflows = [];')
    );
    const after = summarizeConversationAgentChoiceNaming(
      analyzeConversationAgentChoiceNaming(
        file,
        'const conversationWorkflows = [];\nconst workflowId = "ppt";'
      )
    );

    expect(compareConversationAgentChoiceNaming(after, before).expanded).toEqual([
      expect.objectContaining({
        ruleId: 'AGENT-CHOICE-NAMING-03-workflow-id',
        name: 'workflowId',
        count: 1,
      }),
    ]);
  });

  it('允许准确命名的真正 workflow，不全仓封杀 workflowId', () => {
    const source = [
      'interface ToolSubrunWorkflow { workflowId: string; }',
      'function runToolSubrunWorkflow(input: ToolSubrunWorkflow) { return input.workflowId; }',
    ].join('\n');
    expect(
      analyzeConversationAgentChoiceNaming(
        'apps/renderer/app/workflows/tool-subruns/runToolSubrunWorkflow.ts',
        source
      )
    ).toEqual([]);
  });

  it('解析 baseline 时拒绝重复 key 和无效数量', () => {
    const row = '1\tAGENT-CHOICE-NAMING-02-symbol\tfile.ts\tConversationWorkflow';
    expect(() => parseConversationAgentChoiceNamingBaseline(`${row}\n${row}\n`)).toThrow(
      'baseline 存在重复项'
    );
    expect(() =>
      parseConversationAgentChoiceNamingBaseline(
        '0\tAGENT-CHOICE-NAMING-02-symbol\tfile.ts\tConversationWorkflow\n'
      )
    ).toThrow('无效 baseline 行');
  });

  it('解析 Vue script 并保留 SFC 真实行号', () => {
    const source = [
      '<template><div /></template>',
      '<script setup lang="ts">',
      'const activeConversationWorkflow = null;',
      '</script>',
    ].join('\n');
    expect(
      analyzeConversationAgentChoiceNaming(
        'apps/renderer/domains/conversation/ui/Example.vue',
        source
      )
    ).toEqual([expect.objectContaining({ line: 3, name: 'activeConversationWorkflow' })]);
  });
});
