<template>
  <Teleport to="body">
    <aside
      ref="asideRef"
      class="outline-sidebar"
      :style="outlineSidebarStyle"
      :class="{
        'is-visible': shouldShowOutlinePanel,
        'outline-collapsed': !shouldShowOutlinePanel,
        'fade-in': shouldShowOutlinePanel,
        overlay: shouldShowOutlinePanel,
        'is-large-outline': isLargeOutline
      }"
      @mouseenter="setPanelHovered(true)"
      @mouseleave="setPanelHovered(false)"
      @focusin="setPanelFocused(true)"
      @focusout="handlePanelFocusOut"
      @scroll.passive="handleOutlineScroll"
    >
      <!-- 小目录保留原有过渡；大目录走窗口化渲染，避免 transition-group 一次性挂载大量节点。 -->
      <transition-group
        v-if="shouldRenderAnimatedOutline"
        name="fade"
        tag="ul"
        class="outline-list"
        appear
        @before-leave="onBeforeLeave"
        @after-leave="onAfterLeave"
        @before-enter="onBeforeEnter"
        @after-enter="onAfterEnter"
      >
        <OutlineItem
          v-for="item in visibleOutlineList"
          :key="item.id"
          :item="item"
          :navigate-to-heading="navigateToHeading"
          :handle-toggle-collapse="handleToggleCollapse"
          :is-collapsed="collapsedItems.has(item.id)"
          :has-actual-children="item.hasActualChildren"
          :is-active="item.id === activeHeadingId"
          :data-id="item.id"
        />
      </transition-group>

      <ul
        v-else-if="shouldRenderVirtualOutline"
        class="outline-list outline-list-virtual"
      >
        <li
          v-if="virtualOutlineWindow.beforeHeight > 0"
          class="outline-virtual-spacer"
          :style="{ height: `${virtualOutlineWindow.beforeHeight}px` }"
          aria-hidden="true"
        />
        <OutlineItem
          v-for="item in virtualOutlineWindow.items"
          :key="item.id"
          :item="item"
          :navigate-to-heading="navigateToHeading"
          :handle-toggle-collapse="handleToggleCollapse"
          :is-collapsed="collapsedItems.has(item.id)"
          :has-actual-children="item.hasActualChildren"
          :is-active="item.id === activeHeadingId"
          :data-id="item.id"
        />
        <li
          v-if="virtualOutlineWindow.afterHeight > 0"
          class="outline-virtual-spacer"
          :style="{ height: `${virtualOutlineWindow.afterHeight}px` }"
          aria-hidden="true"
        />
      </ul>
    </aside>
  </Teleport>
</template>

<script>
// 中文说明：不要把真实 editor 实例放在 <script setup> 顶层变量里。
// 大文档下只要 outline 的响应式状态更新，Vue Devtools/组件代理就可能枚举 setup 暴露的对象；
// editor 实例对象图极大，暴露在这里会把一次轻量的 hasHeadings 更新放大成渲染进程长任务。
let outlineSubscribedEditor = null;
</script>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue';
import { useUIStore } from '../../../../shared/stores/ui';
import OutlineItem from './OutlineItem.vue';
import { planOutlineListUpdate } from './functions/outlineUpdatePolicy';
import {
  calculateOutlinePanelTop,
  calculateOutlineTriggerTop,
  estimateOutlinePanelHeight,
} from './functions/outlineFloatingGeometry';
import { useOutlineRuntimeState } from './store/useOutlineRuntimeState';
import { debounce } from 'lodash-es';
// 使用 PositionResolver 将 heading.pos 映射到对应的 rootBlock，确保块级选中生效
import { PositionResolver } from '../../extensions/position/PositionResolver';
// 引入 NodeSelection，用于在活动标题跟踪时识别块级选区
import { NodeSelection } from 'prosemirror-state';
// ✅ 统一块跳转逻辑：复用 editor/shared/utils/blockNavigation（与“AI 引用跳转”一致）
import { navigateToRootBlockById } from '../../shared/utils/blockNavigation';
import { useEditorLocalization } from '../../ui/useEditorLocalization';

