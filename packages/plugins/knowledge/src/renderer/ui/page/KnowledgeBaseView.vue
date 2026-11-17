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
import { computed } from 'vue';
import { useKnowledgeBase } from '../../runtime.js';
import KnowledgeBaseList from './KnowledgeBaseList.vue';
import KnowledgeBaseDetail from './KnowledgeBaseDetail.vue';
import { usePdfOcrPageLimitTaskNotification } from '../usePdfOcrPageLimitTaskNotification';

const kbStore = useKnowledgeBase();

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

// 页面准备由 applicationSurface.prepare 完成；mounted 不能覆盖显式来源跳转的选择。
</script>
