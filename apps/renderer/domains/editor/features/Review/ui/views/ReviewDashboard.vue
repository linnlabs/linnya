<template>
  <div class="review-section dashboard-view review-dashboard-view">
    <div class="dashboard-header">
      <div class="header-left">
        <h3>{{ editorMessage('editor.review.dashboard.title') }}</h3>
        <span v-if="reviewAnnotations.length > 0" class="message-count">
          {{ filteredAnnotations.length }} / {{ reviewAnnotations.length }}
        </span>
      </div>
      <button class="new-review-btn" @click="reviewStore.resetReview()">
        {{ editorMessage('editor.review.dashboard.newReview') }}
      </button>
    </div>

    <div
      v-if="reviewAnnotations.length > 0"
      ref="tabsContainerRef"
      :class="['filter-tabs', { 'is-scrollable': dashboardAgents.length > 4 }]"
      :aria-label="editorMessage('editor.review.dashboard.filterAriaLabel')"
      :style="indicatorStyle"
    >
      <button
        :ref="(el) => setTabRef('all', el)"
        :class="['filter-tab', { active: reviewStore.activeAgentFilter === 'all' }]"
        type="button"
        @click="reviewStore.setActiveAgentFilter('all')"
      >
        {{ editorMessage('editor.review.dashboard.all') }}
      </button>
      <button
        v-for="agent in dashboardAgents"
        :key="agent.id"
        :ref="(el) => setTabRef(agent.id, el)"
        :class="['filter-tab', { active: reviewStore.activeAgentFilter === agent.id }]"
        type="button"
        @click="reviewStore.setActiveAgentFilter(agent.id)"
      >
        {{ agent.name }}
      </button>
    </div>

    <div class="results-list">
      <div v-if="filteredAnnotations.length === 0" class="empty-state">
        <p>{{ editorMessage('editor.review.dashboard.emptyTitle') }}</p>
        <p class="sub">{{ editorMessage('editor.review.dashboard.emptySubtitle') }}</p>
      </div>

      <div v-else class="messages-container">
        <ReviewMessageCard
          v-for="annotation in filteredAnnotations"
          :key="annotation.id"
          :annotation="annotation"
          :agent-name="readAnnotationAgentName(annotation)"
          @click="handleAnnotationClick"
          @delete="handleDeleteAnnotation"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useReviewStore } from '../../store/reviewStore';
import ReviewMessageCard from '../components/ReviewMessageCard.vue';
import { useUIStore } from '@shared/stores/ui';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ReviewAnnotation } from '../../types/reviewAnnotation';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';
import { resolveReviewAgentName } from '../../functions/reviewAgentPresentation';

const reviewStore = useReviewStore();
const uiStore = useUIStore();
const { editorMessage } = useEditorLocalization();

const editorInstance = computed(() => uiStore.getEditor());
const annotationStore = computed(() => editorInstance.value?.annotationStore);

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isReviewAnnotation = (annotation: unknown): annotation is ReviewAnnotation => {
  if (!isObjectRecord(annotation)) return false;

  const meta = annotation.meta;
  if (!isObjectRecord(meta) || meta.source !== 'review') return false;

  return (
    typeof annotation.id === 'string' &&
    typeof annotation.blockId === 'string' &&
    typeof annotation.content === 'string' &&
    typeof annotation.author === 'string' &&
    typeof annotation.state === 'string' &&
    typeof annotation.createdAt === 'string'
  );
};

/**
 * 全量 Review 批注：以 annotationStore.annotations 为事实源
 * - meta.source === 'review'
 */
const reviewAnnotations = computed<ReviewAnnotation[]>(() => {
  const store = annotationStore.value;
  const listUnknown = store?.annotations?.value;
  if (!Array.isArray(listUnknown)) return [];

  return listUnknown.filter(isReviewAnnotation);
});

/**
 * Review 批注排序：与正文（rootBlock 顺序）一致
 *
 * 说明：
 * - 用户期望“审阅卡片排列顺序”和正文一致
 * - 因此以 editor.state.doc 中 rootBlock 的出现顺序为排序依据
 * - 同一 block 内再按 createdAt 升序，保证稳定
 */
