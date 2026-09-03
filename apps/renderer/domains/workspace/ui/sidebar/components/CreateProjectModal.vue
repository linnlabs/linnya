<!-- apps/renderer/domains/workspace/ui/sidebar/components/CreateProjectModal.vue -->
<template>
  <Modal 
    :isVisible="show" 
    :title="isEditMode ? workspaceMessage('workspace.project.modal.editTitle') : workspaceMessage('workspace.project.modal.createTitle')"
    @close="handleClose"
    width="520px"
    scroll-mode="content"
    :closeOnOverlayClick="!isProcessing"
    :closeOnEsc="!isProcessing"
  >
    <div class="create-project-content">
      <!-- 项目名称 -->
      <div class="form-row input-row">
        <label class="form-label">{{ workspaceMessage('workspace.project.modal.nameLabel') }} <span class="required">*</span></label>
        <div class="control-area">
          <input 
            ref="projectNameInput"
            type="text" 
            v-model="formData.name" 
            class="settings-input" 
            :placeholder="workspaceMessage('workspace.project.modal.namePlaceholder')"
            :disabled="isProcessing"
            @keyup.enter="handleConfirm"
          >
        </div>
      </div>
      
      <!-- 项目描述 -->
      <div class="form-row input-row">
        <label class="form-label">{{ workspaceMessage('workspace.project.modal.descriptionLabel') }}</label>
        <div class="control-area">
          <textarea
            ref="descriptionTextarea"
            v-model="formData.description" 
            class="settings-textarea" 
            :placeholder="workspaceMessage('workspace.project.modal.descriptionPlaceholder')"
            :disabled="isProcessing"
            rows="5"
            @input="autoResizeTextarea"
          ></textarea>
        </div>
      </div>

      <!-- 关联知识库（仅创建模式展示：编辑关联在项目概览的“管理关联的知识库”里统一处理） -->
      <div v-if="!isEditMode" class="form-row input-row">
        <label class="form-label">{{ workspaceMessage('workspace.project.modal.knowledgeBaseLabel') }}</label>
        <div class="control-area">
          <div class="kb-tag-form-group">
            <div class="tag-input-wrapper">
              <!--
                说明：
                - 这里复用“知识库创建弹窗”的交互：下拉框仅代表“待添加的知识库”，真正加入关联列表需要点右侧“+”；
                - 但用户可能会误以为“选中即已关联”，因此在提交时会做一次“收口”（见 handleConfirm/handleAiCreate）。
              -->
              <CustomSelect
                v-model="selectedKnowledgeBaseId"
                :options="knowledgeBaseOptions"
                :placeholder="workspaceMessage('workspace.project.modal.knowledgeBasePlaceholder')"
                :title="workspaceMessage('workspace.project.modal.knowledgeBaseSelectTitle')"
                :usePortalToBody="true"
              >
                <template #arrow-icon="{ isOpen }">
                  <ChevronIcon
                    direction="down"
                    class="select-chevron"
                    :class="{ 'is-open': isOpen }"
                  />
                </template>
              </CustomSelect>
              <button
                type="button"
                class="add-tag-button"
                :disabled="isProcessing || !selectedKnowledgeBaseId"
                @click="handleAddKnowledgeBaseLink"
              >
                <AddIcon class="add-icon" />
              </button>
            </div>

            <div v-if="linkedKnowledgeBases.length > 0" class="tags-list">
              <TagChip
                v-for="kb in linkedKnowledgeBases"
                :key="kb.id"
                :label="kb.name"
                closable
                @close="handleRemoveKnowledgeBaseLink(kb.id)"
              />
            </div>
          </div>
        </div>
      </div>
      
      <!-- 错误信息 -->
      <div v-if="errorMessage" class="error-message">{{ errorMessage }}</div>
    </div>

    <template #footer>
      <div class="create-project-footer">
        <!-- 非编辑模式下显示：使用 ActionButtons 渲染的 AI 辅助创建按钮 -->
        <ActionButtons
          v-if="!isEditMode"
          class="ai-action-group"
          :primary-action-text="workspaceMessage('workspace.project.modal.aiCreate')"
          :is-primary-action-disabled="isProcessing || !formData.name.trim()"
          :show-secondary-action="false"
          primary-variant="accent"
          @primary-click="handleAiCreate"
        >
          <template #primary-content>
            <AiIcon class="ai-icon" />
            <span>{{ workspaceMessage('workspace.project.modal.aiCreate') }}</span>
          </template>
        </ActionButtons>
        <ActionButtons
          :secondary-action-text="workspaceMessage('workspace.project.modal.cancel')"
          :primary-action-text="primaryActionText"
          :is-primary-action-disabled="isProcessing || !formData.name.trim()"
          @secondary-click="handleClose"
          @primary-click="handleConfirm"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { ActionButtons, applyTextareaAutoResize, CustomSelect, Modal, TagChip } from '@linnya/renderer-ui';
