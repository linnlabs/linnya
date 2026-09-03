<template>
  <div class="mindmap-page">
    <div class="mindmap-container">
      <!-- 宿主元素：MindMap 会在这里渲染思维导图 -->
      <div
        ref="mapRef"
        class="mindmap-root"
        :style="{
          opacity: store.isMindMapReady ? 1 : 0,
          visibility: store.isMindMapReady ? 'visible' : 'hidden',
        }"
      />

      <!-- Vue 版工具栏：覆盖原生插件 toolbar -->
      <MindMapToolbar v-if="mind" />

      <!-- Vue 版右键菜单：覆盖原生插件 contextMenu -->
      <MindMapContextMenu v-if="mind" />

      <!-- Vue 版节点编辑器：替代原生 contentEditable -->
      <NodeEditor v-if="mind" :mind="mind" />

      <!-- 富内容挂载容器 -->
      <RichContentHost v-if="mind" :mind="mind" />

      <!-- 节点 addons Host：统一承载引用/图片/卡片等扩展内容 -->
      <NodeAddonsHost v-if="mind" :mind="mind" />

      <!-- 插入引用面板（复用 Editor CitationPanel 同款 UX） -->
      <ReferenceInsertPanel v-if="mind" :mind="mind" />
    </div>
  </div>
</template>

<script setup lang="ts">
/// <reference types="vite/client" />
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { MindMapInstance, Options } from '../domain/types';
import MindMap from '../core';
import MindMapToolbar from '../presentation/ui/MindMapToolbar.vue';
import MindMapContextMenu from '../presentation/ui/MindMapContextMenu.vue';
import NodeEditor from '../presentation/ui/NodeEditor.vue';
import RichContentHost from '../presentation/ui/RichContentHost.vue';
import { installMindMapEvidenceFeature } from '../features/evidence';
import { installMindMapTaggingFeature } from '../features/tagging';
import { installMindMapAutoRefreshFeature } from '../features/autoRefresh';
import ReferenceInsertPanel from '../features/evidence/ui/ReferenceInsertPanel.vue'
import NodeAddonsHost from '../presentation/ui/NodeAddonsHost.vue'
import { useMindMapStore } from '../domain/store/mindmapStore';
import { useMindmapHotkeys } from '../presentation/composables/useMindmapHotkeys';
import { markActiveFileDirty } from '@plugin/renderer/workspaceRuntime';

// MindMap 的样式由插件 renderer 入口统一聚合，host 只需要注册插件贡献。

const mapRef = ref<globalThis.HTMLElement | null>(null);
const mind = shallowRef<MindMapInstance | null>(null);
const store = useMindMapStore();
// 中文说明：在页面 setup 阶段就隐藏画布，避免首帧渲染露出“旧实例/空文档”的中间态
store.isMindMapReady = false;
useMindmapHotkeys();

// 中文说明（根因修复）：用 flush:'sync' 同步把 DOM 隐藏/显示，避免等待 Vue patch 期间露出 1 帧中间态
watch(
  () => store.isMindMapReady,
  (ready) => {
    const el = mapRef.value
    if (!el) return
    el.style.opacity = ready ? '1' : '0'
    el.style.visibility = ready ? 'visible' : 'hidden'
  },
  { immediate: true, flush: 'sync' }
)

function isViewportDebugEnabled(): boolean {
  return (window as { __MM_VIEWPORT_DEBUG__?: boolean }).__MM_VIEWPORT_DEBUG__ === true
}

// 事件处理函数引用，用于销毁时移除监听
let eventHandlers: Record<string, any> = {};
const cleanupMindListeners: Array<() => void> = [];

const bindMindEvents = (instance: MindMapInstance) => {
  const handleOperation = () => {
    if (!store.isApplyingDocument) {
      markActiveFileDirty(true);
    }
  };

  instance.bus?.addListener('operation', handleOperation);
  cleanupMindListeners.push(() => {
    instance.bus?.removeListener('operation', handleOperation);
  });
};

