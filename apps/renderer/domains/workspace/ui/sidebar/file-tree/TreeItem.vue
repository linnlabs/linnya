<!-- apps/renderer/domains/workspace/ui/sidebar/file-tree/TreeItem.vue -->
<template>
  <div 
    class="tree-item"
    :style="{ '--node-depth': node.depth }" 
    :class="{ 
      'active-file': isActiveFile, 
      'is-renaming': isRenaming, 
      'drag-over': isDragOver,
      'dragging': isDragging,
      'is-more-menu-open': isMoreMenuOpen
    }"
    :draggable="!isRenaming && !node.isVirtual"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
    @click="handleItemClick"
    @contextmenu.prevent="handleContextMenu"
    @dragstart="handleDragStart"
    @dragend="handleDragEnd"
  >
    <div 
      class="workspace-sidebar-row tree-item-content"
      :class="{ 'is-active': isActiveFile }"
      @dragover.prevent="handleDragOver"
      @dragleave="handleDragLeave"
      @drop.prevent="handleDrop"
    >
      <span class="expand-icon" @click.stop="toggleExpansion" v-if="node.type === 'folder'">
        <ChevronIcon :direction="node.isExpanded ? 'down' : 'right'" class="svg-icon" />
      </span>
      
      <span class="workspace-sidebar-row-icon item-icon">
        <component :is="nodeIconComponent" class="svg-icon" :class="nodeIconClass" />
      </span>
      
      <span v-show="!isRenaming" class="workspace-sidebar-row-label item-name">
        {{ nodeDisplayName }}
      </span>
      
      <!-- 新建文件的 New 标签：独立于文件名，避免被截断 -->
      <span
        v-if="isNewNode && node.type !== 'folder'"
        class="new-badge"
      >
        {{ workspaceMessage('workspace.sidebar.fileTree.newBadge') }}
      </span>

      <input 
        v-show="isRenaming" 
        ref="renameInputRef" 
        type="text" 
        v-model="renameValue" 
        class="rename-input"
        @blur="onInputBlur"
        @keydown.enter.prevent="onEnterKey" 
        @keydown.esc.prevent="cancelRename"
        @click.stop  
        @keydown.stop 
      />

      <!-- 右侧 More 菜单：hover 出现，点击后打开与右键一致的上下文菜单 -->
      <span class="workspace-sidebar-row-actions item-actions">
        <button
          v-show="(isHovered || isMoreMenuOpen) && !isRenaming && moreMenuOptions.length > 0"
          ref="moreButtonRef"
          class="workspace-sidebar-row-action-button more-button"
          :aria-label="workspaceMessage('workspace.sidebar.fileTree.moreOptions')"
          draggable="false"
          @click.stop="toggleMoreMenu"
          @mousedown.stop.prevent
          @dragstart.stop.prevent
        >
          <MoreIcon direction="horizontal" />
        </button>
      </span>

      <!-- More 下拉菜单：定位与过渡动画对齐 ProjectListView -->
      <Teleport to="body">
        <transition name="workspace-tree-item-menu-fade">
          <div
            v-if="isMoreMenuOpen"
            ref="dropdownRef"
            class="tree-item-menu-wrapper"
            :style="dropdownStyle"
          >
            <CustomSelect
              :model-value="null"
              :options="moreMenuOptions"
              :manual-mode="true"
              :parent-is-open="isMoreMenuOpen"
              semantic-role="menu"
              variant="minimal"
              :bordered="false"
              :external-trigger-ref="moreButtonRef"
              @update:model-value="handleMoreMenuSelect"
              @close="closeMoreMenu"
            />
          </div>
        </transition>
      </Teleport>

    </div>
  </div>
  <!-- Recursive rendering of children -->
  <div 
    v-if="node.type === 'folder' && node.isExpanded" 
    class="children-container"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <TreeItem 
      v-for="childNode in node.children" 
      :key="childNode.id"
      :node="childNode" 
      @item-click="(payload) => $emit('item-click', payload)"
    />
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, nextTick, watch, inject } from 'vue';
// import TreeItem from './TreeItem.vue'; 
import { useWorkspaceTreeStore, useWorkspaceSelectionStore } from '../../../store/index.js';
import { useNotificationStore } from '@/app/notification';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { FolderIcon } from '@linnya/renderer-ui/icons';
import { ImageIcon } from '@linnya/renderer-ui/icons';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import { UnsupportedDocumentIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect } from '@linnya/renderer-ui';
import { useTreeItemDragDrop } from '../composables/useTreeItemDragDrop.js';
import { getNodeMenuOptions } from '../composables/useContextMenu.js';
import { useFixedDropdownPosition } from '../composables/useFixedDropdownPosition';
import { useDocumentTypeAvailabilityByNodeType } from '@/app/plugins/composables';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';
import { resolveWorkspaceNodeDisplayName } from '../../../functions/resolveWorkspaceNodeDisplayName';

