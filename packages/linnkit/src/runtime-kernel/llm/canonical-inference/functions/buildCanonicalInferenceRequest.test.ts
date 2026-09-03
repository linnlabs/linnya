import { describe, expect, it } from 'vitest';
import type { LlmCallOptions, ResolvedLlmInputMessage } from '../../../../ports';
import { buildCanonicalInferenceRequest } from './buildCanonicalInferenceRequest';

describe('buildCanonicalInferenceRequest', () => {
  it('为上下文压缩保留原消息前缀、终端 Reminder、有序工具、none 与稳定前缀断点', () => {
    const messages: ResolvedLlmInputMessage[] = [
      { role: 'system', content: 'ROOT_SYSTEM' },
      { role: 'system', content: 'HISTORY_SUMMARY' },
      { role: 'user', content: 'CURRENT_GOAL' },
      { role: 'user', content: '<system-reminder>\nCONTEXT_COMPACTION\n</system-reminder>' },
    ];
    const options: LlmCallOptions = {
      tools: [
        {
          name: 'read_file',
          description: '读取文件',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string', description: '文件路径' } },
            required: ['path'],
            additionalProperties: false,
          },
        },
        {
          name: 'write_file',
          description: '写入文件',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              content: { type: 'string', description: '文件内容' },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: 'none',
      cache_policy: {
        breakpoints: [
          { anchor: 'end_of_system_prompt', message_index: 0 },
          { anchor: 'end_of_history_summary', message_index: 1 },
        ],
      },
      max_tokens: 8_192,
    };

    const request = buildCanonicalInferenceRequest({
      model_id: 'model-1',
      messages,
      options,
      trace_id: 'trace-1',
      attempt_id: 'attempt-1',
    });

    expect(request.messages).toEqual([
      { role: 'system', content: 'ROOT_SYSTEM' },
      { role: 'system', content: 'HISTORY_SUMMARY' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'CURRENT_GOAL' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '<system-reminder>\nCONTEXT_COMPACTION\n</system-reminder>' }],
      },
    ]);
    expect(request.tools.map(tool => tool.name)).toEqual(['read_file', 'write_file']);
    expect(request.tool_choice).toBe('none');
    expect(request.cache_policy).toEqual(options.cache_policy);
    expect(request.sampling.max_output_tokens).toBe(8_192);
  });
});
