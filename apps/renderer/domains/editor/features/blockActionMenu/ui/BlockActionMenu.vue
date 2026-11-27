<!-- apps/renderer/shared/menus/blockActionMenu/ui/BlockActionMenu.vue -->
<!--
  块操作菜单组件
  
  功能：
  - 使用 CustomSelect 组件显示菜单
  - 定位在 drag-handle 旁边
  - 支持分隔符和禁用状态
-->

<template>
  <Teleport to="body">
    <Transition name="block-action-menu-fade">
      <div
        v-if="isOpen"
        ref="menuWrapperRef"
        class="block-action-menu-wrapper"
        :style="menuPosition"
        @click.stop
        @contextmenu.prevent.stop
      >
        <CustomSelect
          :model-value="null"
          :options="selectOptions"
          :manual-mode="true"
          :parent-is-open="isOpen"
          :external-trigger-ref="anchorElement"
          semantic-role="menu"
          :class-names="selectClassNames"
          variant="default"
          min-width="180px"
          @update:model-value="handleSelect"
          @close="handleClose"
        >
          <template #color-picker="{ option }">
            <BlockColorPicker
              :current-background-color="option.currentBackgroundColor"
              :current-text-color="option.currentTextColor"
              :has-text-color="option.hasTextColor"
              :is-atomic="option.isAtomic"
              @select-background="handleColorPickerBackgroundSelect"
              @select-text="handleColorPickerTextSelect"
              @clear="handleColorPickerClear"
              @cancel="handleClose"
            />
          </template>
        </CustomSelect>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { blockActionMenuService } from '../service';
import { CustomSelect, useAnchoredPosition } from '@linnya/renderer-ui';
import BlockColorPicker from './BlockColorPicker.vue';
import { PositionUtils } from '../../../extensions/position/PositionUtils';

// 菜单包裹元素引用
const menuWrapperRef = ref(null);


// 从服务获取状态
const isOpen = computed(() => blockActionMenuService.state.isOpen);
const items = computed(() => blockActionMenuService.state.items);
const anchorElement = computed(() => blockActionMenuService.state.anchorElement);
// 图片块只需要识别属于本 feature 的 Teleport 子菜单，不能依赖 Renderer UI 内部 DOM class。
const selectClassNames = Object.freeze({ submenu: 'block-action-menu-submenu' });

/**
 * 递归转换 MenuItem 为 CustomSelect 格式
 */
const convertMenuItem = (item) => {
  if (item.type === 'separator') {
    return { isSeparator: true };
  }
  
  if (item.type === 'group') {
    return { isGroup: true, label: item.label };
  }
  
  const converted = {
    value: item.id,
    text: item.label,
    disabled: item.disabled,
    shortcut: item.shortcut,
    isPanel: item.isPanel,
    variant: item.variant,
    iconComponent: item.iconComponent,
    iconClassName: item.iconClassName,
    rightIconComponent: item.rightIconComponent,
    selected: item.selected,
    className: item.className,
  };
  
  // 特殊处理：颜色选择器
  if (item.isColorPicker) {
    converted.isColorPicker = true;
    converted.currentBackgroundColor = item.currentBackgroundColor;
    converted.currentTextColor = item.currentTextColor;
    converted.isAtomic = item.isAtomic;
    converted.hasTextColor = item.hasTextColor;
    // 使用一个占位子元素来触发子菜单
    converted.children = [{ placeholder: true }];
  }
  // 递归转换子菜单项
  else if (item.children && item.children.length > 0) {
    // 如果是面板模式，直接传递 children，不进行转换
    if (item.isPanel) {
      converted.children = item.children;
    } else {
      converted.children = item.children.map(child => convertMenuItem(child));
    }
  }
  
  return converted;
};

/**
 * 将 MenuItem 转换为 CustomSelect 需要的格式
 */
const selectOptions = computed(() => {
  return items.value.map(item => convertMenuItem(item));
});

// 菜单在拖拽柄左侧、顶部对齐；左侧放不下翻到右侧，下方放不下改为底部对齐。
const anchored = useAnchoredPosition({
  anchor: anchorElement,
  floating: menuWrapperRef,
  open: isOpen,
  placement: { side: 'left', align: 'start', gap: 6 },
});
const menuPosition = computed(() => ({ ...anchored.style.value, zIndex: 9999 }));

/**
 * 处理选项选择
 */
const handleSelect = (value) => {
  if (value) {
    blockActionMenuService.executeAction(value);
  }
};

/**
 * 处理关闭
 */
