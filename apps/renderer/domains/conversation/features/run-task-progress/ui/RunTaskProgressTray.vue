<script setup lang="ts">
import { computed, ref } from 'vue';
import type { TaskState } from '@app/schemas';
import { BulletListIcon, ChevronIcon } from '@linnya/renderer-ui/icons';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import { TASK_STATE_PHASE_LABEL_KEYS } from '../../../definitions/taskStatePhaseMessages';

/**
 * 输入框上方的任务进度：沿用“待送达插话”的托盘形态，贴在输入框顶边后面。
 * 收起时一行“阶段 · 下一步”，点开看目标、计划和下一步。TaskState 的计划项没有完成标记，
 * 所以不显示“第几步 / 共几步”。展开与否只是这一块的界面状态。
 */
const props = defineProps<{
  readonly taskState: TaskState;
  readonly compact?: boolean;
}>();

const { conversationMessage } = useConversationLocalization();
const expanded = ref(false);
const phase = computed(() => conversationMessage(TASK_STATE_PHASE_LABEL_KEYS[props.taskState.current_phase]));
const firstNextStep = computed(() => props.taskState.next_steps[0] ?? '');
</script>

<template>
  <div class="task-tray" :class="{ 'is-compact': compact, 'is-expanded': expanded }" data-run-task-tray>
    <div v-if="expanded" class="task-tray__detail">
      <div class="task-tray__goal">{{ taskState.goal }}</div>
      <div class="task-tray__section">{{ conversationMessage('conversation.taskProgress.plan') }}</div>
      <ol class="task-tray__plan">
        <li v-for="item in taskState.current_plan" :key="item">{{ item }}</li>
      </ol>
      <div class="task-tray__section">{{ conversationMessage('conversation.taskProgress.next') }}</div>
      <ul class="task-tray__next">
        <li v-for="item in taskState.next_steps" :key="item">{{ item }}</li>
      </ul>
    </div>
    <button
      type="button"
      class="task-tray__bar"
      :aria-expanded="expanded"
      :aria-label="conversationMessage('conversation.taskProgress.toggle')"
      @click="expanded = !expanded"
    >
      <BulletListIcon class="task-tray__icon" />
      <span class="task-tray__phase">{{ phase }}</span>
      <span class="task-tray__step" :title="firstNextStep">{{ firstNextStep }}</span>
      <ChevronIcon :direction="expanded ? 'down' : 'up'" class="task-tray__chevron" />
    </button>
  </div>
</template>
