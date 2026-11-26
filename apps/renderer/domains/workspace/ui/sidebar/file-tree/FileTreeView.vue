<!-- apps/renderer/domains/workspace/ui/sidebar/file-tree/FileTreeView.vue -->
<template>
  <div class="file-tree-view" :class="{ 'file-tree-view--title-hidden': !showProjectTitle }">
    <div
      v-if="showProjectTitle"
      class="project-title-header"
      :class="{ 'drag-over-root': isDragOverRoot }"
      @mouseenter="isHeaderHovered = true"
      @mouseleave="isHeaderHovered = false"
    >
      <h2 class="project-title-text">{{ currentProjectName }}</h2>
      <div class="header-actions">
        <IconButton
          :label="workspaceMessage('workspace.sidebar.fileTree.newFolder')"
          class="add-button"
          v-show="isHeaderHovered"
          @click="$emit('create-folder')"
        >
          <FolderAddIcon />
        </IconButton>

        <!-- 新建文件下拉菜单：文档与已启用插件提供的文档类型 -->
        <div class="more-menu-container">
          <IconButton
            :label="workspaceMessage('workspace.sidebar.fileTree.newFile')"
            class="add-button"
            v-show="isHeaderHovered"
            ref="newFileButton"
            @click="toggleCreateMenu"
          >
            <DocumentAddIcon />
          </IconButton>
        </div>

        <div class="more-menu-container">
          <IconButton
            :label="workspaceMessage('workspace.sidebar.fileTree.moreOptions')"
            class="add-button more-button"
            v-show="isHeaderHovered"
            ref="moreButton"
            @click="toggleMoreMenu"
          >
            <MoreIcon direction="horizontal" />
          </IconButton>
          <Teleport to="body">
            <transition name="workspace-file-tree-menu-fade">
              <div 
                v-if="showMoreMenu"
                ref="moreDropdownRef"
                class="file-tree-menu-wrapper file-tree-more-menu-wrapper"
                :style="moreDropdownStyle"
              >
                <CustomSelect
                  :model-value="null"
                  :options="moreMenuOptions"
                  :manual-mode="true"
                  :parent-is-open="showMoreMenu"
                  semantic-role="menu"
                  min-width="120px"
                  variant="minimal"
                  :bordered="false"
                  :external-trigger-ref="moreButtonRef"
                  :class-names="{
                    options: 'file-tree-more-menu-options',
                    optionArrow: 'file-tree-more-menu-option-arrow',
                  }"
                  @update:model-value="handleMoreMenuSelection"
                  @close="showMoreMenu = false"
                />
              </div>
            </transition>
          </Teleport>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <transition name="workspace-file-tree-menu-fade">
        <div
          v-if="showCreateMenu"
          ref="createDropdownRef"
          class="file-tree-menu-wrapper"
          :style="createDropdownStyle"
        >
          <CustomSelect
            :model-value="null"
            :options="createOptions"
            :manual-mode="true"
            :parent-is-open="showCreateMenu"
            semantic-role="menu"
            variant="minimal"
            :bordered="false"
            :external-trigger-ref="newFileButtonRef"
            :class-names="{ options: 'file-tree-create-menu-options' }"
            @update:model-value="handleCreateSelection"
            @close="showCreateMenu = false"
          />
        </div>
      </transition>
    </Teleport>

    <div class="tree-scroll-container">
      <div v-if="projectTree.length > 0" class="workspace-sidebar-row-list file-tree">
        <TreeItem 
          v-for="node in projectTree" 
          :key="node.id" 
          :node="node" 
          @item-click="handleItemClick"
        />
      </div>

      <div v-else-if="isFiltering" class="file-search-empty-state">
        {{ workspaceMessage('workspace.sidebar.fileTree.searchEmpty') }}
      </div>
  
      <!-- 空项目：一行说明 + 与文件行同形的类型行；常用类型直接露出，其余收进“更多类型”，插件再多也不堆按钮。 -->
      <div v-else class="empty-directory-state">
        <p class="empty-hint">{{ workspaceMessage('workspace.sidebar.fileTree.emptyHint') }}</p>
        <div class="workspace-sidebar-row-list empty-create-list">
          <button
            v-for="action in shownCreateActions"
            :key="action.createRequestType"
            type="button"
            class="workspace-sidebar-row empty-create-row"
            @click="emitCreateFile(action)"
          >
            <span class="workspace-sidebar-row-icon">
              <component :is="action.iconComponent" />
            </span>
            <span class="workspace-sidebar-row-label">{{ action.localizedText.label }}</span>
          </button>
          <button
            v-if="hiddenCreateActionCount > 0"
            type="button"
            class="workspace-sidebar-row empty-create-row empty-create-row--toggle"
            :aria-expanded="showAllCreateActions"
            @click="showAllCreateActions = !showAllCreateActions"
          >
            <span class="workspace-sidebar-row-icon" />
            <span class="workspace-sidebar-row-label">
              {{ showAllCreateActions
                ? workspaceMessage('workspace.sidebar.fileTree.fewerTypes')
                : workspaceMessage('workspace.sidebar.fileTree.moreTypes', { count: hiddenCreateActionCount }) }}
            </span>
            <ChevronIcon :direction="showAllCreateActions ? 'up' : 'down'" class="empty-create-chevron" />
          </button>
          <button
            type="button"
            class="workspace-sidebar-row empty-create-row empty-create-row--ai"
            @click="$emit('ai-init-project')"
          >
            <span class="workspace-sidebar-row-icon">
              <LinnyaIcon />
            </span>
            <span class="workspace-sidebar-row-label">{{ workspaceMessage('workspace.sidebar.fileTree.aiInit') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 批量导出（仅支持 Markdown 文档） -->
    <BatchExportMarkdownModal
      :is-visible="isBatchExportModalVisible"
      :project-name="currentProjectNameForExport"
      @close="isBatchExportModalVisible = false"
      @confirm="handleBatchExportConfirm"
    />
  </div>
</template>

<script setup>
import { provide, ref, computed } from 'vue';
import TreeItem from './TreeItem.vue';
import { IconButton } from '@linnya/renderer-ui';
import { FolderAddIcon } from '@linnya/renderer-ui/icons';
import { DocumentAddIcon } from '@linnya/renderer-ui/icons';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect, useAnchoredPosition } from '@linnya/renderer-ui';
import { ChevronIcon, LinnyaIcon } from '@linnya/renderer-ui/icons';
import BatchExportMarkdownModal from '../../../features/import-export/ui/export/BatchExportMarkdownModal.vue';
import { batchExportProjectAsMarkdown } from '../../../features/import-export/services/batchExportService';
import { describeBatchExportResult } from '../../../functions/describeBatchExportResult';
import { useWorkspaceTree } from '../../../tree';
import { useNotificationStore } from '@/app/notification';
import { useLocalizedCreatableDocumentTypes } from '@/app/plugins/ui/useDocumentTypePresentation';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';

const props = defineProps({
  projectTree: {
    type: Array,
    required: true,
  },
  currentProjectName: {
    type: String,
    required: true,
  },
  showProjectTitle: {
    type: Boolean,
    default: true,
  },
  isDragOverRoot: {
    type: Boolean,
    default: false,
  },
  isFiltering: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['item-click', 'create-file', 'create-folder', 'show-context-menu', 'edit-project-info', 'ai-init-project']);

const isHeaderHovered = ref(false);
const treeStore = useWorkspaceTree();
const notificationStore = useNotificationStore();
const { workspaceMessage } = useWorkspaceLocalization();

// 批量导出模态框状态
const isBatchExportModalVisible = ref(false);
const currentProjectNameForExport = computed(() => props.currentProjectName || workspaceMessage('workspace.sidebar.fileTree.currentProject'));

// 新建菜单状态
const showCreateMenu = ref(false);
const newFileButton = ref(null);
const newFileButtonRef = computed(() => newFileButton.value?.element ?? null);
const createDropdownRef = ref(null);
const { style: createDropdownStyle } = useAnchoredPosition({
  anchor: newFileButtonRef,
  floating: createDropdownRef,
  open: showCreateMenu,
  placement: { gap: 4 },
});

const documentCreateActions = useLocalizedCreatableDocumentTypes();
// 空项目直接露出的类型数（按 createPriority 排序后的前几种），其余收进“更多类型”。
const VISIBLE_CREATE_ACTION_COUNT = 3;
const showAllCreateActions = ref(false);
const shownCreateActions = computed(() => (
  showAllCreateActions.value
    ? documentCreateActions.value
    : documentCreateActions.value.slice(0, VISIBLE_CREATE_ACTION_COUNT)
));
const hiddenCreateActionCount = computed(() => Math.max(0, documentCreateActions.value.length - VISIBLE_CREATE_ACTION_COUNT));

// “新建”下拉选项：从 documentType 贡献生成，并补上文件夹入口。
const createOptions = computed(() => [
  { value: 'folder', text: workspaceMessage('workspace.sidebar.fileTree.newFolder') },
  { isSeparator: true },
  ...documentCreateActions.value.map((action) => ({
    value: action.createRequestType,
    text: action.localizedText.label,
  })),
]);

// 更多菜单状态
const showMoreMenu = ref(false);
const moreButton = ref(null);
const moreButtonRef = computed(() => moreButton.value?.element ?? null);
const moreDropdownRef = ref(null);
const { style: moreDropdownStyle } = useAnchoredPosition({
  anchor: moreButtonRef,
  floating: moreDropdownRef,
  open: showMoreMenu,
  placement: { gap: 4 },
});

// 更多菜单选项
const moreMenuOptions = computed(() => [
  { value: 'edit-info', text: workspaceMessage('workspace.sidebar.fileTree.menu.editInfo') },
  {
    value: 'batch-export',
    text: workspaceMessage('workspace.sidebar.fileTree.menu.batchExport'),
    // 中文说明：一级菜单用于 hover 展示二级菜单；点击一级菜单不执行任何动作（见 handleMoreMenuSelection）
    children: [{ value: 'batch-export-markdown', text: workspaceMessage('workspace.sidebar.fileTree.menu.exportMarkdown') }],
  },
]);

const handleItemClick = (payload) => {
  emit('item-click', payload);
};

const emitCreateFile = (action) => {
  emit('create-file', { type: action.createRequestType });
};

// 切换新建菜单
const toggleCreateMenu = () => {
  showCreateMenu.value = !showCreateMenu.value;
  if (showCreateMenu.value) {
    showMoreMenu.value = false;
  }
};

// 处理新建菜单选择
const handleCreateSelection = (value) => {
  if (!value) return;

  if (value === 'folder') {
    emit('create-folder');
    showCreateMenu.value = false;
    return;
  }

  // 向父组件发送开放的文件类型（platform document 或插件声明的 node type）
  emit('create-file', { type: value });
  showCreateMenu.value = false;
};

// 切换更多菜单
const toggleMoreMenu = () => {
  showMoreMenu.value = !showMoreMenu.value;
  if (showMoreMenu.value) {
    showCreateMenu.value = false;
  }
};

// 处理更多菜单选项选择
const handleMoreMenuSelection = (value) => {
  if (value === 'edit-info') {
    emit('edit-project-info');
  } else if (value === 'batch-export-markdown') {
    isBatchExportModalVisible.value = true;
  }
  showMoreMenu.value = false;
};

const handleBatchExportConfirm = async (settings) => {
  const result = await batchExportProjectAsMarkdown({
    treeStore,
    settings,
    workspaceMessage,
  });

  if (result.success) {
    const notice = describeBatchExportResult(result, workspaceMessage);
    notificationStore.show(notice.message, notice.type, notice.durationMs);
    isBatchExportModalVisible.value = false;
    return;
  }

  notificationStore.show(workspaceMessage(result.error.key, result.error.params), 'error');
};

// 为 TreeItem 子组件提供需要的注入
provide('showContextMenu', (event, item) => {
  emit('show-context-menu', { event, item });
});

provide('resetDragStates', () => {
  // 由父组件处理
});
</script>
