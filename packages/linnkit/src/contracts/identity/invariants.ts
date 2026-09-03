import {
  AnswerSegmentIdSchema,
  type AnswerSegmentId,
  type RuntimeEventId,
} from './definitions';

/**
 * 校验 final_answer 的正式身份关系。
 *
 * final_answer 与 answer segment 一一对应，所以新事实必须满足 `event.id === answer_id`。
 * final_answer 与 answer segment 一一对应，所有创建、持久化和读取边界均执行同一合同。
 */
export function assertCanonicalFinalAnswerIdentity(input: {
  readonly id: RuntimeEventId;
  readonly answer_id: AnswerSegmentId;
}): AnswerSegmentId {
  const answerId = AnswerSegmentIdSchema.parse(input.answer_id);
  if (input.id !== answerId) {
    throw new Error(
      `final_answer identity mismatch: event.id=${input.id}, answer_id=${answerId}`,
    );
  }
  return answerId;
}

/**
 * chunk 是独立的增量事实，必须拥有不同于 answer segment 的 event ID。
 *
 * 如果二者相等，前端 processed-event 账本会先记录 chunk，随后把同 ID 的 seal 当成
 * 重复事件跳过，答案将永远无法封口。这条关系由新事实 admission 强制执行。
 */
export function assertDistinctAnswerChunkIdentity(input: {
  readonly id: RuntimeEventId;
  readonly answer_id: AnswerSegmentId;
}): void {
  if (input.id === input.answer_id) {
    throw new Error(
      `final_answer_chunk identity collision: event.id must differ from answer_id=${input.answer_id}`,
    );
  }
}
