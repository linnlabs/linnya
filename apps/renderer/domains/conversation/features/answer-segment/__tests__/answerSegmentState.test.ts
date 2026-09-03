import { describe, expect, it } from 'vitest';

import {
  applyAnswerSegmentChunk,
  createAnswerSegmentState,
} from '../index';

describe('answer segment state', () => {
  it('按 answer seq 等待缺口并在补齐后一次形成连续正文', () => {
    const answer = createAnswerSegmentState('answer-1');

    applyAnswerSegmentChunk(answer, 2, '三');
    expect(answer.content).toBe('');
    applyAnswerSegmentChunk(answer, 0, '一');
    expect(answer.content).toBe('一');
    applyAnswerSegmentChunk(answer, 1, '二');

    expect(answer.content).toBe('一二三');
    expect(answer.nextSeqToAppend).toBe(3);
  });

  it('重复 chunk 不重复正文，已消费 chunk 的正式替换按 seq 重建', () => {
    const answer = createAnswerSegmentState('answer-1');

    applyAnswerSegmentChunk(answer, 0, '原');
    applyAnswerSegmentChunk(answer, 1, '文');
    applyAnswerSegmentChunk(answer, 1, '文');
    expect(answer.content).toBe('原文');

    applyAnswerSegmentChunk(answer, 0, '新');
    expect(answer.content).toBe('新文');
  });
});
