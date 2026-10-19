import { describe, expect, it } from 'vitest';

import {
  MAX_STREAMING_TEXT_SEGMENTS,
  applyStreamingText,
  createStreamingTextState,
  settleAllStreamingTextSegments,
  settleStreamingTextSegment,
} from './streamingTextSegments';

describe('streamingTextSegments', () => {
  it('挂载时已有的文本直接稳定，不产生淡入段', () => {
    const state = createStreamingTextState('已有内容', false);
    expect(state).toMatchObject({ settled: '已有内容', segments: [], fullText: '已有内容' });
  });

  it('流式中新长出的块：初始文本整体淡入', () => {
    const state = createStreamingTextState('新段', true);
    expect(state.settled).toBe('');
    expect(state.segments).toEqual([{ id: 0, text: '新段', fading: true }]);
  });

  it('空文本即使要求动画也不产生空淡入段', () => {
    expect(createStreamingTextState('', true).segments).toEqual([]);
  });

  it('尾部追加产生新的淡入段，旧文本不动', () => {
    let state = createStreamingTextState('你好', false);
    state = applyStreamingText(state, '你好，世界');
    expect(state.settled).toBe('你好');
    expect(state.segments).toEqual([{ id: 0, text: '，世界', fading: true }]);
    expect(state.fullText).toBe('你好，世界');
  });

  it('同一文本重复传入保持同一状态对象', () => {
    const state = createStreamingTextState('abc', false);
    expect(applyStreamingText(state, 'abc')).toBe(state);
  });

  it('非尾部追加（改写、截断、空起点）直接重置为稳定文本', () => {
    let state = applyStreamingText(createStreamingTextState('abc', false), 'abcd');
    state = applyStreamingText(state, 'xyz');
    expect(state).toMatchObject({ settled: 'xyz', segments: [], fullText: 'xyz' });
    state = applyStreamingText(state, 'xy');
    expect(state).toMatchObject({ settled: 'xy', segments: [], fullText: 'xy' });
    state = applyStreamingText(createStreamingTextState('', false), 'new');
    expect(state).toMatchObject({ settled: 'new', segments: [] });
  });

  it('动画结束按顺序并入稳定文本；前面还有未播完的段时后面的段先保留', () => {
    let state = createStreamingTextState('A', false);
    state = applyStreamingText(state, 'AB');
    state = applyStreamingText(state, 'ABC');
    state = settleStreamingTextSegment(state, 1);
    expect(state.settled).toBe('A');
    expect(state.segments.map(segment => [segment.id, segment.fading])).toEqual([[0, true], [1, false]]);

    state = settleStreamingTextSegment(state, 0);
    expect(state.settled).toBe('ABC');
    expect(state.segments).toEqual([]);
  });

  it('不存在或已播完的段不改变状态', () => {
    const state = applyStreamingText(createStreamingTextState('A', false), 'AB');
    expect(settleStreamingTextSegment(state, 99)).toBe(state);
    const settled = settleStreamingTextSegment(state, 0);
    expect(settleStreamingTextSegment(settled, 0)).toBe(settled);
  });

  it('兜底：一次性并入全部淡入段', () => {
    let state = createStreamingTextState('A', false);
    state = applyStreamingText(state, 'AB');
    state = applyStreamingText(state, 'ABC');
    state = settleAllStreamingTextSegments(state);
    expect(state).toMatchObject({ settled: 'ABC', segments: [] });
  });

  it('淡入段数量有上限，最早的段被直接视为播完，文本顺序不变', () => {
    let state = createStreamingTextState('', false);
    let expected = '';
    for (let index = 0; index < MAX_STREAMING_TEXT_SEGMENTS + 10; index += 1) {
      expected += String(index % 10);
      state = applyStreamingText(state, expected);
    }
    const rebuilt = state.settled + state.segments.map(segment => segment.text).join('');
    expect(rebuilt).toBe(expected);
    expect(state.segments.length).toBeLessThanOrEqual(MAX_STREAMING_TEXT_SEGMENTS);
  });
});
