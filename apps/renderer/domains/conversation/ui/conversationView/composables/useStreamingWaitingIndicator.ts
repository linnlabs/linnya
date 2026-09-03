import { computed, onUnmounted, ref, watch } from 'vue';
import type { ComputedRef } from 'vue';
import type { BaseMessage } from '../../../types';

/**
 * @description
 * ConversationView 的“通用等待指示器”逻辑：
 * - 流式传输时，如果超过 3 秒没有任何消息更新，则显示一个通用 loading；
 * - 但如果已经存在“自带 loading”的消息（例如图片生成、摘要中、图片类工具调用），则不显示该通用指示器。
 *
 * 设计目标：
 * - 高内聚：只处理 waiting indicator；
 * - 低耦合：不依赖滚动/时间轴/投影器；
 * - 严格类型：不使用 any，通过守卫解析 metadata。
 */
export function useStreamingWaitingIndicator(params: {
  messages: ComputedRef<BaseMessage[]>;
  isStreaming: ComputedRef<boolean>;
}) {
  const { messages, isStreaming } = params;

  const lastMessageUpdateTime = ref<number>(Date.now());
  const showWaitingIndicator = ref(false);
  let waitingCheckTimer: number | null = null;

  const stopWaitingCheck = (): void => {
    if (waitingCheckTimer === null) return;
    clearInterval(waitingCheckTimer);
    waitingCheckTimer = null;
  };

  const hasOwnLoadingState = computed(() => {
    const list = messages.value;
    if (list.length === 0) return false;

    // ✅ 简化且更符合直觉的规则：
    // 如果最后一条消息是“工具调用正在执行中”，则认为它自己应该负责呈现加载态，
    // 通用等待指示器不再介入（避免出现“加载叠加载”的体验）。
    const lastMsg = list[list.length - 1];
    if (lastMsg?.type === 'tool_calls') {
      if (lastMsg.metadata.status === 'loading') {
        return true;
      }
    }

    return list.some(msg => {
      // 摘要进行中
      if (msg.type === 'summarization_progress') {
        return msg.metadata.summary.status === 'summarizing';
      }

      // 工具调用：图片生成进行中
      if (msg.type === 'tool_calls') {
        const metadata = msg.metadata;
        const status = metadata.status;
        if (status !== 'loading') return false;
        return metadata.tool_name === 'generate_image' || metadata.tool_name === 'text_to_image';
      }

      return false;
    });
  });

  // 监听消息更新：重置时间戳，隐藏通用等待指示器（避免重复提示）
  watch(
    () => {
      const list = messages.value;
      const len = list.length;
      const last = len > 0 ? list[len - 1] : null;
      return [
        len,
        last?.id ?? '',
        last?.type ?? '',
        last?.type === 'tool_calls' ? last.metadata.status : '',
        last?.timestamp ?? 0,
        typeof last?.content === 'string' ? last.content.length : 0,
      ].join(':');
    },
    () => {
      lastMessageUpdateTime.value = Date.now();
      showWaitingIndicator.value = false;
    },
    { deep: false, flush: 'post' }
  );

  // 生成态与消息自带 loading 共同决定计时器生命周期。
  // 自带 loading 结束后要重新计时，不能等待 isStreaming 再次变化。
  watch(
    () => ({
      streaming: isStreaming.value,
      hasOwnLoading: hasOwnLoadingState.value,
    }),
    (current, previous) => {
      if (!current.streaming) {
        stopWaitingCheck();
        showWaitingIndicator.value = false;
        return;
      }

      if (current.hasOwnLoading) {
        stopWaitingCheck();
        showWaitingIndicator.value = false;
        return;
      }

      // 新一轮生成，或消息自己的 loading 刚结束时，从此刻开始等待通用反馈。
      if (!previous?.streaming || previous.hasOwnLoading) {
        lastMessageUpdateTime.value = Date.now();
      }
      if (waitingCheckTimer !== null) return;

      waitingCheckTimer = window.setInterval(() => {
        showWaitingIndicator.value = Date.now() - lastMessageUpdateTime.value > 3000;
      }, 1000);
    },
    { immediate: true }
  );

  onUnmounted(() => {
    stopWaitingCheck();
  });

  return {
    isWaitingSlotActive: computed(() => isStreaming.value),
    isWaitingIndicatorVisible: computed(() => (
      isStreaming.value
      && !hasOwnLoadingState.value
      && showWaitingIndicator.value
    )),
  };
}
