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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { blockActionMenuService } from '../service';
import { CustomSelect } from '@linnya/renderer-ui';
import BlockColorPicker from './BlockColorPicker.vue';
import { PositionUtils } from '../../../extensions/position/PositionUtils';

// 菜单包裹元素引用
const menuWrapperRef = ref(null);

// 菜单位置
const menuPosition = ref({
  position: 'fixed',
  top: '0px',
  left: '0px',
  zIndex: 9999,
});

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

/**
 * 计算菜单位置
 */
const calculateMenuPosition = () => {
  if (!anchorElement.value) {
    return;
  }
  
  const rect = anchorElement.value.getBoundingClientRect();
  
  // 视口尺寸
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // 获取实际菜单尺寸（如果已渲染）
  let menuWidth = 180; // 默认宽度
  let menuHeight = 280; // 默认高度（用于首次渲染）
  
  if (menuWrapperRef.value) {
    const menuRect = menuWrapperRef.value.getBoundingClientRect();
    if (menuRect.height > 0) {
      menuHeight = menuRect.height;
    }
    if (menuRect.width > 0) {
      menuWidth = menuRect.width;
    }
  }
  
  // 计算垂直位置：优先显示在 drag-handle 顶部对齐
  let finalTop = rect.top;
  const spaceBelow = viewportHeight - rect.top;
  const spaceAbove = rect.bottom;
  
  // 如果下方空间不够，尝试显示在上方
  if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
    // 上方空间更多，显示在 drag-handle 上方，菜单底部对齐 drag-handle 底部
    finalTop = rect.bottom - menuHeight;
    // 确保不超出视口顶部
    if (finalTop < 8) {
      finalTop = 8;
    }
  } else {
    // 下方空间足够，或上方空间也不够时，正常显示在下方
    // 即使超出视口底部也允许（用户可以滚动）
    finalTop = rect.top;
  }
  
  // 计算水平位置：优先在左侧显示，菜单右边缘紧贴 drag-handle 左边缘
  const leftPosition = rect.left - menuWidth - 6; // 左侧，菜单在 drag-handle 左边
  const rightPosition = rect.right + 6; // 右侧紧贴，保持 6px 间距
  
  let finalLeft;
  
  // 如果左侧空间足够，显示在左侧
  if (leftPosition >= 8) {
    finalLeft = leftPosition;
  } 
  // 左侧空间不够，显示在右侧
  else if (rightPosition + menuWidth <= viewportWidth - 8) {
    finalLeft = rightPosition;
  }
  // 两侧都不够，优先左侧，但确保不超出边界
  else {
    finalLeft = Math.max(8, Math.min(leftPosition, viewportWidth - menuWidth - 8));
  }
  
  menuPosition.value = {
    position: 'fixed',
    top: `${finalTop}px`,
    left: `${finalLeft}px`,
    zIndex: 9999,
  };
};

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
watch(isOpen, async (newValue) => {
  if (newValue) {
    await nextTick();
    // 首次计算位置（使用默认尺寸）
    calculateMenuPosition();
    
    // 等待菜单完全渲染后，使用实际尺寸重新计算位置
    await nextTick();
    requestAnimationFrame(() => {
      calculateMenuPosition();
    });
    
    startDomCheck(); // 开始检查 DOM
    document.addEventListener('keydown', handleKeyDown, true); // 添加键盘监听
  } else {
    stopDomCheck(); // 停止检查 DOM
    document.removeEventListener('keydown', handleKeyDown, true); // 移除键盘监听
  }
});

// 监听 anchorElement 变化，重新计算位置（解决切换不同block的draghandle时位置不更新的问题）
watch(anchorElement, async (newValue) => {
  if (newValue && isOpen.value) {
    await nextTick();
    calculateMenuPosition();
    
    // 等待菜单完全渲染后，使用实际尺寸重新计算位置
    await nextTick();
    requestAnimationFrame(() => {
      calculateMenuPosition();
    });
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

// 监听窗口大小变化，重新计算位置
const handleResize = () => {
  if (isOpen.value) {
    calculateMenuPosition();
  }
};

onMounted(() => {
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  document.removeEventListener('keydown', handleKeyDown, true); // 确保移除监听
  stopDomCheck(); // 清理定时器
});
</script>
