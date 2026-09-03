<template>
  <section class="template-list">
    <header class="template-list-header">
      <h2 class="template-list-title">
        模板
      </h2>
      <span class="template-list-count">{{ templates.length }}</span>
    </header>

    <SlidesStatusState
      v-if="loading"
      title="正在加载模板"
      tone="loading"
    />
    <SlidesStatusState
      v-else-if="error"
      :title="error"
      action-label="重试"
      tone="error"
      @action="loadTemplates"
    />
    <SlidesStatusState
      v-else-if="templates.length === 0"
      title="暂无模板"
      description="可以通过导入 PPTX 模板逐步丰富模板库"
    />

    <div
      v-else
      class="template-grid"
    >
      <article
        v-for="template in templates"
        :key="template.id"
        class="template-card"
      >
        <div class="template-card-icon">
          <DocumentIcon class="template-card-icon-svg" />
        </div>
        <div class="template-card-body">
          <p class="template-card-title">
            {{ template.name }}
          </p>
          <p
            v-if="template.description"
            class="template-card-description"
          >
            {{ template.description }}
          </p>
          <p class="template-card-meta">
            创建于 {{ formatDate(template.createdAt) }} · 使用 {{ template.usageCount }} 次
          </p>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { TemplateSummary } from '../../types/api';
import { slidesApi } from '../../services/slidesApi';
import SlidesStatusState from '../shared/SlidesStatusState.vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';

const templates = ref<TemplateSummary[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function loadTemplates() {
  loading.value = true;
  error.value = null;

  try {
    templates.value = await slidesApi.listTemplates();
  } catch (cause) {
    console.error('[TemplateList] 模板加载失败:', cause);
    error.value = cause instanceof Error ? cause.message : '加载模板失败';
    templates.value = [];
  } finally {
    loading.value = false;
  }
}

function formatDate(timestamp: number): string {
  if (!timestamp) {
    return '未知时间';
  }

  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

onMounted(() => {
  loadTemplates();
});
</script>
