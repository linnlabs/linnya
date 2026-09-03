<template>
  <Modal
    :isVisible="show"
    :title="knowledgeBaseMessage('knowledgeBase.globalUpload.title')"
    width="980px"
    maxWidth="92vw"
    height="640px"
    scroll-mode="internal"
    @close="handleClose"
  >
    <div class="global-upload-body">
      <div class="global-upload-layout">
        <!-- 顶部：目标知识库选择 + 全局说明 -->
        <div class="toolbar">
          <div class="toolbar-row">
            <div class="toolbar-left">
              <div class="label">{{ knowledgeBaseMessage('knowledgeBase.globalUpload.targetLabel') }}</div>
              <div class="kb-select-wrap">
                <CustomSelect
                  v-model="targetKbId"
                  :options="kbOptions"
                  :placeholder="knowledgeBaseMessage('knowledgeBase.globalUpload.placeholder')"
                  :title="knowledgeBaseMessage('knowledgeBase.globalUpload.selectTitle')"
                  :usePortalToBody="true"
                  :class-names="{ trigger: 'kb-target-select-trigger' }"
                >
                  <!-- 使用统一的 ChevronIcon，保持全局一致的下拉箭头风格 -->
                  <template #arrow-icon="{ isOpen }">
                    <ChevronIcon
                      direction="down"
                      class="select-chevron"
                      :class="{ 'is-open': isOpen }"
                    />
                  </template>
                </CustomSelect>
              </div>
            </div>
            <div class="toolbar-right">
              <div class="hint">
                {{ knowledgeBaseMessage('knowledgeBase.globalUpload.hint') }}
              </div>
            </div>
          </div>
        </div>

        <!-- 主体：复用现有上传 Tab，但展示范围为“全局” -->
        <div class="content">
          <FileUploadTab
            :selectedKbId="targetKbId"
            :showAllKbTasks="true"
          />
        </div>
      </div>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import FileUploadTab from './FileUploadTab.vue';
import { useKnowledgeBaseStore } from '../stores/knowledgeBase';
import { CustomSelect, Modal } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useKnowledgeBaseLocalization } from './useKnowledgeBaseLocalization';

type KnowledgeBaseItem = {
  id: string;
  name: string;
};

/**
 * 将不可信输入收窄为 unknown[]
 *
 * 中文说明：
 * - kbStore 来自 JS store，类型边界不够严格
 * - 这里保持 unknown[]，避免把 store 数据直接断言成业务实体
 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 判断是否为知识库条目
 *
 * 中文说明：
 * - 全局上传弹窗只依赖 id/name 两个字段
 * - 守卫越窄，越不容易把后端额外字段或异常结构泄漏到 UI
 */
function isKnowledgeBaseItem(value: unknown): value is KnowledgeBaseItem {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

const props = defineProps<{
  show: boolean;
  /**
   * 默认选中的知识库（用于从“某个知识库详情页”打开时自动锁定目标）
   */
  defaultKbId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const kbStore = useKnowledgeBaseStore();
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();

const knowledgeBases = computed<KnowledgeBaseItem[]>(() => {
  const raw: unknown = kbStore.knowledgeBases;
  if (!isUnknownArray(raw)) return [];
  return raw.filter(isKnowledgeBaseItem);
});

// CustomSelect 选项格式（与组件契约对齐）
const kbOptions = computed<Array<{ value: string; text: string }>>(() => {
  return knowledgeBases.value.map((kb) => ({
    value: kb.id,
    text: kb.name,
  }));
});

// 目标知识库：用于“新添加文件”的归属；展示任务列表则为全局
const targetKbId = ref<string>('default');

// 弹窗打开时：确保数据已加载，并设置默认目标
watch(
  () => props.show,
  async (visible) => {
    if (!visible) return;

    await kbStore.ensureDataLoaded();

    const preferred =
      typeof props.defaultKbId === 'string' && props.defaultKbId.trim().length > 0
        ? props.defaultKbId
        : null;

    // 优先使用传入的 defaultKbId，其次 default，其次列表第一个
    const exists = (id: string) => knowledgeBases.value.some((kb) => kb.id === id);

    if (preferred && exists(preferred)) {
      targetKbId.value = preferred;
      return;
    }

    if (exists('default')) {
      targetKbId.value = 'default';
      return;
    }

    if (knowledgeBases.value.length > 0) {
      targetKbId.value = knowledgeBases.value[0].id;
    }
  }
);

const handleClose = () => {
  emit('close');
};
</script>
