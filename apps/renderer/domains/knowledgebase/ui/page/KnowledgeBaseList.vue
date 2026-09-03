<template>
  <div class="kb-list-view">
    <!-- 中文说明：知识库保持独立全屏页，但沿用工作台的居中内容宽度。 -->
    <div class="kb-list-inner">
      <PageSectionHeader
        :title="knowledgeBaseMessage('knowledgeBase.list.title')"
        :subtitle="knowledgeBaseMessage('knowledgeBase.list.subtitle')"
        :meta="listMeta"
      >
        <template #actions>
          <button class="create-btn" @click="onCreateClick">
            <span class="icon">
              <AddIcon />
            </span>
            <span>{{ knowledgeBaseMessage('knowledgeBase.list.action.create') }}</span>
          </button>
          <!-- 全局上传入口：放在“新建知识库”下方，承载跨知识库的长时任务列表 -->
          <button class="global-upload-btn" @click="openGlobalUpload">
            <span class="icon">
              <UploadIcon class="upload-icon" />
            </span>
            <span>{{ knowledgeBaseMessage('knowledgeBase.list.action.globalUpload') }}</span>
          </button>
        </template>
      </PageSectionHeader>

      <!-- 主体网格区域 -->
      <section class="kb-grid" :aria-label="knowledgeBaseMessage('knowledgeBase.list.grid.ariaLabel')">
        <!-- 知识库卡片 -->
        <article
          v-for="kb in knowledgeBases"
          :key="kb.id"
          class="kb-card"
          role="button"
          tabindex="0"
          @click="$emit('select', kb.id)"
          @keypress.enter="$emit('select', kb.id)"
        >
          <div class="card-main">
            <div class="card-title-row">
              <span class="card-icon-inline">
                <KnowledgeBaseIcon class="kb-icon" />
              </span>
              <h3 class="card-title">{{ kb.name }}</h3>
              <span v-if="kb.id === 'default'" class="default-badge">
                {{ knowledgeBaseMessage('knowledgeBase.common.defaultBadge') }}
              </span>
            </div>
            <p class="card-subtitle">
              {{ kb.description || knowledgeBaseMessage('knowledgeBase.list.card.emptyDescription') }}
            </p>
            <div class="card-meta">
              <span class="meta-item">
                {{ knowledgeBaseMessage('knowledgeBase.list.card.documentCount', { count: kb.documentCount || 0 }) }}
              </span>
              <!-- 进度条与文档数量同一行：右对齐展示，避免占用额外垂直空间 -->
              <div class="card-meta-right">
                <KnowledgeGraphProgressBar
                  :percent="kgProgressStore.getProgress(kb.id)?.percent ?? null"
                  :total-units="kgProgressStore.getProgress(kb.id)?.totalUnits ?? null"
                  :done-units="kgProgressStore.getProgress(kb.id)?.doneUnits ?? null"
                  :compact="true"
                />
              </div>
            </div>
          </div>
        </article>

        <!-- 新建卡片：与普通卡片在结构上保持一致，图标缩小放到标题左侧 -->
        <article class="kb-card create-card" @click="onCreateClick" role="button" tabindex="0">
          <div class="card-main">
            <div class="card-title-row">
              <span class="card-icon-inline create-icon-inline">
                <AddIcon />
              </span>
              <h3 class="card-title">
                {{ knowledgeBaseMessage('knowledgeBase.list.createCard.title') }}
              </h3>
            </div>
            <p class="create-desc">
              {{ knowledgeBaseMessage('knowledgeBase.list.createCard.description') }}
            </p>
          </div>
        </article>
      </section>

      <!-- 完全为空的占位态：覆盖网格区域 -->
      <section v-if="knowledgeBases.length === 0" class="empty-state">
        <div class="empty-panel">
          <div class="empty-icon">📭</div>
          <h2 class="empty-title">{{ knowledgeBaseMessage('knowledgeBase.list.empty.title') }}</h2>
          <p class="empty-desc">
            {{ knowledgeBaseMessage('knowledgeBase.list.empty.description') }}
          </p>
          <button class="empty-create-btn" @click="onCreateClick">
            <span class="icon">
              <AddIcon />
            </span>
            {{ knowledgeBaseMessage('knowledgeBase.list.empty.createFirst') }}
          </button>
        </div>
      </section>
    </div>
  </div>

  <!-- 新建知识库弹窗（拆分为独立组件） -->
  <CreateKnowledgeBaseModal
    :show="showCreateModal"
    @close="closeCreateModal"
    @created="handleCreatedKb"
  />

  <!-- 全局上传弹窗 -->
  <GlobalUploadModal
    :show="showGlobalUpload"
    @close="closeGlobalUpload"
  />
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { useKnowledgeBaseStore } from '../../stores/knowledgeBase';
import { useKnowledgeGraphProgressStore } from '../../stores/knowledgeGraphProgressStore';
import { KnowledgeBaseIcon } from '@linnya/renderer-ui/icons';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { UploadIcon } from '@linnya/renderer-ui/icons';
import { PageSectionHeader } from '@linnya/renderer-ui';
import CreateKnowledgeBaseModal from '../CreateKnowledgeBaseModal.vue';
import GlobalUploadModal from '../GlobalUploadModal.vue';
import KnowledgeGraphProgressBar from '../KnowledgeGraphProgressBar.vue';
import { useKnowledgeBaseLocalization } from '../useKnowledgeBaseLocalization';