const uiStore = useUIStore();
const { editorMessage } = useEditorLocalization();
const {
  hasHeadings: outlineHasHeadings,
  outlinePreviewVisible,
  outlineHostLeft,
  outlineHostTop,
  outlineHostHeight,
  outlineHostGeometryReady,
  setHasHeadings,
  setPanelHovered,
  setPanelFocused,
} = useOutlineRuntimeState();
const getCurrentEditor = () => uiStore.getEditor();

// --- Refs --- 
const asideRef = ref(null); // Ref for the aside element
const activeHeadingId = ref(null); // 跟踪当前活动的标题ID
const outlineScrollTop = ref(0);
const outlineViewportHeight = ref(600);

// --- 状态 --- 
const flatOutlineList = ref([]); // 扁平化的标题列表
const collapsedItems = ref(new Set()); // 存储折叠项 ID 的 Set
const lastVisibleOutlineItemCount = ref(0);

const LARGE_OUTLINE_ITEM_THRESHOLD = 50;
const OUTLINE_VIRTUAL_ITEM_HEIGHT = 28;
const OUTLINE_VIRTUAL_OVERSCAN = 8;
const OUTLINE_LIST_TOP_PADDING = 14;
const OUTLINE_LIST_VERTICAL_PADDING = OUTLINE_LIST_TOP_PADDING * 2;
const OUTLINE_FLOATING_EDGE_GAP = 16;
const OUTLINE_TRIGGER_HEIGHT = 104;
const OUTLINE_PANEL_MIN_HEIGHT = 100;
const OUTLINE_PANEL_VIEWPORT_RATIO = 0.7;
const OUTLINE_PANEL_RESERVED_VIEWPORT_HEIGHT = 128;

let fileLoadedOutlineUpdateHandle = null;
let fileLoadedOutlineUpdateKind = null;

const isOutlineRequested = computed(() => uiStore.outlineVisible || outlinePreviewVisible.value);
const shouldShowOutlinePanel = computed(() => (
  isOutlineRequested.value &&
  outlineHasHeadings.value &&
  outlineHostGeometryReady.value
));
const outlineFloatingViewportHeight = computed(() => (
  typeof globalThis.innerHeight === 'number'
    ? globalThis.innerHeight
    : outlineHostTop.value + outlineHostHeight.value
));
const outlinePanelMaxHeight = computed(() => Math.max(
  OUTLINE_PANEL_MIN_HEIGHT,
  Math.min(
    outlineFloatingViewportHeight.value * OUTLINE_PANEL_VIEWPORT_RATIO,
    outlineFloatingViewportHeight.value - OUTLINE_PANEL_RESERVED_VIEWPORT_HEIGHT
  )
));
const outlineTriggerTop = computed(() => calculateOutlineTriggerTop({
  hostTop: outlineHostTop.value,
  hostHeight: outlineHostHeight.value,
  viewportHeight: outlineFloatingViewportHeight.value,
  edgeGap: OUTLINE_FLOATING_EDGE_GAP,
  triggerHeight: OUTLINE_TRIGGER_HEIGHT,
}));
const outlinePanelGeometryItemCount = computed(() => (
  shouldShowOutlinePanel.value
    ? visibleOutlineList.value.length
    : lastVisibleOutlineItemCount.value
));
const outlinePanelHeight = computed(() => estimateOutlinePanelHeight({
  hostTop: outlineHostTop.value,
  hostHeight: outlineHostHeight.value,
  viewportHeight: outlineFloatingViewportHeight.value,
  edgeGap: OUTLINE_FLOATING_EDGE_GAP,
  anchorTop: outlineTriggerTop.value,
  anchorHeight: OUTLINE_TRIGGER_HEIGHT,
  itemCount: outlinePanelGeometryItemCount.value,
  itemHeight: OUTLINE_VIRTUAL_ITEM_HEIGHT,
  listVerticalPadding: OUTLINE_LIST_VERTICAL_PADDING,
  minPanelHeight: OUTLINE_PANEL_MIN_HEIGHT,
  maxPanelHeight: outlinePanelMaxHeight.value,
}));
const outlineSidebarStyle = computed(() => ({
  left: `${outlineHostLeft.value + 20}px`,
  top: `${calculateOutlinePanelTop({
    hostTop: outlineHostTop.value,
    hostHeight: outlineHostHeight.value,
    viewportHeight: outlineFloatingViewportHeight.value,
    edgeGap: OUTLINE_FLOATING_EDGE_GAP,
    anchorTop: outlineTriggerTop.value,
    anchorHeight: OUTLINE_TRIGGER_HEIGHT,
    itemCount: outlinePanelGeometryItemCount.value,
    itemHeight: OUTLINE_VIRTUAL_ITEM_HEIGHT,
    listVerticalPadding: OUTLINE_LIST_VERTICAL_PADDING,
    minPanelHeight: OUTLINE_PANEL_MIN_HEIGHT,
    maxPanelHeight: outlinePanelMaxHeight.value,
  })}px`,
  // 中文说明：关闭时列表会立刻清空，max-height 只能限制上限，不能阻止外壳掉回 min-height。
  // 因此淡出阶段要临时锁住实际 height，避免出现 100px 矮面板闪一下。
  height: shouldShowOutlinePanel.value || lastVisibleOutlineItemCount.value === 0
    ? undefined
    : `${outlinePanelHeight.value}px`,
  maxHeight: `${outlinePanelHeight.value}px`,
}));

