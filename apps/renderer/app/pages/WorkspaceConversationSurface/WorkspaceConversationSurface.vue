<template>
  <div
    class="workspace-conversation-surface"
    :data-workspace-conversation-presentation="presentation"
  >
    <ProjectConversationSurface
      v-if="currentScope.kind === 'project'"
      :variant="conversationVariant"
      :empty-composer-placement="emptyComposerPlacement"
      :is-active="isActive"
      :show-home-actions="presentation === 'home'"
    />
    <LinnyaAssistantChatSurface
      v-else
      :variant="conversationVariant"
      :empty-composer-placement="emptyComposerPlacement"
      :is-active="isActive"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import LinnyaAssistantChatSurface from '@/domains/conversation/ui/LinnyaAssistantChatSurface.vue';
import type {
  ConversationEmptyComposerPlacement,
  ConversationSurfaceVariant,
} from '@/domains/conversation/definitions/conversationPresentation';
import ProjectConversationSurface from './ProjectConversationSurface.vue';
import type { WorkspaceConversationPresentation } from './definitions/workspaceConversationPresentation';

const props = withDefaults(defineProps<{
  presentation?: WorkspaceConversationPresentation;
  isActive?: boolean;
}>(), {
  presentation: 'home',
  isActive: true,
});

const workspaceScopeStore = useWorkspaceScopeStore();
const projectsStore = useWorkspaceProjectsStore();

const currentScope = computed(() => workspaceScopeStore.currentScope);
// 主区和右侧必须共享消息列与 AiAssistantInput 的完整规格；位置不能映射成视觉密度。
const conversationVariant: ConversationSurfaceVariant = 'regular';
const emptyComposerPlacement = computed<ConversationEmptyComposerPlacement>(() => (
  props.presentation === 'home' ? 'center' : 'footer'
));

// 当前项目是 workspace domain 的派生活动态，只在这条统一装配链同步一次。
watch(
  currentScope,
  (scope) => {
    if (scope.kind === 'project') {
      if (projectsStore.activeProjectId !== scope.projectId) {
        projectsStore.markActiveProject(scope.projectId);
      }
      return;
    }

    projectsStore.clearActiveProject();
  },
  { immediate: true },
);
</script>
