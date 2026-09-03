import type { AnswerSegmentState } from '../definitions/answerSegment';

export function createAnswerSegmentState(answerId: string): AnswerSegmentState {
  if (answerId.trim().length === 0) {
    throw new Error('answerId cannot be empty');
  }
  return {
    answerId,
    chunks: new Map(),
    nextSeqToAppend: 0,
    maxSeqSeen: -1,
    content: '',
    isComplete: false,
  };
}

export function rebuildAnswerSegmentContent(answer: AnswerSegmentState): string {
  return Array.from(answer.chunks.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, chunk]) => chunk)
    .join('');
}

/**
 * 按答案内部 seq 增量归并 chunk。
 *
 * 正常流只追加连续 chunk，摊还 O(n)；乱序补齐或已消费位置被替换时才重建。
 * execution_seq 属于 transport 顺序，禁止传入这里代替答案 seq。
 */
export function applyAnswerSegmentChunk(
  answer: AnswerSegmentState,
  seq: number,
  chunk: string,
): void {
  const previous = answer.chunks.get(seq);
  answer.chunks.set(seq, chunk);
  answer.maxSeqSeen = Math.max(answer.maxSeqSeen, seq);

  if (previous === chunk) {
    return;
  }

  if (seq < answer.nextSeqToAppend) {
    answer.content = rebuildAnswerSegmentContent(answer);
    answer.nextSeqToAppend = answer.maxSeqSeen + 1;
    return;
  }

  while (answer.chunks.has(answer.nextSeqToAppend)) {
    const next = answer.chunks.get(answer.nextSeqToAppend);
    if (typeof next === 'string') {
      answer.content += next;
    }
    answer.nextSeqToAppend += 1;
  }
}