// --- 核心逻辑：构建扁平列表 --- 
const buildFlatList = (headings) => {
  const flatList = [];
  const stack = []; // 用于追踪父节点 ID
  const headingMap = new Map(headings.map(h => [h.id, h])); // 便于查找

  const buildTreeNodes = (currentHeadings, parentId = null) => {
    const nodes = [];
    let i = 0;
    while (i < currentHeadings.length) {
      const heading = currentHeadings[i];
      const node = { 
        ...heading, 
        parentId,
        children: [] 
      };

      i++; // 移到下一个标题

      // 查找子标题
      const childrenHeadings = [];
      while (i < currentHeadings.length && currentHeadings[i].level > heading.level) {
        childrenHeadings.push(currentHeadings[i]);
        i++;
      }
      // 回退索引，因为外层循环会再次增加 i
      i--; 

      // 递归构建子节点
      if (childrenHeadings.length > 0) {
          node.children = buildTreeNodes(childrenHeadings, heading.id);
      }
      
      nodes.push(node);
      i++; // 移动到下一个同级或更高级别的标题
    }
    return nodes;
  };

  // 深度优先遍历临时树以生成扁平列表
  const traverse = (nodes) => {
    for (const node of nodes) {
      flatList.push({
        id: node.id,
        text: node.text,
        level: node.level,
        pos: node.pos,
        parentId: node.parentId,
        hasActualChildren: node.children.length > 0
      });
      if (node.children.length > 0) {
        traverse(node.children);
      }
    }
  };

  const tree = buildTreeNodes(headings);
  traverse(tree);
  return flatList;
};

// --- 核心逻辑：更新目录 --- 
const updateOutline = () => {
  const editorInstance = getCurrentEditor();
  if (!editorInstance) {
    setHasHeadings(false);
    flatOutlineList.value = [];
    return;
  }

  const shouldCollectHeadingDetails = isOutlineRequested.value;
  const headings = [];
  let hasAnyHeadings = false;
  try {
    editorInstance.state.doc.descendants((node, pos) => {
      if (node.type.name === 'headingBlock') {
        hasAnyHeadings = true;
        if (shouldCollectHeadingDetails) {
          headings.push({
            id: node.attrs.id || `heading-${pos}`,
            text: node.textContent || editorMessage('editor.outline.emptyHeading'),
            level: node.attrs.level || 1,
            pos: pos,
          });
        }
      }
    });
  } catch (error) {
    console.error('[OutlineSidebar] Error traversing document:', error);
    hasAnyHeadings = false;
    headings.length = 0;
  }

  const updatePlan = planOutlineListUpdate({
    hasAnyHeadings,
    outlineVisible: shouldCollectHeadingDetails,
    currentListLength: flatOutlineList.value.length,
  });

  setHasHeadings(updatePlan.publishHasHeadings);

  if (updatePlan.shouldClearList) {
    flatOutlineList.value = [];
  }

  if (!updatePlan.shouldPopulateList) {
    // 中文说明：目录关闭时只发布“存在标题”这个轻量状态，不构建/写入标题列表。
    // 大文档首开阶段的首要目标是让编辑器可交互；目录列表等用户打开目录时再懒构建。
    return;
  }

  const newFlatList = buildFlatList(headings); // 先存到临时变量
  flatOutlineList.value = newFlatList; // 再赋值
  // 清理不存在的折叠项
  const currentIds = new Set(flatOutlineList.value.map(item => item.id));
  collapsedItems.value.forEach(id => {
    if (!currentIds.has(id)) {
      collapsedItems.value.delete(id);
    }
  });
};

