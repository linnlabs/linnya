<template>
  <!--
    知识库视图容器
    使用 .page-main-content 保持与其他非编辑器页面一致的居中布局：
    - 外层页面使用 .main-flow（三列 Grid）
    - 这里通过 .page-main-content 将内容固定在中间列
  -->
  <div class="page-main-content kb-view-container">
    <!-- List View -->
    <KnowledgeBaseList
      v-if="!currentKbId"
      @select="enterKb"
      @create="handleCreateKb"
    />

    <!-- Detail View -->
    <KnowledgeBaseDetail
      v-else
      :kbId="currentKbId"
      @back="exitKb"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useKnowledgeBaseStore } from '../../stores/knowledgeBase';
import KnowledgeBaseList from './KnowledgeBaseList.vue';
import KnowledgeBaseDetail from './KnowledgeBaseDetail.vue';
import { usePdfOcrPageLimitTaskNotification } from '../usePdfOcrPageLimitTaskNotification';

const kbStore = useKnowledgeBaseStore();

usePdfOcrPageLimitTaskNotification({
  getUploadTasks: () => kbStore.uploadTasks.values(),
});

/**
 * 从 JS Pinia store 中读取“当前知识库ID”。
 *
 * 说明：
 * - store 实现是 JS（未导出 TS 类型），在 TS 组件里可能被推断成 `string | null`，
 *   也可能是一个 `Ref<string | null>`（runtime 实际是 ref）。
 * - 这里通过类型守卫把两种形态统一收敛成 `string | null`，避免使用 any/断言。
 */
const isRefLike = (value: unknown): value is { value: unknown } => {
  return typeof value === 'object' && value !== null && 'value' in value;
};

const readCurrentKbId = (source: unknown): string | null => {
  if (typeof source === 'string') return source;
  if (isRefLike(source) && typeof source.value === 'string') return source.value;
  return null;
};

const currentKbId = computed<string | null>(() => {
  return readCurrentKbId(kbStore.currentKbId);
});

// --- Actions ---
const enterKb = (id: string) => {
  kbStore.setCurrentKnowledgeBase(id);
};

const exitKb = () => {
  kbStore.setCurrentKnowledgeBase(null);
};

const handleCreateKb = () => {
  // 新建知识库的创建流程已在 KnowledgeBaseList 内部通过 Modal 实现，
  // 这里保留钩子以便后续需要从外层触发时扩展。
};

onMounted(async () => {
  await kbStore.ensureDataLoaded();
  
  // 强制进入列表模式：
  // 1) 避免「上次在弹窗/其它入口」残留的 currentKbId 导致直接进入某个知识库详情（常见是 default）
  // 2) 降低“项目里已经关联了，但进入知识库却显示未关联”的误解概率（因为默认看的可能不是同一个知识库）
  // 设计约定：知识库首页优先展示列表，具体知识库由用户显式选择进入
  kbStore.setCurrentKnowledgeBase(null);
});
</script>
