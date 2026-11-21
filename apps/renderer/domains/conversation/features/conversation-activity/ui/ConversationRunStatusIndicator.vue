<template>
  <HoverTooltip :text="label" placement="top">
    <span
      class="conversation-run-status"
      :class="`conversation-run-status--${status}`"
      role="img"
      :aria-label="label"
      :data-run-status="status"
    >
      <LinnyaLoadingIcon
        v-if="status === 'running'"
        class="conversation-run-status__loading"
        activity="thinking"
      />
      <span v-else class="conversation-run-status__dot" />
    </span>
  </HoverTooltip>
</template>

<script setup lang="ts">
import { HoverTooltip } from '@linnya/renderer-ui';
import { LinnyaLoadingIcon } from '@linnya/renderer-ui/icons';
import type { ConversationRunStatus } from '../definitions/conversationRunStatus';

/**
 * 侧栏行首的运行状态记号。进行中用 Linnya 摇曳动态；两种“等你处理”同用强调色圆点，
 * 具体是什么由行尾文字说；中断用小一号的错误色圆点。
 */
defineProps<{
  readonly status: ConversationRunStatus;
  readonly label: string;
}>();
</script>
