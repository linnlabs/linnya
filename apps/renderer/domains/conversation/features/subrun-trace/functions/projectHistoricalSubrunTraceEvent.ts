import type { SSESubRunTraceEvent } from 'linnkit/contracts';

const HISTORICAL_FINAL_ANSWER_SNAPSHOT_CHUNK = Symbol(
  'historical-final-answer-snapshot-chunk',
);

type HistoricalFinalAnswerSnapshotChunk = SSESubRunTraceEvent & {
  readonly [HISTORICAL_FINAL_ANSWER_SNAPSHOT_CHUNK]: true;
};

/**
 * 紧凑历史只保存 final_answer 完整快照，不保存逐 chunk 实时帧。
 * 历史读取边界将该快照确定性投影为 one-shot chunk + seal，
 * 使完整消息 admission 仍然坚持“正文只来自 chunk”。
 *
 * marker 是 Renderer 内存 Symbol，不进 wire，live SSE 不可伪造该身份。
 */
export function projectHistoricalSubrunTraceEvent(
  event: SSESubRunTraceEvent,
): readonly SSESubRunTraceEvent[] {
  if (
    event.kind !== 'final_answer'
    || event.answer_id === undefined
    || event.content === undefined
    || event.content.length === 0
  ) {
    return [event];
  }

  const snapshotChunk: HistoricalFinalAnswerSnapshotChunk = {
    ...event,
    id: `${event.id}:snapshot-chunk`,
    kind: 'final_answer_chunk',
    delta: event.content,
    seq: 0,
    is_last: true,
    content: undefined,
    completion_reason: undefined,
    [HISTORICAL_FINAL_ANSWER_SNAPSHOT_CHUNK]: true,
  };
  return [snapshotChunk, event];
}

export function isHistoricalFinalAnswerSnapshotChunk(
  event: SSESubRunTraceEvent,
): boolean {
  return Object.prototype.hasOwnProperty.call(
    event,
    HISTORICAL_FINAL_ANSWER_SNAPSHOT_CHUNK,
  );
}