const sortedReviewAnnotations = computed<ReviewAnnotation[]>(() => {
  const editor = editorInstance.value;
  const list = reviewAnnotations.value;
  if (!editor?.state?.doc) return list;

  const posByBlockId = new Map<string, number>();
  editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.type?.name === 'rootBlock') {
      const id = (node.attrs as { id?: unknown } | undefined)?.id;
      if (typeof id === 'string' && id.trim().length > 0) {
        posByBlockId.set(id, pos);
      }
    }
  });

  const safeTime = (iso: unknown) => {
    if (typeof iso !== 'string' || iso.trim().length === 0) return 0;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };

  return [...list].sort((a, b) => {
    const pa = posByBlockId.get(a.blockId);
    const pb = posByBlockId.get(b.blockId);
    const va = typeof pa === 'number' ? pa : Number.POSITIVE_INFINITY;
    const vb = typeof pb === 'number' ? pb : Number.POSITIVE_INFINITY;
    if (va !== vb) return va - vb;
    return safeTime(a.createdAt) - safeTime(b.createdAt);
  });
});

/**
 * Dashboard Tab 角色列表（用于“历史审阅”场景）：
 * - 不依赖 reviewStore.activeAgentIds（那是“本次准备审阅的选择”）
 * - 以 reviewAnnotations 的 meta.agentId 为事实源
 * - 同时合并“当前选择的角色”（用于新审阅刚开始/某角色无批注时也应可见）
 */