import { AiIcon } from '@linnya/renderer-ui/icons';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useKnowledgeBaseStore } from '@/domains/knowledgebase/stores/knowledgeBase';
import { useWorkspaceLocalization } from '../../useWorkspaceLocalization';

// 组件接口定义
type InitialProjectData = {
  id: string;
  name: string;
  description?: string;
};

const props = defineProps<{
  show: boolean;
  isEditMode: boolean;
  initialData: InitialProjectData | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'confirm', payload: { name: string; description: string; kbIds: string[] }): void;
  (e: 'ai-create', payload: { name: string; description: string; kbIds: string[] }): void;
}>();
const { workspaceMessage } = useWorkspaceLocalization();

// 组件状态
const formData = reactive({
  name: '',
  description: ''
});

const isProcessing = ref(false);
const errorMessage = ref('');
const projectNameInput = ref<HTMLInputElement | null>(null);
const descriptionTextarea = ref<HTMLTextAreaElement | null>(null);

// 知识库列表与关联选择状态（仅创建模式使用）
type KnowledgeBaseItem = {
  id: string;
  name: string;
  description?: string;
};

type KnowledgeBaseOption = {
  value: string;
  text: string;
};

const kbStore = useKnowledgeBaseStore();
const selectedKnowledgeBaseId = ref<string | null>(null);
const linkedKnowledgeBaseIds = ref<string[]>([]);

const knowledgeBases = computed<KnowledgeBaseItem[]>(() => {
  /**
   * 严格说明：
   * - 禁止用 any 类型断言“糊过去”，这里对 store 返回做最小字段的运行时校验；
   * - 只抽取 UI 需要的字段（id/name/description），避免与 store 内部结构强耦合。
   */
  const raw = kbStore.knowledgeBases;
  if (!Array.isArray(raw)) return [];

  const result: KnowledgeBaseItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;

    const maybe = item as Record<string, unknown>;
    const id = maybe.id;
    const name = maybe.name;
    const description = maybe.description;

    if (typeof id !== 'string' || id.trim().length === 0) continue;
    if (typeof name !== 'string' || name.trim().length === 0) continue;

    const normalized: KnowledgeBaseItem = {
      id,
      name,
      ...(typeof description === 'string' && description.trim().length > 0
        ? { description }
        : {})
    };
    result.push(normalized);
  }

  return result;
});

const knowledgeBaseOptions = computed<KnowledgeBaseOption[]>(() =>
  knowledgeBases.value.map((kb) => ({
    value: kb.id,
    text: kb.name
  }))
);

const linkedKnowledgeBases = computed<KnowledgeBaseItem[]>(() =>
  linkedKnowledgeBaseIds.value
    .map((id) => knowledgeBases.value.find((kb) => kb.id === id) ?? null)
    .filter((kb): kb is KnowledgeBaseItem => kb !== null)
);

const primaryActionText = computed(() => {
  if (isProcessing.value) {
    return props.isEditMode
      ? workspaceMessage('workspace.project.modal.saving')
      : workspaceMessage('workspace.project.modal.creating');
  }

  return props.isEditMode
    ? workspaceMessage('workspace.project.modal.save')
    : workspaceMessage('workspace.project.modal.create');
});

