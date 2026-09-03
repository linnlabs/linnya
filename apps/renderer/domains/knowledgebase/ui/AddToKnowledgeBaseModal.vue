<template>
  <Modal
    :isVisible="show"
    :title="knowledgeBaseMessage('knowledgeBase.addTo.title')"
    width="420px"
    maxWidth="90vw"
    scroll-mode="content"
    @close="handleClose"
  >
    <div class="add-to-kb-body">
      <!-- 文档信息提示 -->
      <div class="doc-info">
        <div class="doc-info-label">{{ knowledgeBaseMessage('knowledgeBase.addTo.documentLabel') }}</div>
        <div class="doc-info-name" :title="documentName">{{ documentName }}</div>
      </div>

      <!-- 知识库选择 -->
      <div class="kb-select-section">
        <div class="kb-select-label">{{ knowledgeBaseMessage('knowledgeBase.addTo.targetLabel') }}</div>
        <div class="kb-select-wrap">
          <CustomSelect
            v-model="selectedKbId"
            :options="kbOptions"
            :placeholder="knowledgeBaseMessage('knowledgeBase.addTo.placeholder')"
            :title="knowledgeBaseMessage('knowledgeBase.addTo.selectTitle')"
            :usePortalToBody="true"
            :class-names="{ trigger: 'kb-target-select-trigger' }"
          >
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

      <!-- 提示信息 -->
      <div class="hint-text">
        {{ knowledgeBaseMessage('knowledgeBase.addTo.hint') }}
      </div>
    </div>

    <template #footer>
      <div class="add-to-kb-footer">
        <ActionButtons
          :primary-action-text="knowledgeBaseMessage('knowledgeBase.addTo.confirm')"
          :secondary-action-text="knowledgeBaseMessage('knowledgeBase.common.cancel')"
          :is-primary-action-disabled="!selectedKbId || isLoading"
          :show-secondary-action="true"
          @primary-click="handleConfirm"
          @secondary-click="handleClose"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
/**
 * @file AddToKnowledgeBaseModal.vue
 * @description 选择知识库弹窗（轻量级，只负责选择）
 *
 * 设计说明（中文）：
 * - 职责单一：选择目标 KB → emit confirm(kbId)
 * - 实际的"入队 + 解析"由调用方执行，保持弹窗与业务解耦
 * - 可被顶部 More 菜单、侧边栏 TreeItem More 菜单等多处复用
 */

import { computed, ref, watch } from 'vue';
import { ActionButtons, CustomSelect, Modal } from '@linnya/renderer-ui';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useKnowledgeBaseStore } from '../stores/knowledgeBase';
import { useKnowledgeBaseLocalization } from './useKnowledgeBaseLocalization';

// 知识库 Store 返回数据的轻量类型
type KnowledgeBaseItem = {
  id: string;
  name: string;
};

/**
 * 将不可信输入收窄为 unknown[]
 *
 * 中文说明：
 * - 不直接用 Array.isArray 的原因：其类型谓词会把结果收窄到 any[]
 * - 这里用自定义守卫保持 unknown[]，避免 any 污染与类型退化
 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * 判断是否为知识库条目
 *
 * 中文说明：
 * - kbStore 来自 JS 文件，运行期可能返回任意结构
 * - 这里做严格守卫，保证后续 CustomSelect 渲染稳定
 */
function isKnowledgeBaseItem(value: unknown): value is KnowledgeBaseItem {
  if (typeof value !== 'object' || value === null) return false;

  // 使用 Record<string, unknown> 读取字段，避免 any
  const obj = value as Record<string, unknown>;
  return typeof obj.id === 'string' && typeof obj.name === 'string';
}

const props = defineProps<{
  /** 是否显示弹窗 */
  show: boolean;
  /** 要添加的文档名称（用于展示） */
  documentName: string;
  /** 默认选中的知识库 ID */
  defaultKbId?: string | null;
}>();

const emit = defineEmits<{
  /** 关闭弹窗 */
  (e: 'close'): void;
  /** 确认选择，传出选中的知识库 ID */
  (e: 'confirm', kbId: string): void;
}>();

const kbStore = useKnowledgeBaseStore();
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();

// 加载状态
const isLoading = ref(false);

// 选中的知识库 ID
const selectedKbId = ref<string>('');

// 知识库列表（从 Store 获取）
const knowledgeBases = computed<KnowledgeBaseItem[]>(() => {
  /**
   * 中文说明：
   * - 这里显式提升为 unknown，避免 kbStore.knowledgeBases 在 TS 推断为 never[]
   * - 后续通过类型守卫收窄为 KnowledgeBaseItem[]
   */
  const raw: unknown = kbStore.knowledgeBases;
  if (!isUnknownArray(raw)) return [];
  return raw.filter(isKnowledgeBaseItem);
});

// CustomSelect 选项格式
const kbOptions = computed<Array<{ value: string; text: string }>>(() => {
  return knowledgeBases.value.map((kb) => ({
    value: kb.id,
    text: kb.name,
  }));
});

// 弹窗打开时：加载数据 + 设置默认选中
watch(
  () => props.show,
  async (visible) => {
    if (!visible) return;

    isLoading.value = true;
    try {
      await kbStore.ensureDataLoaded();
    } catch (error) {
      console.error('[AddToKnowledgeBaseModal] 加载知识库列表失败:', error);
    } finally {
      isLoading.value = false;
    }

    // 设置默认选中
    const preferred =
      typeof props.defaultKbId === 'string' && props.defaultKbId.trim().length > 0
        ? props.defaultKbId
        : null;

    const exists = (id: string) => knowledgeBases.value.some((kb) => kb.id === id);

    if (preferred && exists(preferred)) {
      selectedKbId.value = preferred;
      return;
    }

    if (exists('default')) {
      selectedKbId.value = 'default';
      return;
    }

    if (knowledgeBases.value.length > 0) {
      selectedKbId.value = knowledgeBases.value[0].id;
    }
  }
);

const handleClose = () => {
  emit('close');
};

const handleConfirm = () => {
  if (!selectedKbId.value) return;
  emit('confirm', selectedKbId.value);
};
</script>
