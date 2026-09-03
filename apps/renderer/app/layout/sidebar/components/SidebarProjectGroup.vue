<template>
  <div class="sidebar-project-group">
    <div
      class="workspace-sidebar-row project-row"
      role="button"
      tabindex="0"
      @pointerenter="$emit('prefetch-conversations', project.id)"
      @focus="$emit('prefetch-conversations', project.id)"
      @click="activateProject"
      @keydown="handleProjectRowKeydown"
    >
      <FolderIcon class="workspace-sidebar-row-icon project-row-icon" />
      <span class="workspace-sidebar-row-label project-row-name">{{ project.name }}</span>
      <span class="workspace-sidebar-row-actions project-row-actions" @click.stop>
        <button
          class="workspace-sidebar-row-action-button row-action-button"
          type="button"
          :title="workspaceMessage('workspace.sidebar.project.open')"
          @click="$emit('open', project.id)"
        >
          <OpenIcon />
        </button>
        <button
          ref="moreButtonRef"
          class="workspace-sidebar-row-action-button row-action-button"
          type="button"
          :title="workspaceMessage('workspace.sidebar.project.moreOptions')"
          @click="toggleProjectMenu"
        >
          <MoreIcon direction="horizontal" />
        </button>
      </span>
    </div>

    <Teleport to="body">
      <Transition name="sidebar-project-menu-fade">
        <div
          v-if="isProjectMenuOpen"
          ref="dropdownRef"
          class="sidebar-project-menu-wrapper"
          :style="dropdownStyle"
        >
          <CustomSelect
            :model-value="null"
            :options="projectMenuOptions"
            :manual-mode="true"
            variant="minimal"
            :bordered="false"
            :external-trigger-ref="moreButtonRef"
            @update:model-value="handleProjectMenuSelect"
            @close="closeProjectMenu"
          />
        </div>
      </Transition>
    </Teleport>

    <Transition
      name="project-collapse"
      @before-enter="handleCollapseBeforeEnter"
      @enter="handleCollapseEnter"
      @after-enter="handleCollapseAfterEnter"
      @before-leave="handleCollapseBeforeLeave"
      @leave="handleCollapseLeave"
      @after-leave="handleCollapseAfterLeave"
    >
      <div v-if="hasMountedConversations" v-show="isExpanded" class="project-collapse">
        <div class="project-collapse-inner">
          <SidebarChatList
            :scope="{ kind: 'project', projectId: project.id }"
            :active="isExpanded"
            surface="outer-list"
            :selection-enabled="conversationSelectionEnabled"
            @selected="$emit('conversation-selected', project.id)"
            @display-change="$emit('conversation-display-change')"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FolderIcon } from '@linnya/renderer-ui/icons';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import { OpenIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect } from '@linnya/renderer-ui';
import SidebarChatList from '@/domains/conversation/ui/SidebarChatList.vue';
import type { Project } from '@/domains/workspace/store';
import {
  buildProjectMenuOptions,
  isProjectDeleteDisabled,
  useFixedDropdownPosition,
} from '@/domains/workspace/ui/sidebar';
import type { ProjectMenuAction, ProjectMenuOption } from '@/domains/workspace/ui/sidebar';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';

const props = defineProps<{
  project: Project;
  isExpanded?: boolean;
  conversationSelectionEnabled?: boolean;
}>();

const emit = defineEmits<{
  activate: [projectId: string];
  open: [projectId: string];
  overview: [projectId: string];
  edit: [project: Project];
  delete: [projectId: string];
  'prefetch-conversations': [projectId: string];
  'conversation-selected': [projectId: string];
  'conversation-display-change': [];
  'collapse-transition-start': [];
  'collapse-transition-end': [];
}>();

const isProjectMenuOpen = ref(false);
const moreButtonRef = ref<HTMLButtonElement | null>(null);
const hasMountedConversations = ref(props.isExpanded === true);
const { workspaceMessage } = useWorkspaceLocalization();
const projectMenuOptions = computed<ProjectMenuOption[]>(() => buildProjectMenuOptions(props.project, workspaceMessage));
const {
  dropdownRef,
  dropdownStyle,
  positionDropdownAfterRender,
} = useFixedDropdownPosition();

function toggleProjectMenu(): void {
  isProjectMenuOpen.value = !isProjectMenuOpen.value;
  if (!isProjectMenuOpen.value) return;

  void positionDropdownAfterRender(moreButtonRef.value);
}

function closeProjectMenu(): void {
  isProjectMenuOpen.value = false;
}

function activateProject(): void {
  emit('activate', props.project.id);
}

function handleProjectRowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  activateProject();
}

function handleProjectMenuSelect(action: ProjectMenuAction | null): void {
  if (action === 'overview') {
    emit('overview', props.project.id);
  } else if (action === 'edit') {
    emit('edit', props.project);
  } else if (action === 'delete') {
    if (isProjectDeleteDisabled(props.project)) {
      closeProjectMenu();
      return;
    }
    emit('delete', props.project.id);
  }

  closeProjectMenu();
}

function getCollapseElement(element: Element): HTMLElement | null {
  return element instanceof HTMLElement ? element : null;
}

function handleCollapseBeforeEnter(element: Element): void {
  emit('collapse-transition-start');
  const collapseElement = getCollapseElement(element);
  if (!collapseElement) return;

  collapseElement.style.height = '0px';
}

function handleCollapseEnter(element: Element): void {
  const collapseElement = getCollapseElement(element);
  if (!collapseElement) return;

  requestAnimationFrame(() => {
    collapseElement.style.height = `${collapseElement.scrollHeight}px`;
  });
}

function handleCollapseAfterEnter(element: Element): void {
  const collapseElement = getCollapseElement(element);
  if (collapseElement) {
    collapseElement.style.height = '';
  }
  emit('collapse-transition-end');
}

function handleCollapseBeforeLeave(element: Element): void {
  emit('collapse-transition-start');
  const collapseElement = getCollapseElement(element);
  if (!collapseElement) return;

  collapseElement.style.height = `${collapseElement.scrollHeight}px`;
}

function handleCollapseLeave(element: Element): void {
  const collapseElement = getCollapseElement(element);
  if (!collapseElement) return;

  /*
   * 中文说明：先让浏览器确认当前高度，再切到 0px。
   * 这样内容会被真实高度裁切，避免 grid 抽屉出现“先撑空白、文字后出现”的视觉断层。
   */
  void collapseElement.offsetHeight;
  collapseElement.style.height = '0px';
}

function handleCollapseAfterLeave(element: Element): void {
  const collapseElement = getCollapseElement(element);
  if (collapseElement) {
    collapseElement.style.height = '';
  }
  emit('collapse-transition-end');
}

watch(
  () => props.isExpanded,
  (isExpanded) => {
    if (isExpanded) {
      hasMountedConversations.value = true;
    }
  },
);
</script>