const kbStore = useKnowledgeBaseStore();
const kgProgressStore = useKnowledgeGraphProgressStore();
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();

// 将后端返回的数据用轻量类型约束，显式声明可选简介字段
type KnowledgeBaseItem = {
  id: string;
  name: string;
  description?: string;
  documentCount?: number;
};

/**
 * 将 store（JS）里拿到的“未知结构数据”归一化成组件可用的轻量类型。
 * 目的：
 * - 避免把 any 直接透传到模板
 * - 兼容后端可能的 snake_case 字段（document_count）
 * - 不使用不规范的类型断言
 */
const normalizeKnowledgeBaseItem = (input: unknown): KnowledgeBaseItem | null => {
  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
  };

  if (!isRecord(input)) return null;
  const obj = input;

  const id = typeof obj.id === 'string' ? obj.id : null;
  const name = typeof obj.name === 'string' ? obj.name : null;
  if (!id || !name) return null;

  const description = typeof obj.description === 'string' ? obj.description : undefined;

  const documentCount =
    typeof obj.documentCount === 'number'
      ? obj.documentCount
      : (typeof obj.document_count === 'number' ? obj.document_count : undefined);

  return { id, name, description, documentCount };
};

// 轻量包装 store 数据，避免直接把 any 传给模板
const knowledgeBases = computed<KnowledgeBaseItem[]>(() => {
  const raw: unknown = kbStore.knowledgeBases;
  if (!Array.isArray(raw)) return [];

  const list: KnowledgeBaseItem[] = [];
  for (const item of raw) {
    const normalized = normalizeKnowledgeBaseItem(item);
    if (normalized) list.push(normalized);
  }
  return list;
});

const listMeta = computed(() => {
  const count = knowledgeBases.value.length;
  return count > 0
    ? knowledgeBaseMessage('knowledgeBase.list.meta.count', { count })
    : undefined;
});

// 全局（列表）：预取每个 KB 的图谱进度
const kbIds = computed(() => knowledgeBases.value.map((kb) => kb.id));

onMounted(() => {
  kgProgressStore.ensureSubscribed();
  void kgProgressStore.prefetchForKbIds(kbIds.value);
});

watch(
  kbIds,
  (ids) => {
    kgProgressStore.ensureSubscribed();
    void kgProgressStore.prefetchForKbIds(ids);
  },
  { immediate: true }
);

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'create'): void;
}>();

// --- 新建知识库 Modal 相关状态 ---
const showCreateModal = ref(false);
const showGlobalUpload = ref(false);

const openCreateModal = () => {
  showCreateModal.value = true;
};

const closeCreateModal = () => {
  showCreateModal.value = false;
};

// 触发新建：本组件内部打开弹窗，同时保留对外事件（方便后续扩展）
const onCreateClick = () => {
  openCreateModal();
  emit('create');
};

// 子组件创建成功后的回调，目前仅负责关闭弹窗，后续可在此扩展行为
const handleCreatedKb = () => {
  closeCreateModal();
};

// 打开全局上传：这里仅负责弹窗展示，任务队列的全局能力由 store 保证
const openGlobalUpload = async () => {
  await kbStore.ensureDataLoaded();
  showGlobalUpload.value = true;
};

const closeGlobalUpload = () => {
  showGlobalUpload.value = false;
};
</script>
