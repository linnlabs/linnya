<template>
  <div class="kb-detail-view">
    <div class="kb-detail-inner">
      <!-- 顶部头部：返回 + 标题 + Tab 切换 -->
      <header class="detail-header">
        <div class="left-section">
          <button
            class="back-btn"
            :title="knowledgeBaseMessage('knowledgeBase.detail.backTitle')"
            @click="$emit('back')"
          >
            <!-- 使用通用 ChevronIcon 图标组件，方向为向左，尺寸与原图标保持一致 -->
            <ChevronIcon direction="left" width="16" height="16" />
          </button>
          <div class="kb-info">
            <div class="kb-title-row">
              <h2>{{ currentKbName }}</h2>
              <span v-if="isDefaultKb" class="kb-badge">
                {{ knowledgeBaseMessage('knowledgeBase.common.defaultBadge') }}
              </span>
            </div>
            <!-- “文档数量/最近更新”与图谱进度同一行，避免进度条挤到下一行 -->
            <div class="kb-meta-row">
              <div class="kb-meta">
                <span class="kb-meta-doc">{{ formatDocCount(currentKbDocumentCount) }}</span>
                <span class="kb-meta-updated">
                  {{ knowledgeBaseMessage('knowledgeBase.detail.meta.updatedAt', { date: formatDate(currentKbUpdatedAt) }) }}
                </span>
              </div>
              <!--
                说明：
                - “未开始抽取/后端暂无进度”时，kbGraphProgress 可能为 null
                - 但 UI 依然要展示一个灰底图标（品牌化提示），所以这里不要用 v-if 把组件短路掉
              -->
              <div class="kb-graph-progress">
                <KnowledgeGraphProgressBar
                  :percent="kbGraphProgress?.percent ?? null"
                  :total-units="kbGraphProgress?.totalUnits ?? null"
                  :done-units="kbGraphProgress?.doneUnits ?? null"
                  size="lg"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="right-section">
        <nav
          class="tab-navigation"
          :aria-label="knowledgeBaseMessage('knowledgeBase.detail.tabs.ariaLabel')"
          :style="indicatorStyle"
        >
          <button
            v-for="tab in tabs"
            :key="tab.id"
            :ref="(el) => { if (el) tabRefs[tab.id] = el as HTMLElement }"
            :class="['tab-button', { active: activeTab === tab.id }]"
            type="button"
            @click="activeTab = tab.id"
          >
            {{ tab.name }}
          </button>
        </nav>
        </div>
      </header>

      <!-- 底部标签内容区域 -->
      <section class="detail-content">
        <FileUploadTab
          v-if="activeTab === 'upload'"
          :selectedKbId="currentKbId"
          @open-global-upload="openGlobalUpload"
        />
        <FileManageTab
          v-if="activeTab === 'manage'"
          :selectedKbId="currentKbId"
        />
        <KnowledgeBaseSettingsTab
          v-if="activeTab === 'settings'"
          :selectedKbId="currentKbId"
        />
        <ParsingSettingsTab
          v-if="activeTab === 'config'"
          :selectedKbId="currentKbId"
        />
      </section>
    </div>
  </div>

  <!-- 全局上传弹窗：默认将“上传目标”锁定为当前知识库，但任务列表展示为全局 -->
  <GlobalUploadModal
    :show="showGlobalUpload"
    :defaultKbId="currentKbId"
    @close="closeGlobalUpload"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useKnowledgeBaseStore } from '../../stores/knowledgeBase';
import { useKnowledgeGraphProgressStore } from '../../stores/knowledgeGraphProgressStore';
import FileUploadTab from '../../ui/FileUploadTab.vue';
import FileManageTab from '../../ui/FileManageTab.vue';
import KnowledgeBaseSettingsTab from '../../ui/KnowledgeBaseSettingsTab.vue';
import ParsingSettingsTab from '../../ui/ParsingSettingsTab.vue';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import GlobalUploadModal from '../../ui/GlobalUploadModal.vue';
import KnowledgeGraphProgressBar from '../../ui/KnowledgeGraphProgressBar.vue';
import { useKnowledgeBaseLocalization } from '../useKnowledgeBaseLocalization';

// Props
const props = defineProps<{
  kbId: string
}>();

const emit = defineEmits<{
  (e: 'back'): void
}>();

const kbStore = useKnowledgeBaseStore();
const kgProgressStore = useKnowledgeGraphProgressStore();
const { currentLocale, knowledgeBaseMessage } = useKnowledgeBaseLocalization();

// --- State ---
// 标签页 ID 的联合类型，保证 activeTab 与配置一致
type TabId = 'upload' | 'manage' | 'settings' | 'config';

const activeTab = ref<TabId>('upload');
const showGlobalUpload = ref(false);

// 定义轻量类型以约束后端返回的数据
type KnowledgeBaseItem = {
  id: string;
  name: string;
  documentCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * 将 store（JS）里拿到的“未知结构数据”归一化成组件可用的轻量类型。
 * 目的：
 * - 避免把 any 直接透传到模板
 * - 兼容后端可能的 snake_case 字段（document_count / created_at / updated_at）
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

  const documentCount =
    typeof obj.documentCount === 'number'
      ? obj.documentCount
      : (typeof obj.document_count === 'number' ? obj.document_count : undefined);

  const createdAt =
    typeof obj.createdAt === 'string'
      ? obj.createdAt
      : (typeof obj.created_at === 'string' ? obj.created_at : undefined);

  const updatedAt =
    typeof obj.updatedAt === 'string'
      ? obj.updatedAt
      : (typeof obj.updated_at === 'string' ? obj.updated_at : undefined);

  return { id, name, documentCount, createdAt, updatedAt };
};

