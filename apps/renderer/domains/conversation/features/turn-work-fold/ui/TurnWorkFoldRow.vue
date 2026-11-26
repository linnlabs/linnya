<script setup lang="ts">
import { computed } from 'vue';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import type { ConversationTurnWorkFoldVisualRow } from '../../../ui/messageCanvas';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import { formatConversationDuration } from '../../../functions/formatConversationDuration';

/**
 * “已工作 x 分 x 秒”折叠行。写法和“已思考 x 秒”同一套：箭头 + 文字，不加卡片、边框和色块；
 * 只写时长，不带步骤摘要。点开原样展开本轮过程。
 */
const props = defineProps<{
  readonly fold: ConversationTurnWorkFoldVisualRow['fold'];
}>();
const emit = defineEmits<{ toggle: [] }>();

const { conversationMessage } = useConversationLocalization();
const label = computed(() => conversationMessage('conversation.turn.workFold', {
  duration: formatConversationDuration(props.fold.durationMs, conversationMessage),
}));
</script>

<template>
  <button
    type="button"
    class="turn-work-fold"
    :aria-expanded="fold.expanded"
    data-turn-work-fold
    @click="emit('toggle')"
  >
    <ChevronIcon :direction="fold.expanded ? 'down' : 'right'" class="turn-work-fold__arrow" />
    <span class="turn-work-fold__label">{{ label }}</span>
  </button>
</template>
