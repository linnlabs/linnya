import { describe, expect, it } from 'vitest';

import {
  analyzeSource,
  runConversationMessagesWriteGuard,
} from '../guards/conversation-messages-write-guard';
import {
  findConversationMessagesWriteAllowance,
} from '../guards/conversation-messages-write-allowlist';

const FILE = 'apps/renderer/domains/conversation/store/example.ts';

describe('conversation.messages write guard', () => {
  it('当前代码库不存在越界写入', () => {
    expect(runConversationMessagesWriteGuard()).toEqual([]);
  });

  it('捕获 splice —— 架构文档明确点名的反例', () => {
    const found = analyzeSource(FILE, 'conversation.messages.splice(index + 1);');
    expect(found).toHaveLength(1);
    expect(found[0]?.ruleId).toBe('CONV-MSG-02-mutate');
    expect(found[0]?.line).toBe(1);
  });

  it.each([
    ['push', 'conv.messages.push(message);'],
    ['pop', 'conv.messages.pop();'],
    ['shift', 'conv.messages.shift();'],
    ['unshift', 'conv.messages.unshift(m);'],
    ['sort', 'conv.messages.sort(byTime);'],
    ['reverse', 'conv.messages.reverse();'],
  ])('捕获变异方法 %s', (_name, code) => {
    const found = analyzeSource(FILE, code);
    expect(found.map(v => v.ruleId)).toEqual(['CONV-MSG-02-mutate']);
  });

  it('捕获整数组赋值', () => {
    const found = analyzeSource(FILE, 'target.messages = [];');
    expect(found.map(v => v.ruleId)).toEqual(['CONV-MSG-01-assign']);
  });

  it('捕获下标写入与 length 截断', () => {
    const found = analyzeSource(
      FILE,
      ['conv.messages[0] = patched;', 'conv.messages.length = 0;'].join('\n'),
    );
    expect(found.map(v => v.ruleId)).toEqual(['CONV-MSG-01-assign', 'CONV-MSG-03-length']);
  });

  it('穿透 as / 非空断言 / 括号包装', () => {
    const found = analyzeSource(
      FILE,
      [
        '(conv as Conversation).messages.push(m);',
        'conv!.messages = [];',
        '(conv).messages.splice(0);',
      ].join('\n'),
    );
    expect(found).toHaveLength(3);
  });

  it('捕获 .vue <script> 内的写入并报告真实行号', () => {
    const sfc = [
      '<template>',
      '  <div />',
      '</template>',
      '',
      '<script setup lang="ts">',
      'const conv = useConv();',
      'conv.messages.push(m);',
      '</script>',
    ].join('\n');
    const found = analyzeSource('apps/renderer/domains/conversation/ui/Example.vue', sfc);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(7);
  });

  it('不误报读取、非 messages 属性与同名局部变量的其他成员', () => {
    const found = analyzeSource(
      FILE,
      [
        'const first = conv.messages[0];',
        'const count = conv.messages.length;',
        'const mapped = conv.messages.map(toRow);',
        'const merged = [...conv.messages, extra];',
        'conv.metadata = next;',
        'conv.updatedAt = Date.now();',
        'other.rows.push(row);',
      ].join('\n'),
    );
    expect(found).toEqual([]);
  });

  it('Conversation 域内 messages 是保留属性名，不依赖对象变量名猜所有权', () => {
    const found = analyzeSource(FILE, 'diagnostics.messages.push(error);');
    expect(found.map(v => v.ruleId)).toEqual(['CONV-MSG-02-mutate']);
  });

  it('不把会话实体 upsert 当成消息写入', () => {
    const found = analyzeSource(
      FILE,
      [
        'conversationState.conversations[existingIndex] = conversation;',
        'conversationState.conversations.push(conversation);',
      ].join('\n'),
    );
    expect(found).toEqual([]);
  });

  it('允许列表覆盖 reducer 工作区与 commit pipeline，且不覆盖普通 store', () => {
    expect(findConversationMessagesWriteAllowance(
      'apps/renderer/domains/conversation/services/messageProjection/helpers/messageAccess.ts',
    )).not.toBeNull();
    expect(findConversationMessagesWriteAllowance(
      'apps/renderer/domains/conversation/services/orchestration/projectionCommitPipeline.ts',
    )).not.toBeNull();
    expect(findConversationMessagesWriteAllowance(
      'apps/renderer/domains/conversation/history/store/historyLoaderStore.ts',
    )).toBeNull();
  });
});
