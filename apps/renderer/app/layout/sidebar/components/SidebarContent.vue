<template>
  <div
    ref="sidebarContentHostRef"
    class="sidebar-content"
    data-overlay-scroll-theme="linnya"
    data-overlay-scroll-visibility="strict-hover"
  >
    <div
      ref="sidebarContentViewportMountRef"
      class="sidebar-content-viewport"
      data-sidebar-scroll-viewport="true"
      @dragover.prevent="$emit('root-drag-over', $event)"
      @dragleave="$emit('root-drag-leave', $event)"
      @drop.prevent="$emit('root-drop', $event)"
    >
      <template v-if="sidebarNav === 'list'">
        <SidebarChatList
          v-if="currentScope.kind === 'linnya-assistant'"
          :scope="{ kind: 'linnya-assistant' }"
          surface="outer-list"
          :reveal-pulse-key="getConversationRevealPulseKey({ kind: 'linnya-assistant' })"
          :selection-enabled="isWorkspaceScene"
          @display-change="$emit('display-change')"
        />

          <div class="projects-section">
          <div class="section-header">
            <span class="section-title">{{ workspaceMessage('workspace.sidebar.section.projects') }}</span>
          </div>

          <div v-if="projects.length === 0" class="sidebar-empty-state">
            {{ workspaceMessage('workspace.sidebar.project.empty') }}
          </div>

          <template v-for="project in projects" :key="project.id">
            <SidebarProjectGroup
              :project="project"
              :is-expanded="isProjectExpanded(project.id)"
              :conversation-selection-enabled="isWorkspaceScene"
              @activate="$emit('project-chat-click', $event)"
              @open="$emit('open-project', $event)"
              @overview="$emit('open-project-overview', $event)"
              @edit="$emit('edit-project', $event)"
              @delete="$emit('delete-project', $event)"
              @prefetch-conversations="$emit('project-conversation-prefetch', $event)"
              @conversation-selected="$emit('project-conversation-selected', $event)"
              @conversation-display-change="$emit('display-change')"
              @collapse-transition-start="$emit('collapse-transition-start')"
              @collapse-transition-end="$emit('collapse-transition-end')"
            />
          </template>
        </div>
      </template>

      <template v-else>
        <!-- 中文说明：项目态在「文件 / 对话」之间切换时保留两侧面板挂载，避免对话列表重新拉取造成瞬时闪烁。 -->
        <div
          v-if="currentScope.kind === 'project'"
          v-show="sidebarMode === 'chat'"
          class="project-chat-panel"
        >
          <div class="project-section-heading">
            <div class="section-header">
              <span class="section-title">{{ workspaceMessage('workspace.sidebar.section.recentChats') }}</span>
            </div>
          </div>

          <SidebarChatList
            :scope="{ kind: 'project', projectId: currentScope.projectId }"
            surface="project-panel"
            :active="sidebarMode === 'chat'"
            :search-query="projectChatSearchQuery"
            :reveal-pulse-key="getConversationRevealPulseKey({ kind: 'project', projectId: currentScope.projectId })"
            display-mode="full"
            :selection-enabled="isWorkspaceScene"
            @selected="$emit('project-conversation-selected', currentScope.projectId)"
            @display-change="$emit('display-change')"
          />
        </div>

        <div
          v-if="isProjectFilesPanelVisible"
          v-show="sidebarMode === 'files'"
          class="project-files-panel"
        >
          <div class="project-section-heading">
            <div class="section-header">
              <span class="section-title">{{ workspaceMessage('workspace.sidebar.section.projectFiles') }}</span>
            </div>
          </div>

          <div v-if="isProjectSetupView && projectTree.length === 0" class="project-setup-empty-state">
            <div class="project-setup-card">
              <div class="project-setup-title-row">
                <div class="project-setup-title-main">
                  <span class="project-setup-eyebrow">{{ workspaceMessage('workspace.sidebar.projectSetup.eyebrow') }}</span>
                  <span class="project-setup-title">{{ workspaceMessage('workspace.sidebar.projectSetup.title') }}</span>
                </div>
                <span class="project-setup-badge">{{ workspaceMessage('workspace.sidebar.projectSetup.badge') }}</span>
              </div>
              <p class="project-setup-subtitle">
                {{ workspaceMessage('workspace.sidebar.projectSetup.subtitle') }}
              </p>
            </div>
          </div>

          <div v-else-if="shouldShowProjectTreeLoading" class="loading-state">
            <svg class="loading-icon spin" viewBox="0 0 24 24">
              <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8Z" />
            </svg>
            <p>{{ workspaceMessage('workspace.sidebar.fileTree.loading') }}</p>
          </div>

            <FileTreeView
            v-else
            :project-tree="filteredProjectTree"
            :current-project-name="currentProjectName"
            :show-project-title="false"
            :is-filtering="isFilteringProjectFiles"
            :is-drag-over-root="isDragOverRoot"
            @item-click="$emit('tree-item-click', $event)"
            @create-file="$emit('create-file', $event)"
            @create-folder="$emit('create-folder')"
            @show-context-menu="$emit('show-context-menu', $event)"
            @edit-project-info="$emit('edit-active-project')"
            @ai-init-project="$emit('ai-init-project')"
          />
        </div>

        <div v-if="currentScope.kind !== 'project'" class="sidebar-empty-state">
          {{ workspaceMessage('workspace.sidebar.projectUnavailable') }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import SidebarChatList from '@/domains/conversation/ui/SidebarChatList.vue';
import SidebarProjectGroup from '@/app/layout/sidebar/components/SidebarProjectGroup.vue';
import { FileTreeView } from '@/domains/workspace/ui/sidebar';
import type { Project, WorkspaceNode } from '@/domains/workspace/store';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';

type WorkspaceSidebarNav = 'list' | 'project';
type WorkspaceSidebarMode = 'chat' | 'files';
type WorkspaceScope =
  | { kind: 'linnya-assistant' }
  | { kind: 'project'; projectId: string };

defineProps<{
  sidebarNav: WorkspaceSidebarNav;
  sidebarMode: WorkspaceSidebarMode;
  currentScope: WorkspaceScope;
  projects: Project[];
  isWorkspaceScene: boolean;
  projectChatSearchQuery: string;
  projectTree: WorkspaceNode[];
  filteredProjectTree: WorkspaceNode[];
  currentProjectName: string;
  isFilteringProjectFiles: boolean;
  isDragOverRoot: boolean;
  shouldShowProjectTreeLoading: boolean;
  isProjectSetupView: boolean;
  isProjectFilesPanelVisible: boolean;
  isProjectExpanded: (projectId: string) => boolean;
  getConversationRevealPulseKey: (scope: WorkspaceScope) => number;
  workspaceMessage: WorkspaceMessageResolver;
}>();

defineEmits<{
  'root-drag-over': [event: DragEvent];
  'root-drag-leave': [event: DragEvent];
  'root-drop': [event: DragEvent];
  'display-change': [];
  'project-chat-click': [projectId: string];
  'open-project': [projectId: string];
  'open-project-overview': [projectId: string];
  'edit-project': [project: Project];
  'delete-project': [projectId: string];
  'project-conversation-prefetch': [projectId: string];
  'project-conversation-selected': [projectId: string];
  'collapse-transition-start': [];
  'collapse-transition-end': [];
  'tree-item-click': [payload: { node: WorkspaceNode; event: MouseEvent }];
  'create-file': [payload?: { type?: string }];
  'create-folder': [];
  'show-context-menu': [payload: { event: MouseEvent; item: WorkspaceNode }];
  'edit-active-project': [];
  'ai-init-project': [];
}>();

const sidebarContentHostRef = ref<HTMLElement | null>(null);
const sidebarContentViewportMountRef = ref<HTMLElement | null>(null);
const sidebarContentViewportRef = ref<HTMLElement | null>(null);

defineExpose({
  sidebarContentHostRef,
  sidebarContentViewportMountRef,
  sidebarContentViewportRef,
});
</script>
