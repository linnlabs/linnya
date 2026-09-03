import { describe, expect, it } from 'vitest';

import { createRequestEventTurnGate } from './requestEventTurnGate';

describe('createRequestEventTurnGate', () => {
  it('同一请求只接受所属 turn，同时保留 transport 控制信号', () => {
    const accepts = createRequestEventTurnGate();

    expect(accepts({ type: 'thought', turn_id: 'turn_a' })).toBe(true);
    expect(accepts({ type: 'final_answer_chunk', turn_id: 'turn_a' })).toBe(true);
    expect(accepts({ type: 'summarization_start', turn_id: 'summary_turn_1' })).toBe(true);
    expect(accepts({ type: 'transport_end', turn_id: 'transport_execution_1' })).toBe(true);
    expect(accepts({ type: 'tool_output', turn_id: 'turn_other' })).toBe(false);
    expect(accepts({ type: 'final_answer', turn_id: 'turn_b' })).toBe(false);
  });

  it('不同请求各自持有 turn，不会因并发执行互相覆盖', () => {
    const acceptsChat = createRequestEventTurnGate();
    const acceptsTableRow = createRequestEventTurnGate();

    expect(acceptsChat({ type: 'thought', turn_id: 'turn_chat' })).toBe(true);
    expect(acceptsTableRow({ type: 'thought', turn_id: 'turn_table' })).toBe(true);
    expect(acceptsChat({ type: 'final_answer', turn_id: 'turn_chat' })).toBe(true);
    expect(acceptsTableRow({ type: 'tool_output', turn_id: 'turn_table' })).toBe(true);
  });
});
