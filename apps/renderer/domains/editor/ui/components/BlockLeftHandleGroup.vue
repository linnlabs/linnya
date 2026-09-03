<!--
  BlockLeftHandleGroup.vue
  
  块左侧控制岛容器
  
  职责：
  - 统一管理左侧的 Handle 按钮（拖拽、版本、未来的 AI/锁定等）
  - 始终水平排列：[版本] [拖拽]，版本在外侧、拖拽靠近内容
  - 与 root-block-outer:hover 联动显隐
  
  设计原则：
  - 左侧 = 块的「身份 + 操作」区（Identity + Control）
  - 拖拽：结构操作（靠近内容）
  - 版本：时间维度（在最外侧）
  - 未来：AI 标记、锁定标记等
-->

<template>
  <div
    ref="groupRef"
    class="block-left-handle-group"
    :class="{
      'has-version': hasHistory,
    }"
    contenteditable="false"
  >
    <!-- 版本按钮：在外侧，仅在有历史版本时渲染 -->
    <BlockVersionHandle
      v-if="hasHistory"
      :block-id="blockId"
      :version-count="versionCount"
      :latest-version-number="latestVersionNumber"
      @click="handleVersionClick"
    />

    <!-- 拖拽手柄：始终靠近内容（在内侧） -->
    <div
      ref="dragHandleEl"
      class="drag-handle"
      draggable="true"
      data-drag-handle="true"
      @mousedown="$emit('drag-mousedown', $event)"
      @mouseup="$emit('drag-mouseup', $event)"
      @dragstart="$emit('dragstart', $event)"
      @dragend="$emit('dragend', $event)"
      @contextmenu="$emit('contextmenu', $event)"
    >
      <slot name="drag-icon">
        <DragHandleIcon />
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { DragHandleIcon } from '@linnya/renderer-ui/icons';
import BlockVersionHandle from './BlockVersionHandle.vue';

// ==================== Props ====================

interface Props {
  /** 块 ID */
  blockId: string;
  /** 是否有历史版本 */
  hasHistory: boolean;
  /** 版本数量 */
  versionCount?: number;
  /** 最新版本号 */
  latestVersionNumber?: number;
}

const props = withDefaults(defineProps<Props>(), {
  versionCount: 0,
  latestVersionNumber: 0,
});

// ==================== Emits ====================

const emit = defineEmits<{
  (e: 'drag-mousedown', event: MouseEvent): void;
  (e: 'drag-mouseup', event: MouseEvent): void;
  (e: 'dragstart', event: DragEvent): void;
  (e: 'dragend', event: DragEvent): void;
  (e: 'contextmenu', event: MouseEvent): void;
  (e: 'version-click'): void;
  (e: 'register-drag-handle', el: HTMLElement): void;
}>();

// ==================== Refs ====================

const groupRef = ref<HTMLElement | null>(null);
const dragHandleEl = ref<HTMLElement | null>(null);

// ==================== 事件处理 ====================

/**
 * 版本按钮点击
 */
const handleVersionClick = () => {
  emit('version-click');
};

// ==================== 生命周期 ====================

onMounted(() => {
  // 将内部拖拽手柄 DOM 元素注册给外层 BlockView，
  // 以便块菜单服务使用正确的 anchorElement（HTMLElement）
  if (dragHandleEl.value) {
    emit('register-drag-handle', dragHandleEl.value);
  }
});

</script>
