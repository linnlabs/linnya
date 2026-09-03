import { describe, expect, it } from 'vitest';
import { SubrunTraceQuerySchema } from '../ui-messages.schemas';

describe('ui messages query schemas', () => {
  it('parses subrun trace kind filters and cursor query values', () => {
    const parsed = SubrunTraceQuerySchema.parse({
      parent_tool_call_id: 'call-1',
      subrun_id: 'subrun-1',
      kinds: 'tool_process,tool_output',
      limit: '120',
      cursor: '42',
    });

    expect(parsed).toEqual({
      parent_tool_call_id: 'call-1',
      subrun_id: 'subrun-1',
      kinds: ['tool_process', 'tool_output'],
      limit: 120,
      cursor: 42,
    });
  });

  it('rejects unsupported historical subrun trace kinds instead of falling back to full trace', () => {
    const parsed = SubrunTraceQuerySchema.safeParse({
      parent_tool_call_id: 'call-1',
      subrun_id: 'subrun-1',
      kinds: 'tool_process,action',
    });

    expect(parsed.success).toBe(false);
  });

  it('keeps the subrun trace limit as a hard API guardrail', () => {
    const parsed = SubrunTraceQuerySchema.safeParse({
      parent_tool_call_id: 'call-1',
      subrun_id: 'subrun-1',
      limit: '2001',
    });

    expect(parsed.success).toBe(false);
  });
});