const debouncedUpdateOutline = debounce(updateOutline, 300);

const cancelFileLoadedOutlineUpdate = () => {
  if (fileLoadedOutlineUpdateHandle === null) return;
  if (fileLoadedOutlineUpdateKind === 'idle' && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(fileLoadedOutlineUpdateHandle);
  } else {
    clearTimeout(fileLoadedOutlineUpdateHandle);
  }
  fileLoadedOutlineUpdateHandle = null;
  fileLoadedOutlineUpdateKind = null;
};

const scheduleFileLoadedOutlineUpdate = () => {
  cancelFileLoadedOutlineUpdate();

  // 中文说明：大文档 direct-state 注入后，file-content-loaded 仍处在同一轮事件循环里。
  // 目录不是首屏编辑必需能力，不能在这个事件栈里同步写 Vue 列表状态；
  // 否则 Vue flush 会抢在 benchmark / editor 首帧之后执行，1500+ 块时可能卡住 renderer。
  const run = () => {
    fileLoadedOutlineUpdateHandle = null;
    fileLoadedOutlineUpdateKind = null;
    updateOutline();
  };

  if (typeof window.requestIdleCallback === 'function') {
    fileLoadedOutlineUpdateKind = 'idle';
    fileLoadedOutlineUpdateHandle = window.requestIdleCallback(run, { timeout: 800 });
    return;
  }

  fileLoadedOutlineUpdateKind = 'timeout';
  fileLoadedOutlineUpdateHandle = setTimeout(run, 0);
};

// --- 计算可见列表 --- 
const visibleOutlineList = computed(() => {
  const currentFlatList = flatOutlineList.value; // 获取当前扁平列表
  const visibleList = [];
  const itemMap = new Map(currentFlatList.map(item => [item.id, item]));

  for (const item of currentFlatList) {
    let parent = item.parentId ? itemMap.get(item.parentId) : null;
    let isVisible = true;
    while (parent) {
      if (collapsedItems.value.has(parent.id)) {
        isVisible = false;
        break;
      }
      parent = parent.parentId ? itemMap.get(parent.parentId) : null;
    }
    if (isVisible) {
      visibleList.push(item);
    }
  }
  return visibleList;
});

const isLargeOutline = computed(() => visibleOutlineList.value.length > LARGE_OUTLINE_ITEM_THRESHOLD);

const shouldRenderOutlineList = computed(() => shouldShowOutlinePanel.value);
const shouldRenderAnimatedOutline = computed(() => shouldRenderOutlineList.value && !isLargeOutline.value);
const shouldRenderVirtualOutline = computed(() => shouldRenderOutlineList.value && isLargeOutline.value);

const syncOutlineViewportMetrics = () => {
  if (!asideRef.value) return;
  outlineScrollTop.value = asideRef.value.scrollTop;
  outlineViewportHeight.value = asideRef.value.clientHeight || outlineViewportHeight.value;
};

const handleOutlineScroll = () => {
  syncOutlineViewportMetrics();
};

const virtualOutlineWindow = computed(() => {
  const items = visibleOutlineList.value;
  if (!isLargeOutline.value) {
    return {
      items,
      beforeHeight: 0,
      afterHeight: 0,
    };
  }

  const rawStartIndex = Math.floor(
    Math.max(0, outlineScrollTop.value - OUTLINE_LIST_TOP_PADDING) / OUTLINE_VIRTUAL_ITEM_HEIGHT
  );
  const visibleCount = Math.ceil(outlineViewportHeight.value / OUTLINE_VIRTUAL_ITEM_HEIGHT);
  const startIndex = Math.max(0, rawStartIndex - OUTLINE_VIRTUAL_OVERSCAN);
  const endIndex = Math.min(
    items.length,
    rawStartIndex + visibleCount + OUTLINE_VIRTUAL_OVERSCAN * 2
  );

  return {
    items: items.slice(startIndex, endIndex),
    beforeHeight: startIndex * OUTLINE_VIRTUAL_ITEM_HEIGHT,
    afterHeight: (items.length - endIndex) * OUTLINE_VIRTUAL_ITEM_HEIGHT,
  };
});

