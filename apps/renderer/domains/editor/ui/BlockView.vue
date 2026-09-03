<!-- Editor domain block view。 -->
<!--
 * BlockView.vue — 轻量化壳组件
 *
 * 职责：
 * 1. 提供稳定的 ProseMirror NodeView DOM 结构（root-block-outer / root-block / content）
 * 2. 注册 IntersectionObserver 与 blockVisibilityManager
 * 3. 延迟水合：仅在块进入视口附近后才挂载 BlockChrome（重型 composable + UI）
 * 4. 为子内容块（CodeBlock / ImageBlock 等）提供默认的 currentBlockActivation
 *
 * 与 BlockChrome 的分工：
 * - BlockView：常驻壳，1000 块场景下 setup 开销极低（~0.1ms/块）
 * - BlockChrome：重型 chrome，仅为视口内的 ~20-30 块创建
 -->
<template>
  <node-view-wrapper
    ref="rootBlockOuterRef"
    :class="[ROOT_BLOCK_DOM_CLASSES.outer, contentBlockClass]"
    :data-node-type="ROOT_BLOCK_DOM_NODE_TYPES.outer"
    :data-id="currentBlockId || undefined"
  >
    <div
      ref="rootBlockRef"
      :class="ROOT_BLOCK_DOM_CLASSES.body"
      :data-node-type="ROOT_BLOCK_DOM_NODE_TYPES.body"
      :style="blockColorStyle"
    >
      <!-- 块级 chrome：延迟水合 -->
      <BlockChrome
        v-if="shouldMountBlockChrome"
        :editor="props.editor"
        :node="props.node"
        :selected="props.selected"
        :get-pos="props.getPos"
        :root-block-outer-el="rootBlockOuterRef"
        :root-block-el="rootBlockRef"
        :is-block-visible="isBlockVisible"
        :is-block-in-viewport="isBlockInViewport"
        :is-block-history-visible="isBlockHistoryVisible"
        :history-mount-target="historyMountRef"
        :is-keep-alive="keepAliveState.isKeepAlive"
      />

      <!-- 块内容区域（ProseMirror 管理） -->
      <node-view-content :class="ROOT_BLOCK_DOM_CLASSES.content" />

      <!-- 历史面板的 Teleport 挂载点 -->
      <div
        ref="historyMountRef"
        contenteditable="false"
        v-bind="{ [ROOT_BLOCK_DOM_ATTRS.historyMount]: 'true' }"
      ></div>
    </div>
  </node-view-wrapper>
</template>

<script setup lang="ts">
import { ref, computed, inject, provide } from 'vue';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3';
import type { Editor } from '@tiptap/vue-3';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import {
  createDefaultBlockVisibilityState,
  GET_BLOCK_VISIBILITY_STATE_KEY,
  OBSERVE_BLOCK_KEY,
  REGISTER_BLOCK_VISIBILITY_KEY,
  UNOBSERVE_BLOCK_KEY,
  UNREGISTER_BLOCK_VISIBILITY_KEY,
  type BlockVisibilityState,
} from './composables/useBlockVisibilityManager';
import {
  createDefaultBlockActivation,
  CURRENT_BLOCK_ACTIVATION_KEY,
} from './composables/useCurrentBlockActivation';
import { provideBlockKeepAlive } from './composables/useBlockKeepAlive';
import BlockChrome from './BlockChrome.vue';
import { useBlockChromeMountState } from './composables/useBlockChromeMountState';
import { readRootBlockId } from '../features/RenderVirtualization/functions/readRootBlockAttrs';
import {
  ROOT_BLOCK_DOM_ATTRS,
  ROOT_BLOCK_DOM_CLASSES,
  ROOT_BLOCK_DOM_NODE_TYPES,
  getRootBlockContentClass,
  resolveRootBlockColorStyle,
} from '../shared/rootBlockDomContract';
import {
  useBlockViewRuntimeHandle,
  type BlockViewOuterElementSource,
} from './composables/useBlockViewRuntimeHandle';
import { useBlockViewLifecycle } from './composables/useBlockViewLifecycle';

