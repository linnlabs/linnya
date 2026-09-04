// src/renderer/components/MenuBar.vue

<template>
  <div class="editor-menu-bar" v-if="editor">
    <div class="editor-menu-bar-inner">
      <!-- Group 2: Text Formatting -->
      <div class="heading-menu-container">
        <button 
          ref="headingMenuRef"
          @click="toggleHeadingDropdown" 
          :class="{ 'is-active': isAnyHeadingActive || showHeadingDropdown }" 
          :disabled="isInTable"
          :title="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.headingLevel')">
          <template v-if="currentHeadingLevel">
            <span class="heading-level-text">H{{ currentHeadingLevel }}</span>
          </template>
          <template v-else>
            <HeadingIcon />
          </template>
        </button>
        <Teleport to="body">
          <transition name="menu-fade">
            <div 
              v-show="showHeadingDropdown" 
              ref="headingSelectWrapperRef"
              class="heading-select-wrapper">
              <CustomSelect
                :model-value="currentHeadingLevel"
                :options="headingMenuOptions"
                :manual-mode="true"
                variant="minimal"
                :bordered="false"
                :class-names="{ optionLabel: 'editor-heading-option-label' }"
                :external-trigger-ref="headingMenuRef"
                @update:model-value="handleHeadingMenuSelection"
                @close="() => showHeadingDropdown = false"
              />
            </div>
          </transition>
        </Teleport>
      </div>
      <button @click="editor.chain().focus().toggleBold().run()" 
              :class="{ 'is-active': editor.isActive('bold') }"
              :title="editorMessage('editor.menu.bold')">
        <BoldIcon />
      </button>
      <button @click="editor.chain().focus().toggleItalic().run()" 
              :class="{ 'is-active': editor.isActive('italic') }"
              :title="editorMessage('editor.menu.italic')">
        <ItalicIcon />
      </button>
      
      <span class="divider"></span>

      <!-- Group 3: Block Formatting -->
      <button @click="toggleListItem('bullet')" 
              :class="{ 'is-active': editor.isActive('listItemBlock', { listType: 'bullet' }) }"
              :disabled="isInTable"
              :title="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.bulletList')">
        <ListItemIcon />
      </button>
      <button @click="toggleListItem('ordered')" 
              :class="{ 'is-active': editor.isActive('listItemBlock', { listType: 'ordered' }) }"
              :disabled="isInTable"
              :title="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.orderedList')">
        <!-- 这里不额外引入新 icon：用 “1.” 作为最直观的视觉提示 -->
        <span class="ordered-list-label">1.</span>
      </button>
      <button @click="toggleQuoteBlock()" 
              :class="{ 'is-active': editor.isActive('quoteBlock') }"
              :disabled="isInTable"
              :title="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.quoteBlock')">
        <QuoteIcon />
      </button>
      
      <span class="divider"></span>

      <!-- Group 4: Insertions -->
      <button @click="insertImage" :title="editorMessage('editor.menu.insertImage')">
        <ImageIcon />
      </button>
      <div class="table-button-container">
        <button 
          ref="tableButtonRef" 
          @click="toggleTableSizeSelector" 
          :disabled="isInTable"
          :title="isInTable ? editorMessage('editor.common.unavailableInTable') : editorMessage('editor.menu.insertTable')">
          <TableIcon />
        </button>
        <Teleport to="body">
          <transition name="table-selector-fade">
            <div 
              v-if="showTableSizeSelector" 
              ref="tableSizeSelectorWrapperRef"
              class="table-size-selector-wrapper">
              <TableSizeSelector
                @confirm="handleTableSizeConfirm"
                @cancel="closeTableSizeSelector"
              />
            </div>
          </transition>
        </Teleport>
      </div>
      <span class="divider" v-if="isDevelopment"></span>

      <!-- Group 5: Dev Tools -->
      <!-- 开发环境下：打开调试面板 -->
      <button
        v-if="isDevelopment"
        @click="uiStore.toggleDebugPanel()"
        :title="editorMessage('editor.menu.debug')"
      >
        <WrenchIcon />
      </button>

      <!-- 开发环境下：查看最近一次 Provider outbound attempt -->
      <button
        v-if="isDevelopment"
        @click="showProviderOutboundDebugPanel = true"
        :title="editorMessage('editor.menu.viewLatestProviderOutboundAttempt')"
      >
        <span class="llm-debug-label">AI</span>
      </button>
    </div>
    <ProviderOutboundDebugPanel
      v-if="isDevelopment"
      :visible="showProviderOutboundDebugPanel"
      @close="showProviderOutboundDebugPanel = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import * as ConversionCommands from '../extensions/core/commands/ConversionCommands';
