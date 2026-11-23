<template>
  <div class="sidebar-fixed-top">
    <button
      class="sidebar-entry"
      type="button"
      @click="$emit('new-conversation')"
    >
      <AddIcon class="nav-icon" />
      <span class="nav-label">{{ layoutMessage('layout.sidebar.nav.newConversation') }}</span>
    </button>

    <button
      class="sidebar-entry"
      type="button"
      @click="$emit('create-project')"
    >
      <AddCircleIcon class="nav-icon" />
      <span class="nav-label">{{ layoutMessage('layout.sidebar.nav.newProject') }}</span>
    </button>

    <button
      class="sidebar-entry"
      v-if="applicationSurface"
      :class="{ 'is-selected': activeScene === 'knowledge-base' }"
      type="button"
      @click="$emit('knowledge-base-click')"
    >
      <component :is="applicationSurface.contribution.iconComponent" class="nav-icon" />
      <span class="nav-label">{{ t(applicationSurface.contribution.title) }}</span>
    </button>

    <button
      class="sidebar-entry"
      :class="{ 'is-selected': isPluginStoreActive }"
      type="button"
      @click="$emit('plugin-store-click')"
    >
      <AppsIcon class="nav-icon" />
      <span class="nav-label">{{ layoutMessage('layout.sidebar.nav.plugins') }}</span>
    </button>

    <button
      class="sidebar-entry"
      :class="{ 'is-selected': isScheduledTasksActive }"
      type="button"
      data-testid="sidebar-scheduled-tasks"
      :aria-current="isScheduledTasksActive ? 'page' : undefined"
      @click="$emit('scheduled-tasks-click')"
    >
      <ClockIcon class="nav-icon" />
      <span class="nav-label">{{ layoutMessage('layout.sidebar.nav.scheduledTasks') }}</span>
      <span v-if="scheduledTasksUnread > 0" class="nav-badge">{{ scheduledTasksUnread }}</span>
    </button>

    <!-- 中文说明：Linnya 助手入口的真实工作台能力还没有实现，先不在侧边栏暴露入口。 -->
  </div>
</template>

<script setup lang="ts">
import { useApplicationSurface } from '@/app/plugins/composables';
import { useLocalization } from '@/app/localization';
import { AppsIcon, ClockIcon } from '@linnya/renderer-ui/icons';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { AddCircleIcon } from '@linnya/renderer-ui/icons';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';

defineProps<{
  activeScene: string;
  isPluginStoreActive: boolean;
  isScheduledTasksActive: boolean;
  /** 全部定时任务里完成后还没打开过的运行次数。 */
  scheduledTasksUnread: number;
}>();

defineEmits<{
  'new-conversation': [];
  'create-project': [];
  'knowledge-base-click': [];
  'plugin-store-click': [];
  'scheduled-tasks-click': [];
}>();

const applicationSurface = useApplicationSurface('knowledge-base');
const { t } = useLocalization();

const { layoutMessage } = useLayoutLocalization();
</script>