// ++ 新增：定义 emit ++
const emit = defineEmits(['item-click']);

// Define the props expected by this component
const props = defineProps({
  node: {
    type: Object, // Should match the TreeNode structure
    required: true,
  },
  // --- 移除 handleItemClick prop ---
});

// Get Store instance
const treeStore = useWorkspaceTreeStore();
const selectionStore = useWorkspaceSelectionStore();
const notificationStore = useNotificationStore();
const { workspaceMessage } = useWorkspaceLocalization();

// +++ 从父组件获取显示上下文菜单的方法 +++
const showContextMenu = inject('showContextMenu', null);
// 中文说明：More 菜单 action 分发统一由 app 侧边栏组合面提供（与右键菜单共用同一套逻辑）
const workspaceHandleMenuSelect = inject('workspaceHandleMenuSelect', null);

// --- State for Renaming --- 
const isRenaming = ref(false);
const renameValue = ref('');
const renameInputRef = ref(null);
const isSubmittingRename = ref(false);
const isConfirmingRename = ref(false); // 新增：防止重复调用 confirmRename

// hover 状态：用于控制右侧 More 按钮显示
const isHovered = ref(false);

// More 下拉菜单（与 ProjectListView 一致：按钮锚点定位 + Teleport + file-tree 专属过渡）
const isMoreMenuOpen = ref(false);
const moreButtonRef = ref(null);
const {
    dropdownRef,
    dropdownStyle,
    positionDropdownAfterRender,
} = useFixedDropdownPosition();

// 菜单选项：与右键菜单共用同一数据源，避免两套定义分叉
const moreMenuOptions = computed(() => {
  return getNodeMenuOptions(props.node, { surface: 'more' });
});

const nodeDisplayName = computed(() => (
  resolveWorkspaceNodeDisplayName(props.node, workspaceMessage('workspace.sidebar.node.fallbackName'))
));

const documentTypeAvailability = useDocumentTypeAvailabilityByNodeType(
  computed(() => String(props.node.type)),
);
const displayDocumentType = computed(() => {
  const availability = documentTypeAvailability.value;
  if (availability.state === 'enabled') return availability.documentType;
  // 中文说明：插件已安装但停用时，文件仍属于该插件的文档类型；
  // 图标展示继续使用插件贡献的文件类型图标，打开动作再提示“插件已停用”。
  if (availability.state === 'disabled' && availability.documentType) return availability.documentType;
  return null;
});
const isKnownNonDocumentNode = computed(() => (
  props.node.type === 'folder'
    || props.node.type === 'asset_image'
    || props.node.type === 'asset_file'
));
const isUnsupportedDocumentNode = computed(() => (
  (documentTypeAvailability.value.state === 'disabled' && !documentTypeAvailability.value.documentType)
    || documentTypeAvailability.value.state === 'missing'
    || documentTypeAvailability.value.state === 'load-failed'
    || (documentTypeAvailability.value.state === 'unknown' && !isKnownNonDocumentNode.value)
));
const nodeIconComponent = computed(() => {
  if (props.node.type === 'folder') return FolderIcon;
  if (props.node.type === 'asset_image') return ImageIcon;
  if (isUnsupportedDocumentNode.value) return UnsupportedDocumentIcon;
  return displayDocumentType.value?.iconComponent ?? DocumentIcon;
});
const nodeIconClass = computed(() => {
  if (props.node.type === 'folder') return 'folder-icon';
  if (isUnsupportedDocumentNode.value) return 'unsupported-document-icon';
  return displayDocumentType.value?.iconClass ?? 'file-icon';
});

