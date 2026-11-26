<template>
  <div class="sidebar-project-group">
    <div
      class="workspace-sidebar-row project-row"
      :class="{ 'is-menu-open': isProjectMenuOpen }"
      role="button"
      tabindex="0"
      @pointerenter="$emit('prefetch-conversations', project.id)"
      @focus="$emit('prefetch-conversations', project.id)"
      @click="handleProjectRowClick"
      @dblclick="openProject"
      @keydown="handleProjectRowKeydown"
    >
      <FolderIcon class="workspace-sidebar-row-icon project-row-icon" />
      <span class="workspace-sidebar-row-label project-row-name">{{ project.name }}</span>
      <span v-if="collapsedRunSummary" class="project-row-run-summary">
        <ConversationRunStatusIndicator
          :status="collapsedRunSummary.status"
          :label="collapsedRunSummary.label"
        />
      </span>
      <span class="workspace-sidebar-row-actions project-row-actions" @click.stop @dblclick.stop>
        <IconButton
          :label="workspaceMessage('workspace.sidebar.project.open')"
          class="row-action-button"
          @click="$emit('open', project.id)"
        >
          <FolderOpenIcon />
        </IconButton>
        <IconButton
          :label="workspaceMessage('workspace.sidebar.project.moreOptions')"
          class="row-action-button"
          ref="moreButton"
          @click="toggleProjectMenu"
        >
          <MoreIcon direction="horizontal" />
        </IconButton>
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
      @after-enter="finishCollapseTransition"
      @enter-cancelled="finishCollapseTransition"
      @before-leave="handleCollapseBeforeLeave"
      @leave="handleCollapseLeave"
      @after-leave="finishCollapseTransition"
      @leave-cancelled="finishCollapseTransition"
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
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { FolderIcon } from '@linnya/renderer-ui/icons';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import { FolderOpenIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect, IconButton, onNextFrame, useAnchoredPosition, type IconButtonExposed } from '@linnya/renderer-ui';
import SidebarChatList from '@/domains/conversation/ui/SidebarChatList.vue';
import {
  ConversationRunStatusIndicator,
  useConversationRunStatus,
} from '@/domains/conversation/features/conversation-activity';
import type { Project } from '@/domains/workspace/store';
import {
  buildProjectMenuOptions,
  isProjectDeleteDisabled,
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
const moreButton = ref<IconButtonExposed | null>(null);
const moreButtonRef = computed<HTMLButtonElement | null>(() => moreButton.value?.element ?? null);
const hasMountedConversations = ref(props.isExpanded === true);
const { workspaceMessage } = useWorkspaceLocalization();
const runStatus = useConversationRunStatus();
/* 收起时行尾只给项目里最需要处理的一种状态，悬停记号看数量；展开后由各对话行自己显示。 */
const collapsedRunSummary = computed(() => (props.isExpanded ? null : runStatus.projectSummaryOf(props.project.id)));
const projectMenuOptions = computed<ProjectMenuOption[]>(() => buildProjectMenuOptions(props.project, workspaceMessage));
const dropdownRef = ref<HTMLElement | null>(null);
const { style: dropdownStyle } = useAnchoredPosition({
  anchor: moreButtonRef,
  floating: dropdownRef,
  open: isProjectMenuOpen,
  placement: { gap: 4 },
});

function toggleProjectMenu(): void {
  isProjectMenuOpen.value = !isProjectMenuOpen.value;
}

function closeProjectMenu(): void {
  isProjectMenuOpen.value = false;
}

function activateProject(): void {
  emit('activate', props.project.id);
}

/* 双击进入项目：第二次点击不再切换展开，否则双击会先展开又收起。 */
function handleProjectRowClick(event: MouseEvent): void {
  if (event.detail > 1) return;
  activateProject();
}

function openProject(): void {
  emit('open', props.project.id);
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

/*
 * 中文说明：侧栏滚动层收到 start 后会冻结滚动范围，只有收到 end 才解除。
 * 动画被打断、或动画中途整组卸载（例如展开后立刻进入项目）时 after-* 不会触发，
 * 所以 start / end 必须成对：取消钩子和卸载都要补发 end，否则滚动层的预留内边距会永久留下。
 */
let isCollapseTransitionPending = false;

function startCollapseTransition(): void {
  isCollapseTransitionPending = true;
  emit('collapse-transition-start');
}

function finishCollapseTransition(element: Element): void {
  const collapseElement = getCollapseElement(element);
  if (collapseElement) {
    collapseElement.style.height = '';
  }
  if (!isCollapseTransitionPending) return;
  isCollapseTransitionPending = false;
  emit('collapse-transition-end');
}

function handleCollapseBeforeEnter(element: Element): void {
  startCollapseTransition();
  const collapseElement = getCollapseElement(element);
  if (!collapseElement) return;

  collapseElement.style.height = '0px';
}

function handleCollapseEnter(element: Element): void {
  const collapseElement = getCollapseElement(element);
  if (!collapseElement) return;

  // 高度先停在 0 一帧，过渡才会从 0 展开。
  onNextFrame(() => {
    collapseElement.style.height = `${collapseElement.scrollHeight}px`;
  });
}

function handleCollapseBeforeLeave(element: Element): void {
  startCollapseTransition();
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

onBeforeUnmount(() => {
  if (!isCollapseTransitionPending) return;
  isCollapseTransitionPending = false;
  emit('collapse-transition-end');
});

watch(
  () => props.isExpanded,
  (isExpanded) => {
    if (isExpanded) {
      hasMountedConversations.value = true;
    }
  },
);
</script>
