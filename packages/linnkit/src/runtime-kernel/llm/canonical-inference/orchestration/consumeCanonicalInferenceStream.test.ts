import { describe, expect, it, vi } from 'vitest';
import type { CanonicalInferenceEvent } from '../../../../ports';
import { consumeCanonicalInferenceStream } from './consumeCanonicalInferenceStream';

async function* stream(events: readonly CanonicalInferenceEvent[]) {
  yield* events;
}

describe('consumeCanonicalInferenceStream', () => {
  it('按原顺序转发结构化事件并返回唯一终态', async () => {
    const events: CanonicalInferenceEvent[] = [
      { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
      { type: 'answer_delta', text: 'ok' },
      { type: 'finish', reason: 'stop' },
    ];
    const onEvent = vi.fn();

    await expect(consumeCanonicalInferenceStream(stream(events), onEvent)).resolves.toEqual({
      type: 'finish',
      reason: 'stop',
    });
    expect(onEvent.mock.calls.map(call => call[0])).toEqual(events);
  });

  it('EOF 前没有 terminal event 时显式失败', async () => {
    await expect(
      consumeCanonicalInferenceStream(
        stream([
          { type: 'start', model_id: 'model-1', attempt_id: 'attempt-1' },
          { type: 'answer_delta', text: 'truncated' },
        ]),
        () => undefined
      )
    ).rejects.toThrow(/terminal event 前结束/);
  });
});
