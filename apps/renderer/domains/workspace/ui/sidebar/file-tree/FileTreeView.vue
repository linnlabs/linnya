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
        <button v-show="isHeaderHovered" @click="$emit('create-folder')" class="add-button" :title="workspaceMessage('workspace.sidebar.fileTree.newFolder')">
          <NewFolderIcon />
        </button>

        <!-- 新建文件下拉菜单：文档 / 思维导图 / 表格 / 演示文稿 -->
        <div class="more-menu-container">
          <button
            v-show="isHeaderHovered"
            ref="newFileButtonRef"
            @click="toggleCreateMenu"
            class="add-button"
            :title="workspaceMessage('workspace.sidebar.fileTree.newFile')"
          >
            <NewFileIcon />
          </button>
        </div>

        <div class="more-menu-container">
          <button 
            v-show="isHeaderHovered" 
            ref="moreButtonRef"
            @click="toggleMoreMenu" 
            class="add-button more-button" 
            :title="workspaceMessage('workspace.sidebar.fileTree.moreOptions')"
          >
            <MoreIcon direction="horizontal" />
          </button>
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
  
      <div v-else class="empty-directory-state">
        <div class="empty-directory-card">
          <div class="empty-content">
            <div class="empty-title-row">
              <span class="empty-title">{{ workspaceMessage('workspace.sidebar.fileTree.emptyTitle') }}</span>
              <span class="empty-badge">{{ workspaceMessage('workspace.sidebar.fileTree.emptyBadge') }}</span>
            </div>
            <p class="empty-subtitle">
              {{ workspaceMessage('workspace.sidebar.fileTree.emptySubtitle') }}
            </p>
            <div class="empty-actions">
              <ActionButtons 
                v-if="primaryCreateAction"
                class="empty-action"
                :show-primary-action="true"
                :show-secondary-action="Boolean(secondaryCreateAction)"
                @primary-click="emitCreateFile(primaryCreateAction)"
                @secondary-click="secondaryCreateAction && emitCreateFile(secondaryCreateAction)"
              >
                <template #primary-content>
                  <component :is="primaryCreateAction.iconComponent" class="button-icon" />
                  <span>{{ primaryCreateAction.localizedText.createLabel }}</span>
                </template>
                <template #secondary-content>
                  <component v-if="secondaryCreateAction" :is="secondaryCreateAction.iconComponent" class="button-icon" />
                  <span v-if="secondaryCreateAction">{{ secondaryCreateAction.localizedText.createLabel }}</span>
                </template>
              </ActionButtons>
              <ActionButtons
                v-for="action in remainingCreateActions"
                :key="action.createRequestType"
                class="empty-action empty-action--full"
                :show-primary-action="true"
                :show-secondary-action="false"
                @primary-click="emitCreateFile(action)"
              >
                <template #primary-content>
                  <component :is="action.iconComponent" class="button-icon" />
                  <span>{{ action.localizedText.createLabel }}</span>
                </template>
              </ActionButtons>
              <ActionButtons 
                class="empty-action--full"
                :show-primary-action="true"
                :show-secondary-action="false"
                primary-variant="accent"
                @primary-click="$emit('ai-init-project')"
              >
                <template #primary-content>
                  <AiIcon class="button-icon" />
                  <span>{{ workspaceMessage('workspace.sidebar.fileTree.aiInit') }}</span>
                </template>
              </ActionButtons>
            </div>
              </div>
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
import { ActionButtons } from '@linnya/renderer-ui';
import { NewFolderIcon } from '@linnya/renderer-ui/icons';
import { NewFileIcon } from '@linnya/renderer-ui/icons';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect } from '@linnya/renderer-ui';
import { AiIcon } from '@linnya/renderer-ui/icons';
import BatchExportMarkdownModal from '../../../features/import-export/ui/export/BatchExportMarkdownModal.vue';
import { batchExportProjectAsMarkdown } from '../../../features/import-export/services/batchExportService';
import { useWorkspaceTreeStore } from '../../../store/index.js';
import { useUIStore } from '../../../../../shared/stores/ui';
import { useNotificationStore } from '@/app/notification';
import { useFixedDropdownPosition } from '../composables/useFixedDropdownPosition';
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
const treeStore = useWorkspaceTreeStore();
const uiStore = useUIStore();
const notificationStore = useNotificationStore();
const { workspaceMessage } = useWorkspaceLocalization();

// 批量导出模态框状态
const isBatchExportModalVisible = ref(false);
const currentProjectNameForExport = computed(() => props.currentProjectName || workspaceMessage('workspace.sidebar.fileTree.currentProject'));

// 新建菜单状态
const showCreateMenu = ref(false);
const newFileButtonRef = ref(null);
const {
  dropdownRef: createDropdownRef,
  dropdownStyle: createDropdownStyle,
  positionDropdownAfterRender: positionCreateDropdownAfterRender,
} = useFixedDropdownPosition();

const documentCreateActions = useLocalizedCreatableDocumentTypes();
const primaryCreateAction = computed(() => documentCreateActions.value[0] ?? null);
const secondaryCreateAction = computed(() => documentCreateActions.value[1] ?? null);
const remainingCreateActions = computed(() => documentCreateActions.value.slice(2));

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
const moreButtonRef = ref(null);
const {
  dropdownRef: moreDropdownRef,
  dropdownStyle: moreDropdownStyle,
  positionDropdownAfterRender: positionMoreDropdownAfterRender,
} = useFixedDropdownPosition();

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
    void positionCreateDropdownAfterRender(newFileButtonRef.value);
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
    void positionMoreDropdownAfterRender(moreButtonRef.value);
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
    uiStore,
    settings,
    workspaceMessage,
  });

  if (result.success) {
    notificationStore.show(workspaceMessage('workspace.sidebar.fileTree.batchExportComplete', { count: result.exportedCount }), 'success');
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
