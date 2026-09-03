import { describe, expect, it } from 'vitest';
import { createToolContextFixture } from './toolContext';
import type { RuntimeEvent } from '../../contracts';
import { createToolOutputEvent } from '../../contracts';

function makeEvent(id: string): RuntimeEvent {
  return createToolOutputEvent(
    id,
    'conv_fixture',
    'turn_fixture',
    'fixture_tool',
    `call_${id}`,
    { status: 'success', observation: 'fixture result', data: {} }
  );
}

describe('createToolContextFixture', () => {
  it('应暴露显式 working/persisted history', () => {
    const persistedHistory = [makeEvent('persisted_1')];
    const workingHistory = [makeEvent('working_1')];

    const context = createToolContextFixture({
      conversationId: 'conv_fixture',
      turnId: 'turn_fixture',
      persistedHistoryEvents: persistedHistory,
      workingHistoryEvents: workingHistory,
    });

    expect(context.conversationView?.getPersistedHistoryEvents()).toBe(persistedHistory);
    expect(context.conversationView?.getWorkingHistoryEvents()).toBe(workingHistory);
  });
});