onMounted(() => {
  if (!mapRef.value) return;

  const options: Options = {
    el: mapRef.value,
    newTopicName: '子节点',
    // 默认从根节点向右展开，可以根据需要改成 LEFT / SIDE
    direction: MindMap.RIGHT,
    locale: 'en',
    draggable: true,
    editable: true,
    // 关闭内置 contextMenu，使用 Vue 组件替代
    contextMenu: false,
    // 关闭内置 toolbar，使用 Vue 组件替代
    toolBar: false,
    keypress: false,
    allowUndo: true,
    // 缩放步长调细：滚轮/快捷键/工具栏统一使用该步长
    scaleSensitivity: 0.05,
    // 超大图需要更深一级缩小；配合 viewControls.scale 的 clamp，可稳定达到下限
    scaleMin: 0.05,
  };

  const instance = new MindMap(options);
  mind.value = instance;

  // 初始化 Store
  store.setMind(instance);
  if (isViewportDebugEnabled()) {
    console.log('[MindMapView] mounted', {
      currentDocumentId: store.currentDocumentId,
      mindDocumentId: instance.documentId,
      transform: instance.map?.style?.transform ?? null,
      scale: instance.scaleVal ?? null,
    })
  }
  bindMindEvents(instance);

  // 安装 Evidence Feature（Phase 4: 数据一致性 Hook 等副作用统一在这里管理）
  const disposeEvidenceFeature = installMindMapEvidenceFeature(instance);
  cleanupMindListeners.push(disposeEvidenceFeature);

  // 安装 Tagging Feature（Milestone 2: 打标状态呈现）
  const disposeTaggingFeature = installMindMapTaggingFeature(instance);
  cleanupMindListeners.push(disposeTaggingFeature);

  // 安装 AutoRefresh Feature（Milestone 3: 自动刷新编排）
  const disposeAutoRefreshFeature = installMindMapAutoRefreshFeature(instance);
  cleanupMindListeners.push(disposeAutoRefreshFeature);

  // 注册事件监听
  // 注意：selectNodes/unselectNodes 事件参数是 NodeObj[]，但我们需要 DOM 元素 Topic[]
  // 所以直接读取 instance.currentNodes 状态更准确
  eventHandlers = {
    selectNodes: () => store.updateSelection(instance.currentNodes),
    unselectNodes: () => store.updateSelection(instance.currentNodes),
    scale: (scale: number) => store.updateScale(scale),
    changeDirection: (dir: number) => store.updateDirection(dir),
    viewMoved: (data: { dx: number; dy: number }) => store.updateViewportByMove(data),
  };

  // 中文说明：监听新事件名（state:*），旧事件名仍会通过 bus 桥接双发
  instance.bus.addListener('state:selectNodes', eventHandlers.selectNodes);
  instance.bus.addListener('state:unselectNodes', eventHandlers.unselectNodes);
  instance.bus.addListener('state:scaleChanged', eventHandlers.scale);
  instance.bus.addListener('state:directionChanged', eventHandlers.changeDirection);
  instance.bus.addListener('state:viewMoved', eventHandlers.viewMoved);
});

onUnmounted(() => {
  // 中文说明：
  // - 必须等子组件（NodeEditor / NodeAddonsHost / RichContentHost 等）先完成卸载，
  //   再销毁 MindMap 实例；否则 mind.destroy() 会把 mind.bus / mind.container 置空，
  //   子组件在 onUnmounted 里移除监听会直接报错，并触发 Vue 内部 patch 异常。
  //
  // 额外说明：
  // - 页面切换会卸载 MindMapView，但用户期望切回后回到“上次浏览位置”；
  // - 因此销毁前强制采集一次 viewport，确保缓存是最新值。
  store.captureViewportSnapshot()
  if (isViewportDebugEnabled()) {
    console.log('[MindMapView] unmounted (after captureViewportSnapshot)', {
      currentDocumentId: store.currentDocumentId,
      cachedViewport: store.currentViewport,
    })
  }
  cleanupMindListeners.forEach((dispose) => dispose());
  cleanupMindListeners.length = 0;

  if (mind.value) {
    const instance = mind.value;
    // 移除监听器
    if (instance.bus) {
      instance.bus.removeListener('state:selectNodes', eventHandlers.selectNodes);
      instance.bus.removeListener('state:unselectNodes', eventHandlers.unselectNodes);
      instance.bus.removeListener('state:scaleChanged', eventHandlers.scale);
      instance.bus.removeListener('state:directionChanged', eventHandlers.changeDirection);
      instance.bus.removeListener('state:viewMoved', eventHandlers.viewMoved);
    }

    // 中文说明（根因修复：避免 setDocumentSession 竞态崩溃）：
    // - instance.destroy() 会把 instance.bus 置空；
    // - 但若 destroy 与下一次 open()/setDocumentSession 并发发生，store 仍握着旧实例会导致 mind.value.bus.fire 直接抛错；
    // - 因此必须先断开 store 对实例的引用，再 destroy 实例本体。
    store.setMind(null);
    mind.value = null;

    if (typeof instance.destroy === 'function') {
      instance.destroy();
    }
  }
  // 兜底：若 mind.value 为 null，也确保 store 已清空
  store.setMind(null);
});
</script>
