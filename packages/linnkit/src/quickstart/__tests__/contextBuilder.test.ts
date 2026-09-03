import { describe, expect, it } from 'vitest';

import {
  createFinalAnswerEvent,
  createToolCallDecisionEvent,
  createUserInputEvent,
  type RuntimeEvent,
} from '../../contracts';
import { QuickstartContextBuilder } from '../contextBuilder';
import { defineAgent } from '../defineAgent';

describe('QuickstartContextBuilder answer segment history', () => {
  it('只把终态交付放入简化历史，排除正式标记的工具前播报', async () => {
    const toolPreamble: RuntimeEvent = {
      type: 'final_answer',
      id: 'tool-preamble',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      timestamp: 2,
      version: 1,
      answer_id: 'tool-preamble',
      content: '我先读取资料。',
      is_complete: true,
      completion_reason: 'tool_call',
    };
    const history: RuntimeEvent[] = [
      createUserInputEvent('user-1', 'conversation-1', 'turn-1', '检查资料'),
      toolPreamble,
      createToolCallDecisionEvent(
        'tool-1',
        'conversation-1',
        'turn-1',
        'resource_read',
        'call-1',
      ),
      createFinalAnswerEvent(
        'terminal-1',
        'conversation-1',
        'turn-1',
        '检查完成。',
        { completion_reason: 'terminal' },
      ),
    ];
    const builder = new QuickstartContextBuilder(defineAgent({
      id: 'context-test',
      systemPrompt: '遵循任务。',
    }));

    const result = await builder.build({
      request: { query: '继续', promptKey: 'context-test' },
      history,
      modelId: 'test-model',
      toolDefinitionTokens: 0,
    });

    expect(result.llmMessages).toEqual([
      { role: 'system', content: '遵循任务。' },
      { role: 'user', content: '检查资料' },
      { role: 'assistant', content: '检查完成。' },
      { role: 'user', content: '继续' },
    ]);
  });
});