watch([shouldRenderOutlineList, visibleOutlineList], () => {
  nextTick(() => {
    syncOutlineViewportMetrics();
  });
}, { flush: 'post' });

// --- 交互处理 --- 
const handleToggleCollapse = (itemId) => {
  if (collapsedItems.value.has(itemId)) {
    collapsedItems.value.delete(itemId);
  } else {
    collapsedItems.value.add(itemId);
  }
  // 强制触发响应式更新（或者依赖 computed 属性）
  // flatOutlineList.value = [...flatOutlineList.value]; // 不推荐
};

const handlePanelFocusOut = (event) => {
  const nextFocusedElement = event.relatedTarget;
  if (nextFocusedElement && asideRef.value?.contains(nextFocusedElement)) {
    return;
  }

  setPanelFocused(false);
};

// --- 导航功能 --- 
// 需求：
// 1. 点击目录标题时，将对应内容块滚动到当前视图的顶部；
// 2. 同时触发对应 rootBlock 的选中（块级高亮），而不是仅仅移动光标。
const navigateToHeading = async (heading) => {
  const editorInstance = getCurrentEditor();
  if (!editorInstance || !heading) return;

  try {
    // 1. 通过 PositionResolver 找到该 heading 所在的 rootBlock 位置
    const positionResolver = new PositionResolver(editorInstance);
    const rootBlockInfo = positionResolver.getNearestRootBlockPos(heading.pos);

    // 如果找不到 rootBlock，就退回到 heading 自身的位置（至少保证能滚动）
    const targetBlockPos = rootBlockInfo?.pos ?? heading.pos;

    // 2. ✅ 优先走统一的“按 blockId 跳转”逻辑（与 AI 引用跳转保持一致）
    // 中文说明：rootBlock.attrs.id 在前后端是一致的稳定 blockId，推荐始终以 blockId 作为跳转锚点。
    const blockId = rootBlockInfo?.node?.attrs?.id;
    if (typeof blockId === 'string' && blockId.length > 0) {
      const ok = await navigateToRootBlockById(editorInstance, blockId, {
        scrollBehavior: 'auto',
        scrollBlock: 'start',
      });
      if (ok) return;
    }

    // 3. 兼容回退：极少数情况下 rootBlock 没有 id 时，仍按 pos 选中+滚动，避免目录失效
    editorInstance.chain().focus().setNodeSelection(targetBlockPos).run();
    const dom = editorInstance.view.nodeDOM(targetBlockPos);
    if (dom instanceof Element) {
      dom.scrollIntoView({ block: 'start', behavior: 'auto' });
    } else {
      editorInstance.commands.scrollIntoView();
    }
  } catch (e) {
    console.warn('[OutlineSidebar] Navigation failed, falling back to text selection:', e);
    // 出错时的回退：尝试简单的光标定位（到块首）并滚动
    try {
        const fallbackPos = Math.min(heading.pos + 1, editorInstance.state.doc.content.size);
        editorInstance.chain().focus().setTextSelection(fallbackPos).scrollIntoView().run();
    } catch (fallbackError) {
        // Ignore
    }
  }
};

// --- Transition Hooks --- 
/* 记录当前有多少节点正处在 leave/enter 动画中 */
let activeTransitions = 0;
/* 记录批次动画开始时的高度 */
let startHeight = 0;
/* 记录批次动画结束后的目标高度 */
let pendingEndHeight = null;
/* 标记是否正在进行高度补间动画 */
let isHeightAnimating = false;
/* 标记是否有排队的动画 */
let queued = false;
/* 用于清除兜底定时器 */
let releaseTimeoutId = null;