const handleClose = () => {
  blockActionMenuService.close();
};

// 在菜单打开时，监听键盘事件
const handleKeyDown = (event) => {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    blockActionMenuService.close();
  }
};

// 使用 MutationObserver 监听 DOM 变化（当 block 被删除时自动关闭菜单）
let domObserver = null;

const startDomCheck = () => {
  stopDomCheck();
  
  if (!anchorElement.value) return;
  
  // 创建 MutationObserver 监听 DOM 子节点的删除
  domObserver = new MutationObserver((mutations) => {
    // 检查 anchorElement 是否还在 document 中
    if (anchorElement.value && !document.contains(anchorElement.value)) {
      // block 已经被删除，关闭菜单
      blockActionMenuService.close();
    }
  });
  
  // 监听 document.body 的子树变化
  // 只关注子节点的增删，不关注属性和文本变化
  domObserver.observe(document.body, {
    childList: true,    // 监听子节点的增删
    subtree: true,      // 监听所有后代节点
    attributes: false,  // 不监听属性变化
    characterData: false // 不监听文本内容变化
  });
};

const stopDomCheck = () => {
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }
};

// 监听打开状态，计算位置并启动 DOM 检查
watch(isOpen, (newValue) => {
  if (newValue) {
    startDomCheck(); // 开始检查 DOM
    document.addEventListener('keydown', handleKeyDown, true); // 添加键盘监听
  } else {
    stopDomCheck(); // 停止检查 DOM
    document.removeEventListener('keydown', handleKeyDown, true); // 移除键盘监听
  }
});

// 辅助函数：获取最新的块位置
const getLatestBlockPos = (context) => {
  if (!context || !context.editor || !context.rootBlockNode) return context?.rootBlockPos;
  const blockId = context.rootBlockNode.attrs.id;
  if (!blockId) return context.rootBlockPos;
  
  const posUtils = new PositionUtils(context.editor);
  const rootBlockInfo = posUtils.findRootBlockById(blockId);
  return rootBlockInfo ? rootBlockInfo.pos : context.rootBlockPos;
};

// 处理背景色选择
const handleColorPickerBackgroundSelect = (colorValue) => {
  const context = blockActionMenuService.state.context;
  if (context && context.editor) {
    const pos = getLatestBlockPos(context);
    context.editor.commands.setBlockColor(pos, 'background', colorValue);
  }
};

// 处理文字色选择
const handleColorPickerTextSelect = (colorValue) => {
  const context = blockActionMenuService.state.context;
  if (context && context.editor) {
    const pos = getLatestBlockPos(context);
    context.editor.commands.setBlockColor(pos, 'text', colorValue);
  }
};

// 处理清除颜色：清除当前块上的所有颜色相关样式
// - 块背景色（backgroundColor）
// - 块文字色（textColor 属性 + 覆盖整块的 textColor mark）
// - 行内文字色（textColor mark）
// - 行内高亮（textHighlight mark）
const handleColorPickerClear = () => {
  const context = blockActionMenuService.state.context;
  if (context && context.editor) {
    const { editor } = context;
    const pos = getLatestBlockPos(context);
    
    // 获取最新的 node
    let latestNode = context.rootBlockNode;
    if (context.rootBlockNode?.attrs?.id) {
      const posUtils = new PositionUtils(editor);
      const rootBlockInfo = posUtils.findRootBlockById(context.rootBlockNode.attrs.id);
      if (rootBlockInfo) {
        latestNode = rootBlockInfo.node;
      }
    }

    // 1) 清除块背景色和块文字色（内部已处理 textColor mark）
    editor.commands.setBlockColor(pos, 'background', null);
    editor.commands.setBlockColor(pos, 'text', null);

    // 2) 额外清除整块范围内的 textHighlight 行内 mark
    try {
      const { state, view } = editor;
      const textHighlightMarkType = state.schema.marks.textHighlight;
      if (textHighlightMarkType && latestNode) {
        const blockStart = pos + 1; // rootBlock 内容起始
        const blockEnd = pos + latestNode.nodeSize - 1; // 内容结束
        const tr = state.tr.removeMark(blockStart, blockEnd, textHighlightMarkType);
        if (tr.docChanged) {
          view.dispatch(tr);
        }
      }
    } catch (error) {
      console.error('[BlockActionMenu] 清除高亮 mark 时出错:', error);
    }
  }
  // 不再关闭菜单
  // blockActionMenuService.close();
};

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeyDown, true); // 确保移除监听
  stopDomCheck(); // 清理定时器
});
</script>
