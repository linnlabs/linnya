<script setup lang="ts">
import { IconButton } from '@linnya/renderer-ui';
import { ClockIcon, CloseIcon, EditIcon } from '@linnya/renderer-ui/icons';
import type { RunSteerItem } from '../store/runSteeringStore';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';

/**
 * 输入框上方的待送达插话：送达前每条可编辑（放回输入框改完再发）或撤回（不发了），
 * 第一行还有“立即打断”。不另写提示。贴在输入框顶边后面，底部被输入框压住一截。
 */
defineProps<{
  readonly items: readonly RunSteerItem[];
  readonly compact?: boolean;
}>();

const emit = defineEmits<{
  edit: [inputId: string];
  withdraw: [inputId: string];
  interrupt: [];
}>();

const { conversationMessage } = useConversationLocalization();
</script>

<template>
  <div class="steer-tray" :class="{ 'is-compact': compact }" data-pending-steer-tray>
    <div v-for="(item, index) in items" :key="item.inputId" class="steer-tray__item" data-pending-steer>
      <ClockIcon class="steer-tray__icon" />
      <span class="steer-tray__text" :title="item.content">{{ item.content }}</span>
      <button v-if="index === 0" type="button" class="steer-tray__link" @click="emit('interrupt')">
        {{ conversationMessage('conversation.steer.interrupt') }}
      </button>
      <span class="steer-tray__actions">
        <IconButton size="xs" :label="conversationMessage('conversation.steer.edit')" @click="emit('edit', item.inputId)">
          <EditIcon />
        </IconButton>
        <IconButton size="xs" :label="conversationMessage('conversation.steer.withdraw')" @click="emit('withdraw', item.inputId)">
          <CloseIcon />
        </IconButton>
      </span>
    </div>
  </div>
</template>
