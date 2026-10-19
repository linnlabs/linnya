/**
 * 流式正文淡入的分段状态机（纯函数，不依赖 DOM / Vue）。
 *
 * 同一个文字节点在流式阶段只会向尾部追加。每次追加的那一段单独成为一个“淡入段”，
 * 由渲染层给它一个很短的透明度动画；动画结束后淡入段并回已稳定文本，避免节点越积越多。
 * 任何不是“尾部追加”的变化（Markdown 重新解释、重试替换）都直接重置，不做动画。
 */

export interface StreamingTextSegment {
  /** 稳定 key：同一状态机内单调递增，保证 Vue 复用同一个 span。 */
  readonly id: number;
  readonly text: string;
  /** true 表示仍在播放淡入动画。 */
  readonly fading: boolean;
}

export interface StreamingTextState {
  /** 已稳定的前缀文本。 */
  readonly settled: string;
  /** 稳定前缀之后、按顺序排列的段；其中可能夹有已播完但前面还有未播完段的段。 */
  readonly segments: readonly StreamingTextSegment[];
  /** 当前完整文本，用于判断下一次是否“尾部追加”。 */
  readonly fullText: string;
  readonly nextId: number;
}

/** 同时存在的淡入段上限；超过时最早的段直接视为播完，防止慢设备上积压。 */
export const MAX_STREAMING_TEXT_SEGMENTS = 24;

/**
 * 创建初始状态。`animateInitial` 为 true 时整段初始文本也淡入（流式过程中新长出的块）；
 * 为 false 时作为已稳定文本直接显示（组件挂载时已存在的内容，例如虚拟列表重挂载）。
 */
export function createStreamingTextState(text: string, animateInitial: boolean): StreamingTextState {
  if (!animateInitial || text === '') {
    return { settled: text, segments: [], fullText: text, nextId: 0 };
  }
  return {
    settled: '',
    segments: [{ id: 0, text, fading: true }],
    fullText: text,
    nextId: 1,
  };
}

/** 文本变化：尾部追加产生新的淡入段，其它变化重置为已稳定文本。 */
export function applyStreamingText(state: StreamingTextState, nextText: string): StreamingTextState {
  if (nextText === state.fullText) return state;
  if (state.fullText === '' || !nextText.startsWith(state.fullText)) {
    return createStreamingTextState(nextText, false);
  }

  const appended = nextText.slice(state.fullText.length);
  const segments = [...state.segments, { id: state.nextId, text: appended, fading: true }];
  return limitSegments({ ...state, segments, fullText: nextText, nextId: state.nextId + 1 });
}

/** 某个淡入段动画结束：标记播完，并把队首连续播完的段并入已稳定文本。 */
export function settleStreamingTextSegment(state: StreamingTextState, id: number): StreamingTextState {
  if (!state.segments.some(segment => segment.id === id && segment.fading)) return state;
  return foldSettledSegments({
    ...state,
    segments: state.segments.map(segment => (segment.id === id ? { ...segment, fading: false } : segment)),
  });
}

/** 把所有段视为播完（兜底计时器、动画被取消时使用）。 */
export function settleAllStreamingTextSegments(state: StreamingTextState): StreamingTextState {
  if (!state.segments.some(segment => segment.fading)) return state;
  return foldSettledSegments({
    ...state,
    segments: state.segments.map(segment => (segment.fading ? { ...segment, fading: false } : segment)),
  });
}

function foldSettledSegments(state: StreamingTextState): StreamingTextState {
  let settled = state.settled;
  let index = 0;
  while (index < state.segments.length && !state.segments[index]!.fading) {
    settled += state.segments[index]!.text;
    index += 1;
  }
  if (index === 0) return state;
  return { ...state, settled, segments: state.segments.slice(index) };
}

function limitSegments(state: StreamingTextState): StreamingTextState {
  if (state.segments.length <= MAX_STREAMING_TEXT_SEGMENTS) return state;
  const overflow = state.segments.length - MAX_STREAMING_TEXT_SEGMENTS;
  return foldSettledSegments({
    ...state,
    segments: state.segments.map((segment, index) => (index < overflow ? { ...segment, fading: false } : segment)),
  });
}