// 监听显示状态，自动聚焦输入框
watch(() => props.show, async (newShow) => {
  if (newShow) {
    // 根据模式设置表单数据
    if (props.isEditMode && props.initialData) {
      formData.name = props.initialData.name;
      formData.description = props.initialData.description || '';
    } else {
      formData.name = workspaceMessage('workspace.project.modal.defaultProjectName');
      formData.description = '';
    }
    
    errorMessage.value = '';
    isProcessing.value = false;
    selectedKnowledgeBaseId.value = null;
    linkedKnowledgeBaseIds.value = [];

    // 打开弹窗时，确保知识库列表已加载（避免下拉为空导致误判）
    try {
      if (typeof kbStore.ensureDataLoaded === 'function') {
        await kbStore.ensureDataLoaded();
      } else if (typeof kbStore.fetchKnowledgeBases === 'function') {
        await kbStore.fetchKnowledgeBases();
      }
    } catch (error) {
      console.error('[CreateProjectModal] 加载知识库列表失败:', error);
    }
    
    // 等待 DOM 更新后聚焦
    await nextTick();
    if (projectNameInput.value) {
      projectNameInput.value.focus();
      if (!props.isEditMode) {
        projectNameInput.value.select(); // 创建模式下自动选中默认文本
      }
    }
  }
}, { immediate: true });

// 关闭模态框
const handleClose = () => {
  if (isProcessing.value) return; // 防止在处理时关闭
  emit('close');
};

// 自动调整 textarea 高度
const autoResizeTextarea = () => {
  if (!descriptionTextarea.value) return;
  applyTextareaAutoResize(descriptionTextarea.value, { maxHeight: 200 });
};

// 关联知识库：添加一条关联
const handleAddKnowledgeBaseLink = () => {
  if (!selectedKnowledgeBaseId.value) {
    return;
  }
  if (!linkedKnowledgeBaseIds.value.includes(selectedKnowledgeBaseId.value)) {
    linkedKnowledgeBaseIds.value.push(selectedKnowledgeBaseId.value);
  }
  selectedKnowledgeBaseId.value = null;
};

// 关联知识库：移除一条关联
const handleRemoveKnowledgeBaseLink = (kbId: string) => {
  linkedKnowledgeBaseIds.value = linkedKnowledgeBaseIds.value.filter((id) => id !== kbId);
};

/**
 * 将“下拉框里已选中但未点 + 的知识库”也并入待提交列表（避免 UX 误解造成“看起来关联了但实际没写入”）
 */
const getNormalizedKbIdsForSubmit = (): string[] => {
  return Array.from(
    new Set([
      ...linkedKnowledgeBaseIds.value,
      ...(selectedKnowledgeBaseId.value ? [selectedKnowledgeBaseId.value] : [])
    ])
  );
};

// 确认创建
const handleConfirm = () => {
  if (isProcessing.value || !formData.name.trim()) return;
  
  errorMessage.value = '';
  
  // 表单验证
  if (formData.name.trim().length < 1) {
    errorMessage.value = workspaceMessage('workspace.project.modal.nameRequired');
    return;
  }
  
  if (formData.name.trim().length > 100) {
    errorMessage.value = workspaceMessage('workspace.project.modal.nameTooLong');
    return;
  }
  
  // 发送确认事件，由父组件处理实际的创建逻辑
  emit('confirm', {
    name: formData.name.trim(),
    description: formData.description.trim(),
    kbIds: getNormalizedKbIdsForSubmit()
  });
};

// AI 辅助创建
const handleAiCreate = () => {
  if (isProcessing.value || !formData.name.trim()) return;
  
  errorMessage.value = '';
  
  // 表单验证
  if (formData.name.trim().length < 1) {
    errorMessage.value = workspaceMessage('workspace.project.modal.nameRequired');
    return;
  }
  
  if (formData.name.trim().length > 100) {
    errorMessage.value = workspaceMessage('workspace.project.modal.nameTooLong');
    return;
  }
  
  // 发送 AI 创建事件，由父组件处理
  emit('ai-create', {
    name: formData.name.trim(),
    description: formData.description.trim(),
    kbIds: getNormalizedKbIdsForSubmit()
  });
};
</script>