/* 动画结束后清理样式和状态 */
const releaseAfterAnimation = () => {
  if (!asideRef.value) return;
  // 清除可能存在的兜底定时器
  if (releaseTimeoutId) {
    clearTimeout(releaseTimeoutId);
    releaseTimeoutId = null;
  }
  asideRef.value.style.height = '';
  asideRef.value.style.transition = '';
  asideRef.value.classList.remove('no-scroll');
  isHeightAnimating = false; // 重置动画标志
  // pendingEndHeight 会在 batchEndCheck 开始时被覆盖，无需在此清空

  // 检查是否有排队的动画
  if (queued) {
    queued = false; // 清除队列标志
    batchEndCheck(); // 触发排队的检查和动画
  }
};

/* 锁定滚动并记录初始高度 */
const lockScroll = () => {
  if (activeTransitions === 0 && asideRef.value) {
    // 记录批次开始高度；关滚动条
    startHeight = asideRef.value.offsetHeight;
    asideRef.value.classList.add('no-scroll');
  }
  activeTransitions++;
};

/* 检查批次是否结束，并在结束后启动高度动画 (包含队列和强化监听) */
const batchEndCheck = async () => {
  activeTransitions--;
  if (activeTransitions !== 0 || !asideRef.value) {
    return;
  }

  // DOM 稳定，获取最终高度
  const newPendingEndHeight = asideRef.value.scrollHeight;

  // 如果当前有动画正在进行，则标记排队并等待其结束
  if (isHeightAnimating) {
    pendingEndHeight = newPendingEndHeight; // 更新目标高度为最新的
    queued = true;
    return;
  }

  // 获取当前的实际高度作为动画起点
  const currentStartHeight = asideRef.value.offsetHeight; 
  pendingEndHeight = newPendingEndHeight; // 设置本次动画的目标高度

  // 如果高度未变化，直接清理并返回
  if (currentStartHeight === pendingEndHeight) {
    releaseAfterAnimation(); // 确保 no-scroll 被移除
    return;
  }

  // 开始执行唯一的高度动画
  isHeightAnimating = true;
  const aside = asideRef.value;

  aside.style.height = currentStartHeight + 'px';
  aside.style.transition = 'height .25s ease';

  requestAnimationFrame(() => {
    aside.style.height = pendingEndHeight + 'px';
  });

  // 清除旧的兜底定时器（如果有的话）
  if (releaseTimeoutId) clearTimeout(releaseTimeoutId);

  // 强化 transitionend 监听
  const transitionEndHandler = (e) => {
    if (e.target === aside && e.propertyName === 'height') {
      releaseAfterAnimation();
    }
  };
  aside.addEventListener('transitionend', transitionEndHandler, { once: true });

  // 设置兜底定时器
  releaseTimeoutId = setTimeout(() => {
    aside.removeEventListener('transitionend', transitionEndHandler);
    releaseAfterAnimation(); 
  }, 300); // 稍长于动画时间
};

/* 绑定到 <transition-group> 的钩子函数 */
const onBeforeLeave = (el) => {
  if (!shouldShowOutlinePanel.value) {
    // 中文说明：整个 outline 面板关闭时只走外层面板淡出。
    // 不能再启动列表内部 height 补间，否则离场 item 会把面板先压成矮壳再消失。
    el.dataset.skipOutlineHeightAnimation = 'true';
    return;
  }

  const rect = el.getBoundingClientRect();
  // 在应用样式前加日志
  
  el.style.width = rect.width + 'px';
  el.style.height = rect.height + 'px';
  
  lockScroll(); // 这行会在暂停后执行
};
const onBeforeEnter = () => lockScroll();
const onAfterLeave = (el) => {
  if (el.dataset.skipOutlineHeightAnimation === 'true') {
    delete el.dataset.skipOutlineHeightAnimation;
    return;
  }

  batchEndCheck();
};
const onAfterEnter = () => batchEndCheck();