// 中文说明：
// - TreeItem 不应维护第二套菜单逻辑（否则 More 菜单与右键菜单容易出现行为分叉）
// - 这里仅负责 UI 展示，具体 action 由 app 侧边栏组合面的 useContextMenu 统一处理

// 显示错误通知
const showError = (message) => {
  notificationStore.show(message, 'error');
};

// --- 拖放逻辑（使用 Composable） ---
const {
  isDragging,
  isDragOver,
  handleDragStart,
  handleDragEnd,
  handleDragOver,
  handleDragLeave,
  handleDrop,
} = useTreeItemDragDrop({ node: props.node, isRenaming }, showError);

// Logic for expansion
const toggleExpansion = () => {
  if (props.node.type === 'folder') {
    treeStore.toggleExpand(props.node.id);
  }
};

// 聚焦到重命名输入框
const focusRenameInput = () => {
  if (!renameInputRef.value) {
    console.warn("[TreeItem] 重命名输入引用不存在");
    return;
  }
  
  try {
    renameInputRef.value.focus();
  } catch (e) {
    console.error("[TreeItem] 聚焦输入框时出错:", e);
  }
};

// Add computed property for active/selected state check
const isActiveFile = computed(() => {
  if (!selectionStore.selectedNodeIds.has(props.node.id)) return false;
  if (documentTypeAvailability.value.state === 'unknown' && !isKnownNonDocumentNode.value) {
    return false;
  }
  return documentTypeAvailability.value.state !== 'disabled'
    && documentTypeAvailability.value.state !== 'missing';
});

// 新增：计算当前节点是否为「新建」节点，用于在文件名右侧显示 New 标签
const isNewNode = computed(() => {
  // 文件夹不显示 New 标签
  if (props.node.type === 'folder') {
    return false;
  }
  // workspace 树 Store 提供的 isNodeNew 方法
  if (typeof treeStore.isNodeNew === 'function') {
    return treeStore.isNodeNew(props.node.id);
  }
  return false;
});

// Main click handler
const handleItemClick = (event) => { // Accept the full event object
    // Prevent click action when renaming
    if (isRenaming.value) return;

    // 如果是新建文件，首次点击时清除 New 标记
    if (isNewNode.value && props.node.type !== 'folder') {
      if (typeof treeStore.clearNodeNewFlag === 'function') {
        treeStore.clearNodeNewFlag(props.node.id);
      }
    }

    // Emit the node and the original event
    emit('item-click', { node: props.node, event });
};

// +++ Add context menu handler +++
const handleContextMenu = (event) => {
    // Prevent default browser context menu
    event.preventDefault(); 
    console.log(`[TreeItem] Custom context menu requested for: ${props.node.name}`);
    if (showContextMenu) {
        showContextMenu(event, props.node);
    } else {
        console.error('[TreeItem] showContextMenu function is not provided.');
        // Fallback or error message
        showError(workspaceMessage('workspace.sidebar.node.actionUnsupported'));
    }
};

/**
 * More 按钮点击：打开“锚点下拉菜单”（位置/动画与 ProjectListView 一致）
 */
const toggleMoreMenu = (event) => {
    // 避免触发 TreeItem 的单击选择/展开逻辑
    event.stopPropagation();
    // 避免按钮默认行为影响焦点/拖拽
    event.preventDefault();

    isMoreMenuOpen.value = !isMoreMenuOpen.value;
    if (isMoreMenuOpen.value) {
        void positionDropdownAfterRender(moreButtonRef.value);
    }
};

const closeMoreMenu = () => {
    isMoreMenuOpen.value = false;
};

