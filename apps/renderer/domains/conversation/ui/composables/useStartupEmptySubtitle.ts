import { computed, type ComputedRef } from 'vue';
import {
  STARTUP_EMPTY_SUBTITLE_MESSAGE_KEYS,
  pickStartupEmptySubtitleIndex,
} from '../../functions/startupEmptySubtitle';
import { useConversationLocalization } from '../useConversationLocalization';

let startupEmptySubtitleIndex: number | null = null;

export function useStartupEmptySubtitle(): ComputedRef<string> {
  const { conversationMessage } = useConversationLocalization();

  if (startupEmptySubtitleIndex === null) {
    // 中文说明：沿用旧 AppHome 行为。副标题只在本次 renderer 生命周期内随机一次，
    // 不持久化，避免同一次启动中项目空态和 Linnya 空态文案来回跳。
    startupEmptySubtitleIndex = pickStartupEmptySubtitleIndex();
  }

  const subtitleIndex = startupEmptySubtitleIndex;

  return computed(() => conversationMessage(STARTUP_EMPTY_SUBTITLE_MESSAGE_KEYS[subtitleIndex]));
}