// --- 活动标题跟踪 --- 
// 查找给定位置所在的标题块或其最近的父标题块
const findHeadingAtPosition = (position) => {
  if (!flatOutlineList.value.length) return null;
  
  // 首先按照位置排序所有标题
  const sortedHeadings = [...flatOutlineList.value].sort((a, b) => a.pos - b.pos);
  
  // 找到光标后面的第一个标题的索引
  let nextHeadingIndex = sortedHeadings.findIndex(h => h.pos > position);
  
  // 如果光标在所有标题之后或者没有找到，则返回最后一个标题
  if (nextHeadingIndex === -1) {
    return sortedHeadings[sortedHeadings.length - 1].id;
  }
  
  // 如果光标在第一个标题之前，则返回第一个标题
  if (nextHeadingIndex === 0) {
    return sortedHeadings[0].id;
  }
  
  // 否则返回光标前面的最后一个标题
  return sortedHeadings[nextHeadingIndex - 1].id;
};

// 监听光标位置并更新活动标题
const updateActiveHeading = debounce(() => {
  const editorInstance = getCurrentEditor();
  if (!editorInstance) return;
  
  // 获取当前选择范围
  const { selection } = editorInstance.state;
  let from = selection.from;

  // 如果是 rootBlock 的 NodeSelection，并且内部是 headingBlock，
  // 则将位置调整到 headingBlock 内部（rootBlockPos + 1），
  // 避免被误判为“在当前标题之前”而高亮到上一个标题。
  if (selection instanceof NodeSelection) {
    const node = selection.node;
    if (node && node.type && node.type.name === 'rootBlock' && node.childCount > 0) {
      const firstChild = node.child(0);
      if (firstChild && firstChild.type && firstChild.type.name === 'headingBlock') {
        from = selection.from + 1;
      }
    }
  }
  
  // 找到当前位置所在的标题
  const headingId = findHeadingAtPosition(from);
  
  // 更新活动标题ID
  if (headingId !== activeHeadingId.value) {
    activeHeadingId.value = headingId;
  }
}, 100); // 100ms的防抖，避免频繁更新

// --- 生命周期钩子 ---
const unbindEditor = () => {
  if (!outlineSubscribedEditor) return;

  outlineSubscribedEditor.off('update', debouncedUpdateOutline);
  outlineSubscribedEditor.off('selectionUpdate', updateActiveHeading);

  if (outlineSubscribedEditor.eventBus) {
    outlineSubscribedEditor.eventBus.off('file-content-loaded', scheduleFileLoadedOutlineUpdate);
  }

  outlineSubscribedEditor = null;
};

const bindEditor = (editorInstance) => {
  if (!editorInstance) {
    unbindEditor();
    setHasHeadings(false);
    return;
  }

  if (outlineSubscribedEditor === editorInstance) {
    return;
  }

  unbindEditor();
  outlineSubscribedEditor = editorInstance;

  updateOutline();
  editorInstance.on('update', debouncedUpdateOutline);

  // 添加选择变化监听，更新活动标题
  editorInstance.on('selectionUpdate', updateActiveHeading);

  if (editorInstance.eventBus) {
    editorInstance.eventBus.on('file-content-loaded', scheduleFileLoadedOutlineUpdate);
  }

  // 初始更新活动标题
  updateActiveHeading();
};

onMounted(() => {
  bindEditor(getCurrentEditor());
});

onBeforeUnmount(() => {
  setPanelHovered(false);
  setPanelFocused(false);
  unbindEditor();
  cancelFileLoadedOutlineUpdate();
  debouncedUpdateOutline.cancel();
  updateActiveHeading.cancel(); // 取消防抖的更新函数
});

watch(() => uiStore.editorInstanceVersion, () => {
  cancelFileLoadedOutlineUpdate();
  bindEditor(getCurrentEditor());
}, { immediate: false });

watch(isOutlineRequested, (visible) => {
  if (!visible) {
    // 中文说明：先记住关闭前的面板自然高度，再清空列表。
    // 外层面板还要淡出 0.18s，不能在这段时间按空列表重算成 100px 矮壳。
    lastVisibleOutlineItemCount.value = visibleOutlineList.value.length;
    // hover 预览关闭后立刻清空列表，避免隐藏目录继续参与大文档响应式计算。
    flatOutlineList.value = [];
    return;
  }

  updateOutline();
  nextTick(() => {
    syncOutlineViewportMetrics();
  });
});

// 监听 hasHeadings 状态，在变为 false 时清空列表
watch(outlineHasHeadings, (newValue) => {
  if (newValue === false) {
    flatOutlineList.value = [];
  }
});
</script>
