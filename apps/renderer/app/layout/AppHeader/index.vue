<template>
  <header class="app-header">
    <!-- 侧边栏扩展区域 - 当sidebar展开时显示 -->
    <transition :name="sidebarTransitionName">
      <div
        v-show="uiStore.sidebarVisible"
        class="sidebar-extension"
        :style="{ width: `${uiStore.sidebarWidth}px` }"
      />
    </transition>

    <!-- 左侧区域：功能按钮 + 标题（左对齐） -->
    <HeaderLeftSection
      :is-mac="isMac"
      :is-window-maximized="isWindowMaximized"
    />

    <!-- 右侧按钮区域 -->
    <HeaderRightSection
      :is-mac="isMac"
      :is-window-maximized="isWindowMaximized"
    />
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import HeaderLeftSection from './HeaderLeftSection.vue';
import HeaderRightSection from './HeaderRightSection.vue';

const uiStore = useUIStore();

// 检测操作系统
const isMac = ref(false);
// 窗口最大化状态
const isWindowMaximized = ref(false);
let cleanupListener: (() => void) | null = null;

onMounted(() => {
  // 检测是否为 macOS
  isMac.value =
    /Mac|iPod|iPhone|iPad/.test(navigator.platform) || navigator.platform === 'MacIntel';

  // 监听窗口最大化状态（仅在 Electron 环境下可用）
  const electronApi = window.electronAPI;
  if (electronApi && typeof electronApi.onWindowMaximizedState === 'function') {
    cleanupListener = electronApi.onWindowMaximizedState((isMaximized: boolean) => {
      isWindowMaximized.value = isMaximized;
    });
  }
});

onUnmounted(() => {
  if (cleanupListener) {
    cleanupListener();
  }
});

// 计算侧边栏过渡名称，与 AppLayout 保持一致。
// 中文说明：Header 上的侧边栏背景必须和真实 Sidebar 同步滑出；
// 如果这里使用 width 收缩，会在关闭瞬间留下一个很窄的背景条。
const sidebarTransitionName = 'sidebar-fade';
</script>