const dashboardAgents = computed(() => {
  const counts = new Map<string, number>();
  for (const a of reviewAnnotations.value) {
    const id = a?.meta?.agentId;
    if (typeof id !== 'string' || id.trim().length === 0) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  // 1) 角色集合：历史（counts.keys） + 当前选择（reviewStore.selectedAgents）
  const idSet = new Set<string>();
  for (const id of counts.keys()) idSet.add(id);
  for (const agent of reviewStore.selectedAgents) {
    if (typeof agent.id === 'string' && agent.id.trim().length > 0) {
      idSet.add(agent.id);
    }
  }

  // 2) 名称映射：优先用 availableAgents（含系统/自定义），否则回退用 id
  const nameById = new Map<string, string>();
  for (const a of reviewStore.availableAgents) {
    nameById.set(a.id, resolveReviewAgentName(a.id, reviewStore.availableAgents, editorMessage));
  }

  // 3) 排序：先按系统内置顺序，再按“当前选择”的顺序，再按数量降序，最后按字典序
  const builtinOrder = ['logicCheck', 'structure', 'polish'];
  const selectedOrder = reviewStore.selectedAgents.map((a) => a.id);

  const ids = Array.from(idSet);
  ids.sort((a, b) => {
    const iba = builtinOrder.indexOf(a);
    const ibb = builtinOrder.indexOf(b);
    if (iba !== -1 || ibb !== -1) {
      if (iba === -1) return 1;
      if (ibb === -1) return -1;
      return iba - ibb;
    }

    const isa = selectedOrder.indexOf(a);
    const isb = selectedOrder.indexOf(b);
    if (isa !== -1 || isb !== -1) {
      if (isa === -1) return 1;
      if (isb === -1) return -1;
      return isa - isb;
    }

    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    if (ca !== cb) return cb - ca;
    return a.localeCompare(b);
  });

  return ids.map((id) => ({ id, name: nameById.get(id) ?? id }));
});

const readAnnotationAgentName = (annotation: ReviewAnnotation): string => {
  const agentId = annotation.meta?.agentId;
  if (typeof agentId === 'string' && agentId.trim().length > 0) {
    return resolveReviewAgentName(
      agentId,
      reviewStore.availableAgents,
      editorMessage,
      annotation.author,
    );
  }

  return annotation.author;
};

const filteredAnnotations = computed<ReviewAnnotation[]>(() => {
  const active = reviewStore.activeAgentFilter;
  if (active === 'all') return sortedReviewAnnotations.value;
  return sortedReviewAnnotations.value.filter((a) => a.meta?.agentId === active);
});

// --- Tab：液滴滑动背景（样式与 KnowledgeBaseDetail 对齐，仅形状保持圆角矩形） ---
const tabRefs = ref<Record<string, HTMLElement | null>>({});
const tabsContainerRef = ref<HTMLElement | null>(null);
const indicatorStyle = ref({
  '--indicator-x': '3px',
  '--indicator-width': '0px'
});
let resizeObserver: ResizeObserver | null = null;

/**
 * 记录 Tab 按钮 DOM 引用。
 * - 模板 ref 回调的入参类型较宽（可能是组件实例/Element/null），这里通过 instanceof 收口
 * - 通过 instanceof 收口 DOM 类型，不用断言绕过模板 ref 的宽类型
 */
const setTabRef = (key: string, el: unknown) => {
  if (el instanceof HTMLElement) {
    tabRefs.value[key] = el;
  }
};

/**
 * 当筛选项不在当前可见 Tabs 中时（例如：切换文档/加载历史后），回落到 all。
 */
watch(
  () => [reviewStore.activeAgentFilter, dashboardAgents.value.map((a) => a.id).join('|')],
  ([active]) => {
    if (active === 'all') return;
    const exists = dashboardAgents.value.some((a) => a.id === active);
    if (!exists) {
      reviewStore.setActiveAgentFilter('all');
    }
  },
  { immediate: true }
);

const updateIndicator = async () => {
  await nextTick();
  const activeKey = reviewStore.activeAgentFilter;
  const activeEl = tabRefs.value[activeKey];
  
  if (activeEl) {
    indicatorStyle.value = {
      '--indicator-x': `${activeEl.offsetLeft}px`,
      '--indicator-width': `${activeEl.offsetWidth}px`
    };
    return;
  }

  // 默认或找不到时（例如刚初始化可能为空），回落到 “全部”
  const defaultEl = tabRefs.value['all'];
  if (defaultEl) {
    indicatorStyle.value = {
      '--indicator-x': `${defaultEl.offsetLeft}px`,
      '--indicator-width': `${defaultEl.offsetWidth}px`
    };
  }
};

// 监听：active 变化 / Tabs 集合变化 / 批注加载完成（v-if 渲染 Tabs）时都需要更新滑块
watch(
  () => [
    reviewStore.activeAgentFilter,
    dashboardAgents.value.map((a) => a.id).join('|'),
    reviewAnnotations.value.length,
  ],
  () => updateIndicator(),
  { immediate: true }
);

onMounted(() => {
  updateIndicator();
  window.addEventListener('resize', updateIndicator);

  // 监听容器尺寸变化（侧边栏拖拽时触发）
  resizeObserver = new ResizeObserver(() => {
    updateIndicator();
  });
});

// 监听 tabsContainerRef：v-if 条件满足后容器才渲染，此时再 observe
watch(tabsContainerRef, (el, oldEl) => {
  if (resizeObserver) {
    if (oldEl) resizeObserver.unobserve(oldEl);
    if (el) resizeObserver.observe(el);
  }
}, { immediate: true });

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIndicator);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

const handleAnnotationClick = (annotation: ReviewAnnotation) => {
  // 点击卡片：定位到批注（复用既有 locate-annotation 事件）
  handleLocateAnnotation(annotation.id);
};

const handleLocateAnnotation = (annotationId: string) => {
  console.log('定位批注:', annotationId);
  // 触发批注定位事件
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('locate-annotation', {
      detail: { annotationId }
    }));
  }
};

const handleDeleteAnnotation = async (annotationId: string) => {
  const store = annotationStore.value;
  if (!store) return;

  if (typeof store.removeAnnotation !== 'function') {
    console.warn('[ReviewDashboard] annotationStore.removeAnnotation 不可用，无法删除批注');
    return;
  }

  await store.removeAnnotation(annotationId);
};
</script>