import { isInsideTable } from '../extensions/core/commands/ConversionCommands';
import { useUIStore } from '../../../shared/stores/ui'; // 导入UI Store
import { useNotificationStore } from '@/app/notification'; // 导入 Notification Store
import { ImageIcon } from '@linnya/renderer-ui/icons';
import { TableIcon } from '@linnya/renderer-ui/icons';
import { ListItemIcon } from '@linnya/renderer-ui/icons';
import { QuoteIcon } from '@linnya/renderer-ui/icons';
import { BoldIcon } from '@linnya/renderer-ui/icons';
import { ItalicIcon } from '@linnya/renderer-ui/icons';
import { HeadingIcon } from '@linnya/renderer-ui/icons';
import { WrenchIcon } from '@linnya/renderer-ui/icons';
import { ProviderOutboundDebugPanel } from '../features/ProviderOutboundDebug';
import { CustomSelect } from '@linnya/renderer-ui';
import TableSizeSelector from '../blocks/TableBlock/ui/TableSizeSelector.vue';
import { useEditorLocalization } from './useEditorLocalization';
import { pickEmbedAndInsertImage } from '../blocks/ImageBlock/orchestration/embedAndInsertImage';

// ++ 使用UI Store ++
const uiStore = useUIStore();
const notificationStore = useNotificationStore(); // 获取 Store 实例
const { editorMessage } = useEditorLocalization();

// ++ 从 uiStore 获取编辑器实例 ++
const editor = computed(() => uiStore.getEditor());

// 定义事件
const emit = defineEmits(['toggle-debug-panel']);

// 开发环境标志
const isDevelopment = import.meta.env.DEV;

// 标题级别菜单选项配置
const NBSP = '\u00A0';
const headingMenuOptions = computed(() => [
  { value: 1, text: `H1${NBSP}${NBSP}${NBSP}${editorMessage('editor.menu.heading.level1')}` },
  { value: 2, text: `H2${NBSP}${NBSP}${NBSP}${editorMessage('editor.menu.heading.level2')}` },
  { value: 3, text: `H3${NBSP}${NBSP}${NBSP}${editorMessage('editor.menu.heading.level3')}` },
  { value: 4, text: `H4${NBSP}${NBSP}${NBSP}${editorMessage('editor.menu.heading.level4')}` },
  { value: 5, text: `H5${NBSP}${NBSP}${NBSP}${editorMessage('editor.menu.heading.level5')}` },
  { value: 6, text: `H6${NBSP}${NBSP}${NBSP}${editorMessage('editor.menu.heading.level6')}` }
]);

// CustomSelect 相关状态
const showHeadingDropdown = ref(false);

// 表格尺寸选择器状态
const showTableSizeSelector = ref(false);

// 按钮和包装器引用
const headingMenuRef = ref(null);
const headingSelectWrapperRef = ref(null);
const tableButtonRef = ref(null);
const tableSizeSelectorWrapperRef = ref(null);

// 当前选中的标题级别（用于 CustomSelect）
const currentHeadingLevel = computed(() => {
  if (!editor.value) return null;
  for (let level = 1; level <= 6; level++) {
    if (editor.value.isActive('headingBlock', { level })) {
      return level;
    }
  }
  return null;
});

