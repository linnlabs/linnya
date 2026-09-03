<!--
  BlockVersionHandle.vue
  
  块版本入口按钮
  
  职责：
  - 显示该块是否有历史版本
  - 点击后打开历史版本视图（Side-by-Side）
  - 显示版本号标签（可选）
  
  设计原则：
  - 仅在有历史版本时渲染
  - 与 DragHandle 风格保持一致
  - 支持 hover 显隐（由父容器控制）
-->

<template>
  <!-- 
    外层 div 容器 = 真正的「柄」容器（26x26 正方形），
    行为上与 .drag-handle / .annotation-handle 保持一致。
  -->
  <div
    class="block-version-handle"
    :title="tooltipText"
    :aria-label="tooltipText"
    role="button"
    tabindex="0"
    @click.stop="handleClick"
    @keydown.enter.stop.prevent="handleClick"
    @keydown.space.stop.prevent="handleClick"
  >
    <!-- 版本图标：使用全局 HistoryIcon，保持与系统其他历史操作图标一致 -->
    <span class="version-icon-wrapper">
      <HistoryIcon />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { HistoryIcon } from '@linnya/renderer-ui/icons';
import { useEditorLocalization } from '../useEditorLocalization';

// ==================== Props ====================

interface Props {
  /** 块 ID */
  blockId: string;
  /** 版本数量 */
  versionCount?: number;
  /** 最新版本号（用于 Tooltip 文案） */
  latestVersionNumber?: number;
}

const props = withDefaults(defineProps<Props>(), {
  versionCount: 0,
  latestVersionNumber: 0,
});
const { editorMessage } = useEditorLocalization();

// ==================== Emits ====================

const emit = defineEmits<{
  (e: 'click'): void;
}>();

// ==================== 计算属性 ====================

/** 工具提示文本 */
const tooltipText = computed(() => {
  if (props.versionCount <= 0) {
    return editorMessage('editor.blockVersionHandle.viewHistory');
  }
  
  if (props.versionCount === 1) {
    return editorMessage('editor.blockVersionHandle.singleVersion');
  }
  
  return editorMessage('editor.blockVersionHandle.multipleVersions', {
    count: props.versionCount,
    version: props.latestVersionNumber,
  });
});

// ==================== 事件处理 ====================

/** 点击版本按钮 */
const handleClick = () => {
  emit('click');
};
</script>