// --- Computed ---
const currentKbId = computed(() => props.kbId);
const kbGraphProgress = computed(() => {
  return kgProgressStore.getProgress(currentKbId.value);
});

const knowledgeBases = computed<KnowledgeBaseItem[]>(() => {
  // kbStore 来自 JS store，这里把 any 收口为 unknown 再做结构归一化
  const raw: unknown = kbStore.knowledgeBases;
  if (!Array.isArray(raw)) return [];

  const list: KnowledgeBaseItem[] = [];
  for (const item of raw) {
    const normalized = normalizeKnowledgeBaseItem(item);
    if (normalized) list.push(normalized);
  }
  return list;
});

const currentKb = computed<KnowledgeBaseItem | null>(() => {
  return knowledgeBases.value.find(kb => kb.id === currentKbId.value) ?? null;
});

const currentKbName = computed(() =>
  currentKb.value?.name ?? knowledgeBaseMessage('knowledgeBase.common.unknownKnowledgeBase')
);
const isDefaultKb = computed(() => currentKb.value?.id === 'default');

// 当前知识库的文档数量（用于头部展示）
const currentKbDocumentCount = computed<number | null>(() => {
  const kb = currentKb.value;
  if (!kb) return null;
  return typeof kb.documentCount === 'number' ? kb.documentCount : null;
});

// 当前知识库的最近更新时间（优先 updatedAt，其次 createdAt）
const currentKbUpdatedAt = computed<string | null>(() => {
  const kb = currentKb.value;
  if (!kb) return null;
  return kb.updatedAt ?? kb.createdAt ?? null;
});

// --- Tab Configuration ---
// 显式为 id 声明 TabId 类型，避免与 activeTab 类型不一致
const tabs = computed<Array<{ id: TabId; name: string }>>(() => [
  { id: 'upload', name: knowledgeBaseMessage('knowledgeBase.detail.tabs.upload') },
  { id: 'manage', name: knowledgeBaseMessage('knowledgeBase.detail.tabs.manage') },
  { id: 'settings', name: knowledgeBaseMessage('knowledgeBase.detail.tabs.settings') },
  { id: 'config', name: knowledgeBaseMessage('knowledgeBase.detail.tabs.parsing') }
]);

// 存储 Tab 按钮的引用，用于计算位置和宽度
const tabRefs = ref<Record<string, HTMLElement | null>>({});

// 液滴背景的动态样式
const indicatorStyle = ref({
  '--indicator-x': '3px',
  '--indicator-width': '0px'
});

// 更新液滴位置和宽度
const updateIndicator = async () => {
  await nextTick();
  const activeEl = tabRefs.value[activeTab.value];
  if (activeEl) {
    indicatorStyle.value = {
      '--indicator-x': `${activeEl.offsetLeft}px`,
      '--indicator-width': `${activeEl.offsetWidth}px`
    };
  }
};

// 监听激活 Tab 变化，更新液滴
watch(activeTab, updateIndicator);

// 初始化和窗口大小变化时更新
onMounted(() => {
  updateIndicator();
  window.addEventListener('resize', updateIndicator);

  // M6：确保订阅图谱进度推送，并拉一次当前 KB 的初始值
  kgProgressStore.ensureSubscribed();
  void kgProgressStore.fetchKbProgress(currentKbId.value);
});

watch(
  currentKbId,
  (id) => {
    if (!id) return;
    kgProgressStore.ensureSubscribed();
    void kgProgressStore.fetchKbProgress(id);
  },
  { immediate: true }
);

const openGlobalUpload = async () => {
  await kbStore.ensureDataLoaded();
  showGlobalUpload.value = true;
};

const closeGlobalUpload = () => {
  showGlobalUpload.value = false;
};

// 工具函数：将 ISO 字符串格式化为友好的日期展示
const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return knowledgeBaseMessage('knowledgeBase.common.emptyDate');
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return knowledgeBaseMessage('knowledgeBase.common.emptyDate');
    }
    return date.toLocaleDateString(currentLocale.value, { month: 'short', day: 'numeric' });
  } catch {
    return knowledgeBaseMessage('knowledgeBase.common.emptyDate');
  }
};

// 工具函数：格式化文档数量为“共计x篇文档，”（用于与“最近更新”拼接）
// 约定：始终使用阿拉伯数字；当数量缺失/非法时回落为 0（与列表页保持一致）
const formatDocCount = (count: number | null | undefined): string => {
  const raw = typeof count === 'number' && Number.isFinite(count) ? count : 0;
  const normalized = Math.max(0, Math.trunc(raw));
  return knowledgeBaseMessage('knowledgeBase.detail.meta.documentCount', { count: normalized });
};

// 删除逻辑已下沉到 KnowledgeBaseSettingsTab 中，这里不再提供顶层“危险操作”Tab。
</script>