// CustomSelect 组件已经处理了定位，不再需要 Floating UI

// Provider outbound 调试面板显示状态
const showProviderOutboundDebugPanel = ref(false);

// 切换标题级别 - 加入切换逻辑
const toggleHeading = (level) => {
  console.log('Checking imported ConversionCommands:', ConversionCommands); 

  if (editor.value) {
    // 检查必需的命令是否存在
    if (typeof ConversionCommands.convertToHeading !== 'function' || typeof ConversionCommands.setBaseBlock !== 'function') {
      console.error('[MenuBar] Error: convertToHeading or setBaseBlock command is missing!', ConversionCommands);
      notificationStore.show(editorMessage('editor.menu.error.headingUnavailable'), 'error', 3500);
      return; 
    }

    // ++ 检查当前块是否已经是目标级别的标题 ++
    if (editor.value.isActive('headingBlock', { level })) {
      // 如果是，则切换回普通块
      console.log(`[MenuBar] Toggling H${level} back to base block.`);
      ConversionCommands.setBaseBlock()({
        state: editor.value.state,
        dispatch: editor.value.view.dispatch
      });
    } else {
      // 如果不是，则转换为目标级别的标题
      console.log(`[MenuBar] Converting to H${level}.`);
      ConversionCommands.convertToHeading(level)({
      state: editor.value.state,
      dispatch: editor.value.view.dispatch
    });
    }
    
    // 重新聚焦编辑器
    editor.value.commands.focus();
  }
  // +++ 新增：关闭下拉菜单 +++
  showHeadingDropdown.value = false;
};

// 新增：切换列表项类型
const toggleListItem = (listType) => {
  if (editor.value) {
    // 检查当前是否已经是此类型的列表项
    if (editor.value.isActive('listItemBlock', { listType })) {
      // 已经是此类型的列表项，转换回普通块
      ConversionCommands.setBaseBlock()({
        state: editor.value.state,
        dispatch: editor.value.view.dispatch
      });
    } else {
      // 不是此类型的列表项，转换为此类型的列表项
      ConversionCommands.convertToListItem(listType)({
        state: editor.value.state,
        dispatch: editor.value.view.dispatch
      });
    }
    
    // 重新聚焦编辑器
    editor.value.commands.focus();
  }
};

// 新增：切换引用块
const toggleQuoteBlock = () => {
  if (editor.value) {
    // ++ 检查并调用正确的函数名 ++
    if (typeof ConversionCommands.convertToQuoteBlock !== 'function') { // <--- 检查 convertToQuoteBlock
      console.error('[MenuBar] Error: ConversionCommands.convertToQuoteBlock is not a function!', ConversionCommands);
      notificationStore.show(editorMessage('editor.menu.error.quoteUnavailable'), 'error', 3500);
      return;
    }
    ConversionCommands.convertToQuoteBlock()({ // <--- 调用 convertToQuoteBlock
      state: editor.value.state,
      dispatch: editor.value.view.dispatch
    });
    
    editor.value.commands.focus();
  }
};

// 辅助函数：收集需要保存的数据
const gatherSaveData = () => {
  console.log('[MenuBar] Attempting to gather save data...');
  if (!editor.value) {
    console.error('[MenuBar] Cannot gather save data: Editor not available.');
    return null;
  }
  console.log('[MenuBar] Editor instance is available.');

  try {
    const editorContent = editor.value.getJSON();
    console.log('[MenuBar] Got editor content (JSON).');
    const result = { version: 1, editorContent };
    console.log('[MenuBar] Successfully gathered save data:', result);
    return result;
  } catch (error) {
    console.error('[MenuBar] Error gathering save data:', error);
    return null;
  }
};

// 数据库架构下，文档自动保存到数据库，不需要旧的文件操作逻辑

