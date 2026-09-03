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
      :class="{ 'is-selected': activeScene === 'knowledge-base' }"
      type="button"
      @click="$emit('knowledge-base-click')"
    >
      <KnowledgeBaseIcon class="nav-icon" />
      <span class="nav-label">{{ layoutMessage('layout.sidebar.nav.knowledgeBase') }}</span>
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

    <!-- 中文说明：Linnya 助手入口的真实工作台能力还没有实现，先不在侧边栏暴露入口。 -->
  </div>
</template>

<script setup lang="ts">
import { KnowledgeBaseIcon } from '@linnya/renderer-ui/icons';
import { AppsIcon } from '@linnya/renderer-ui/icons';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { AddCircleIcon } from '@linnya/renderer-ui/icons';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';

defineProps<{
  activeScene: string;
  isPluginStoreActive: boolean;
}>();

defineEmits<{
  'new-conversation': [];
  'create-project': [];
  'knowledge-base-click': [];
  'plugin-store-click': [];
}>();

const { layoutMessage } = useLayoutLocalization();
</script>