// ==================== Props ====================

interface BlockViewPropsType {
  editor: Editor;
  node: ProseMirrorNode;
  selected: boolean;
  getPos: () => number;
}

const props = defineProps<BlockViewPropsType>();

// ==================== DOM 引用 ====================

const rootBlockOuterRef = ref<BlockViewOuterElementSource>(null);
const rootBlockRef = ref<HTMLElement | null>(null);
const historyMountRef = ref<HTMLElement | null>(null);

// ==================== 可见性（来自 blockVisibilityManager） ====================

const observeBlock = inject(OBSERVE_BLOCK_KEY, () => {});
const unobserveBlock = inject(UNOBSERVE_BLOCK_KEY, () => {});
const getBlockVisibilityState = inject<(blockId: string) => BlockVisibilityState>(
  GET_BLOCK_VISIBILITY_STATE_KEY,
  createDefaultBlockVisibilityState
);
const registerBlockVisibility = inject(REGISTER_BLOCK_VISIBILITY_KEY, () => {});
const unregisterBlockVisibility = inject(UNREGISTER_BLOCK_VISIBILITY_KEY, () => {});

const currentBlockId = computed(() => readRootBlockId(props.node) ?? '');
const visibilityState = computed(() => getBlockVisibilityState(currentBlockId.value));
const isBlockVisible = computed<boolean>(() => visibilityState.value.isNearViewport.value);
const isBlockInViewport = computed<boolean>(() => visibilityState.value.isInViewport.value);
const isBlockHistoryVisible = computed<boolean>(() => visibilityState.value.isInHistoryViewport.value);

// ==================== 轻量计算属性 ====================

const contentBlockClass = computed(() => {
  return getRootBlockContentClass(props.node.firstChild?.type.name);
});

const blockColorStyle = computed(() => {
  return resolveRootBlockColorStyle({
    backgroundColor: props.node.attrs.backgroundColor,
    textColor: props.node.attrs.textColor,
  });
});

// ==================== Provide ====================

// 保活 API：子内容块（AudioBlockView 等）通过 inject 注册保活原因
const keepAliveState = provideBlockKeepAlive();

// 子内容块的默认激活状态（始终活跃）
// BlockChrome 挂载后会为自身子组件提供更精细的激活状态，
// 但 node-view-content 内的内容块在 Vue 组件树上是 BlockView 的后代，
// 因此使用此处的默认值——始终渲染全部 UI。
provide(CURRENT_BLOCK_ACTIVATION_KEY, createDefaultBlockActivation());

// ==================== 延迟水合 ====================

const {
  shouldMountBlockChrome,
  requestMount: requestBlockChromeMount,
} = useBlockChromeMountState({
  isNearViewport: isBlockVisible,
  isInViewport: isBlockInViewport,
  isInHistoryViewport: isBlockHistoryVisible,
  isKeepAlive: keepAliveState.isKeepAlive,
  isSelected: computed(() => props.selected),
});

// ==================== 生命周期编排 ====================

const {
  getRootBlockOuterEl,
  refreshRootBlockRuntimeHandle,
  cleanupRootBlockRuntimeHandle,
} = useBlockViewRuntimeHandle({
  blockId: currentBlockId,
  rootBlockOuterRef,
  rootBlockRef,
  historyMountRef,
  getPos: props.getPos,
  runtimeRegistryOwner: props.editor,
});

useBlockViewLifecycle({
  blockId: currentBlockId,
  shouldMountBlockChrome,
  getRootBlockOuterEl,
  refreshRootBlockRuntimeHandle,
  cleanupRootBlockRuntimeHandle,
  observeBlock,
  unobserveBlock,
  registerBlockVisibility,
  unregisterBlockVisibility,
  requestBlockChromeMount,
});
</script>