const toggleHeadingDropdown = () => {
  // 如果文件菜单是打开的，先关闭它
  if (uiStore.isFileDropdownOpen) {
    uiStore.setFileDropdownOpen(false);
  }
  showHeadingDropdown.value = !showHeadingDropdown.value;
};

// CustomSelect 组件已经处理了标题和表格尺寸选择器的点击外部关闭逻辑

// 定位逻辑（用于标题下拉菜单和表格尺寸选择器）
const positionDropdown = (triggerElement, wrapperElement) => {
  if (!triggerElement || !wrapperElement) return;
  
  const triggerRect = triggerElement.getBoundingClientRect();
  const wrapperRect = wrapperElement.getBoundingClientRect();
  
  // 计算位置
  let top = triggerRect.bottom + 4; // 距离按钮底部 4px
  let left = triggerRect.left;
  
  // 检查右边界
  if (left + wrapperRect.width > window.innerWidth) {
    left = triggerRect.right - wrapperRect.width;
  }
  
  // 检查底边界
  if (top + wrapperRect.height > window.innerHeight) {
    top = triggerRect.top - wrapperRect.height - 4;
  }
  
  // 应用位置
  wrapperElement.style.left = `${left}px`;
  wrapperElement.style.top = `${top}px`;
};

// 监听标题下拉菜单显示状态
watch(showHeadingDropdown, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      positionDropdown(headingMenuRef.value, headingSelectWrapperRef.value);
    });
  }
});

// 监听表格尺寸选择器显示状态
watch(showTableSizeSelector, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      positionDropdown(tableButtonRef.value, tableSizeSelectorWrapperRef.value);
    });
  }
});

// +++ 新增：计算标题按钮是否激活（任意一级标题激活即可） +++
const isAnyHeadingActive = computed(() => {
  if (!editor.value) return false;
  return editor.value.isActive('headingBlock'); // 直接检查 headingBlock 类型是否激活
  // 或者更精确地检查 1-6 级：
  // return [1, 2, 3, 4, 5, 6].some(level => editor.value.isActive('headingBlock', { level }));
});

// +++ 新增：检测光标是否在表格内 +++
const isInTable = computed(() => {
  if (!editor.value || !editor.value.state) return false;
  return isInsideTable(editor.value.state);
});

// 切换表格尺寸选择器显示状态
const toggleTableSizeSelector = () => {
  // 如果其他下拉菜单是打开的，先关闭它们
  if (showHeadingDropdown.value) {
    showHeadingDropdown.value = false;
  }
  if (uiStore.isFileDropdownOpen) {
    uiStore.setFileDropdownOpen(false);
  }
  showTableSizeSelector.value = !showTableSizeSelector.value;
};

// 关闭表格尺寸选择器
const closeTableSizeSelector = () => {
  showTableSizeSelector.value = false;
};

// 处理表格尺寸确认
const handleTableSizeConfirm = ({ rows, cols, withHeaderRow }) => {
  if (editor.value) {
    editor.value.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
  }
  closeTableSizeSelector();
};

// +++ 修改：插入图片逻辑 +++
const insertImage = async () => {
  if (!editor.value) {
    notificationStore.show(editorMessage('editor.menu.toast.editorNotReady'), 'error');
    return;
  }

  await pickEmbedAndInsertImage({
    editor: editor.value,
    dialogTitle: editorMessage('editor.menu.imageDialog.title'),
    imageFilterName: editorMessage('editor.menu.imageDialog.filterName'),
    insertedMessageKey: 'editor.menu.toast.imageInserted',
    unavailableMessageKey: 'editor.menu.toast.imageDialogUnavailable',
    failedMessageKey: 'editor.menu.toast.imageFlowFailed',
  });
};

// 处理标题菜单选项选择
const handleHeadingMenuSelection = (level) => {
  if (level) {
    toggleHeading(level);
  }
};
</script>
