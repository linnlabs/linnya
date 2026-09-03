<template>
  <div class="mindmap-toolbar">
    <!-- 左上布局方向切换 - 暂时隐藏，当前思维导图是简单页面，无需左右展开 -->
    <!-- <div class="mindmap-toolbar-group lt">
      <button
        type="button"
        title="根节点在右，分支向左展开"
        class="mindmap-toolbar-button"
        @click="handleInitLeft"
      >
        <SidebarIcon class="icon rotate-180" />
      </button>
      <button
        type="button"
        title="根节点在左，分支向右展开"
        class="mindmap-toolbar-button"
        @click="handleInitRight"
      >
        <SidebarIcon class="icon" />
      </button>
      <button
        type="button"
        title="根节点居中，左右两侧展开"
        class="mindmap-toolbar-button"
        @click="handleInitSide"
      >
        <AlignIcon class="icon" alignment="center" />
      </button>
    </div> -->

    <!-- 工具栏：缩放 / 居中 / 全屏 -->
    <!-- 移动到左上角，竖向排列 -->
    <div class="mindmap-toolbar-group vertical-left-top">
      <button
        type="button"
        title="拖拽移动视图"
        class="mindmap-toolbar-button"
        :class="{ 'is-active': isMoveMode }"
        @click="handleToggleMoveMode"
      >
        <MoveIcon class="icon" />
      </button>

      <button
        type="button"
        :title="isFullscreen ? '退出全屏' : '全屏显示'"
        class="mindmap-toolbar-button"
        @click="handleToggleFullscreen"
      >
        <FullscreenIcon class="icon" />
      </button>

      <button
        type="button"
        title="回到中心主题"
        class="mindmap-toolbar-button"
        @click="handleToCenter"
      >
        <HomeIcon class="icon" />
      </button>

      <button
        type="button"
        title="放大"
        class="mindmap-toolbar-button"
        @click="handleZoomIn"
      >
        <ZoomInIcon class="icon" />
      </button>

      <button
        type="button"
        title="缩小"
        class="mindmap-toolbar-button"
        @click="handleZoomOut"
      >
        <ZoomOutIcon class="icon" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useMindMapStore } from '../../domain/store/mindmapStore';
import {
  AlignIcon,
  FullscreenIcon,
  HomeIcon,
  MoveIcon,
  SidebarIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@linnya/renderer-ui/icons';

const store = useMindMapStore();
const mind = computed(() => store.mind);
const { moveMode } = storeToRefs(store);

const isFullscreen = computed(() => {
  const el = mind.value?.el;
  if (!el) return false;
  return document.fullscreenElement === el;
});

const isMoveMode = computed(() => moveMode.value);

const handleToggleFullscreen = () => {
  const el = mind.value?.el;
  if (!el) return;

  if (document.fullscreenElement === el) {
    document.exitFullscreen().catch(() => {});
  } else {
    el.requestFullscreen().catch(() => {});
  }
};

const handleToCenter = () => {
  mind.value?.toCenter();
};

const handleZoomIn = () => {
  if (!mind.value) return;
  mind.value.scale(mind.value.scaleVal + mind.value.scaleSensitivity);
};

const handleZoomOut = () => {
  if (!mind.value) return;
  mind.value.scale(mind.value.scaleVal - mind.value.scaleSensitivity);
};

const handleToggleMoveMode = () => {
  store.setMoveMode(!moveMode.value);
};

const handleInitLeft = () => {
  mind.value?.initLeft();
};

const handleInitRight = () => {
  mind.value?.initRight();
};

const handleInitSide = () => {
  mind.value?.initSide();
};

// 可选：监听全屏变化，未来如需与其他 UI 同步，可以在这里发事件或更新外层状态
const handleFullscreenChange = () => {
  // 这里依赖 computed isFullscreen 自动更新，不需要额外逻辑
};

onMounted(() => {
  document.addEventListener('fullscreenchange', handleFullscreenChange);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
});
</script>
