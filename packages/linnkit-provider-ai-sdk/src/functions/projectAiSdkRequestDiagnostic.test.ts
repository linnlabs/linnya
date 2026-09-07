import { describe, expect, it } from 'vitest';
import { projectAiSdkRequestDiagnostic } from './projectAiSdkRequestDiagnostic';

describe('projectAiSdkRequestDiagnostic', () => {
  it('只汇总请求形状并统计文本和图片负载', () => {
    const request = {
      model_id: 'fixture-model',
      messages: [
        { role: 'system' as const, content: 'system' },
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'hello world' },
            { type: 'image' as const, media_type: 'image/png' as const, bytes: new Uint8Array(12) },
          ],
        },
        {
          role: 'assistant' as const,
          parts: [{ type: 'text' as const, text: 'answer' }],
        },
        {
          role: 'tool' as const,
          tool_call_id: 'call-1',
          content: [{ type: 'text' as const, text: 'tool output' }],
        },
      ],
      tools: [{
        name: 'process',
        description: 'Observe a process',
        parameters: {
          type: 'object' as const,
          properties: {
            process_handle: {
              type: 'string' as const,
              description: 'Opaque process handle',
            },
          },
        },
      }],
      tool_choice: 'auto' as const,
      sampling: { max_output_tokens: 100 },
      invocation: { trace_id: 'trace-1', attempt_id: 'attempt-1' },
    };

    const summary = projectAiSdkRequestDiagnostic(request);
    expect(summary.message_count).toBe(4);
    expect(summary.message_roles).toEqual({ system: 1, user: 1, assistant: 1, tool: 1 });
    expect(summary.image_message_roles).toEqual({ system: 0, user: 1, assistant: 0, tool: 0 });
    expect(summary.tool_count).toBe(1);
    expect(summary.text_characters).toBe('system'.length + 'hello world'.length + 'answer'.length + 'tool output'.length);
    expect(summary.estimated_input_tokens).toBe(Math.ceil(summary.text_characters / 4));
    expect(summary.image_count).toBe(1);
    expect(summary.image_bytes).toBe(12);
    expect(summary.image_media_types).toEqual(['image/png']);
    expect(summary.request_fingerprint).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('相同请求形状指纹稳定，正文变化但形状不变时仍可聚合同类请求', () => {
    const base = {
      model_id: 'fixture-model',
      messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'aaaa' }] }],
      tools: [],
      tool_choice: 'none' as const,
      sampling: {},
      invocation: { trace_id: 'trace', attempt_id: 'attempt' },
    };
    const changed = {
      ...base,
      messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'bbbb' }] }],
    };
    expect(projectAiSdkRequestDiagnostic(base).request_fingerprint)
      .toBe(projectAiSdkRequestDiagnostic(changed).request_fingerprint);
  });
});
