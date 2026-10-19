import {
  createTextVNode,
  defineComponent,
  h,
  onBeforeUnmount,
  shallowRef,
  watch,
} from 'vue';
import {
  applyStreamingText,
  createStreamingTextState,
  settleAllStreamingTextSegments,
  settleStreamingTextSegment,
} from './streamingTextSegments';

/** 动画被取消（例如元素被隐藏）时的兜底，略大于淡入时长。 */
const SETTLE_FALLBACK_MS = 600;

/**
 * 流式正文里的一个文字节点。
 *
 * 只负责把“新长出的尾部文字”包进一个行内 span 做淡入，已有文字原样输出。
 * 行内 span 加透明度动画不改变换行与高度，因此不影响虚拟列表的测量。
 * 状态转换全部在 `streamingTextSegments.ts` 里，这里只做 Vue 适配。
 */
export default defineComponent({
  name: 'ConversationStreamingText',
  props: {
    text: { type: String, required: true },
    /** 挂载时的整段文本是否也淡入（流式过程中新长出的块）。 */
    animateInitial: { type: Boolean, default: false },
  },
  setup(props) {
    const state = shallowRef(createStreamingTextState(props.text, props.animateInitial));
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const clearFallback = () => {
      if (fallbackTimer === null) return;
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    };
    const armFallback = () => {
      clearFallback();
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        state.value = settleAllStreamingTextSegments(state.value);
      }, SETTLE_FALLBACK_MS);
    };
    if (state.value.segments.length > 0) armFallback();

    watch(
      () => props.text,
      next => {
        const updated = applyStreamingText(state.value, next);
        if (updated === state.value) return;
        state.value = updated;
        if (updated.segments.some(segment => segment.fading)) armFallback();
        else clearFallback();
      },
      { flush: 'sync' },
    );

    onBeforeUnmount(clearFallback);

    return () => {
      const current = state.value;
      return [
        createTextVNode(current.settled),
        ...current.segments.map(segment =>
          h(
            'span',
            {
              key: segment.id,
              class: segment.fading ? 'conversation-stream-text__fresh' : undefined,
              onAnimationend: () => {
                state.value = settleStreamingTextSegment(state.value, segment.id);
              },
            },
            segment.text,
          ),
        ),
      ];
    };
  },
});
