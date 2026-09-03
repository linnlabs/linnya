import { describe, expect, it } from 'vitest';
import type { LlmRequestMessage } from '../../../../../ports';
import { buildContextCompactionRequest } from './buildContextCompactionRequest';

describe('buildContextCompactionRequest', () => {
  it('完整保留原 Prompt，并把专用 Reminder 作为最后一条瞬态 user message', () => {
    const original: LlmRequestMessage[] = [
      { role: 'system', content: 'root' },
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-1' }] },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: 'tool result\n\n<system-reminder>\nordinary\n</system-reminder>',
      },
    ];
    const result = buildContextCompactionRequest(original, 'compact-control');

    expect(result).toEqual([
      { role: 'system', content: 'root' },
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-1' }] },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: 'tool result\n\n<system-reminder>\nordinary\n</system-reminder>',
      },
      {
        role: 'user',
        content: '<system-reminder>\ncompact-control\n</system-reminder>',
      },
    ]);
    expect(original[original.length - 1]?.content).not.toContain('compact-control');
    expect(result.filter(message => message.role === 'system')).toHaveLength(1);
    expect(result.filter(message => message.role === 'user')).toHaveLength(2);
  });
});