/**
 * 选择 More 菜单项：复用右键菜单的 action 处理逻辑
 */
const handleMoreMenuSelect = async (value) => {
    if (!value) return;
    if (typeof workspaceHandleMenuSelect === 'function') {
        await workspaceHandleMenuSelect({ action: value, item: props.node });
    } else {
        console.error('[TreeItem] workspaceHandleMenuSelect 未注入，无法执行菜单动作', { action: value });
    }
    closeMoreMenu();
};

/**
 * 点击外部关闭菜单
 */
const handleClickOutsideForMoreMenu = (event) => {
    if (!isMoreMenuOpen.value) return;

    const buttonEl = moreButtonRef.value;
    const menuEl = dropdownRef.value;

    if (buttonEl && buttonEl.contains(event.target)) return;
    if (menuEl && menuEl.contains(event.target)) return;

    closeMoreMenu();
};

// --- Renaming Logic --- 
const startRename = () => {
    if (!props.node) return;
    
    isRenaming.value = true;
    renameValue.value = props.node.name;
    
    nextTick(() => {
        // 使用 setTimeout 确保 DOM 已更新
        window.setTimeout(() => {
            focusRenameInput();
            // 全选文本以便用户可以直接替换
            if (renameInputRef.value && typeof renameInputRef.value.select === 'function') {
                renameInputRef.value.select();
            }
        }, 50);
    });
};

// 新增：单独处理 Enter 和 Blur 事件，避免重复调用
const onEnterKey = () => {
    if (!isConfirmingRename.value) {
        confirmRename();
    }
};

const onInputBlur = () => {
    // 失焦时确认重命名（如果没有正在进行确认操作）
    if (!isConfirmingRename.value) {
        confirmRename();
    }
};

const confirmRename = async () => {
    if (isConfirmingRename.value || isSubmittingRename.value) {
        return;
    }
    
    // 立即设置标志防止重复调用
    isConfirmingRename.value = true;

    const oldName = props.node.name;
    let newName = renameValue.value.trim();

    // 判断名称是否未改变
    if (newName === "" || newName === oldName) {
        cancelRename();
        return;
    }

    // 清理名称，移除路径分隔符
    newName = newName.replace(/[\\/]/g, '');
    if (newName === "") {
        showError(workspaceMessage('workspace.sidebar.node.renameEmpty'));
        isConfirmingRename.value = false;
        return;
    }
    
    console.log(`[TreeItem] Renaming: ${oldName} → ${newName}`);
    isSubmittingRename.value = true;

    try {
        await treeStore.renameNode(props.node.id, newName);

        // API 调用成功后直接退出重命名状态
        isRenaming.value = false; 
    } catch (error) {
        console.error(`[TreeItem] 重命名失败:`, error);
        
        // 显示错误通知
        showError(workspaceMessage('workspace.sidebar.node.renameFailed'));
        
        // 重置确认标志，允许下次尝试
        isConfirmingRename.value = false;
        return; // 出错后直接返回，不继续执行
    } finally {
        isSubmittingRename.value = false;
        // 只有在成功时才重置此标志，错误情况已在上面处理
        if (!isRenaming.value) {
            isConfirmingRename.value = false;
        }
    }
};

const cancelRename = () => {
    isRenaming.value = false;
    renameValue.value = '';
    isSubmittingRename.value = false;
    isConfirmingRename.value = false;
    treeStore.setRenameRequestNodeId(null); // Also clear store state
};

// --- Watcher for rename requests from store --- 
watch(() => treeStore.renameRequestNodeId, (newId) => {
    if (newId === props.node.id) {
        startRename();
    }
});

// --- Lifecycle Hooks for Rename Listener ---
onMounted(() => {
    // 使用捕获阶段，优先于 TreeItem 的 click 触发关闭逻辑，体验更贴近 ProjectListView
    document.addEventListener('click', handleClickOutsideForMoreMenu, true);
});

onUnmounted(() => {
    document.removeEventListener('click', handleClickOutsideForMoreMenu, true);
});
</script>
